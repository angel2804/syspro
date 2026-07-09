// Capa de acceso a datos sobre Supabase. Encapsula TODAS las operaciones que
// la app necesita (antes dispersas en llamadas directas a Firestore), para que
// las páginas no conozcan el backend y el código quede limpio.
//
// Modelo de datos (ver supabase/schema.sql):
//   tabla `sesiones`: id text pk, dia_operativo text, isla_id text, turno text,
//                     trabajador text, cerrada bool, created_at int8,
//                     updated_at int8, data jsonb (Sesion completa). Las columnas
//                     isla_id/turno/dia_operativo son NOT NULL (espejo indexable).
//   tabla `config`:   key text pk, value jsonb  ('precios' | 'trabajadores')
import { getSupabase } from "./supabase";
import { diaMenos, diaOperativo, diaOperativoActual, turnoCompleto } from "./calc";
import { aprenderClientes } from "./clientes-autocompletado";
import type { Admin, Precios, Sesion, TurnoId } from "./types";

export const dbHabilitado = () => getSupabase() != null;

// Supabase/Postgres acepta `undefined` mal dentro de jsonb; el round-trip JSON
// los elimina (igual que un structuredClone que descartara undefined).
function limpio<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

function filaDeSesion(s: Sesion) {
  return {
    id: s.id,
    dia_operativo: s.diaOperativo,
    // Columnas espejo NOT NULL del esquema nuevo: sin ellas el upsert falla con
    // "null value in column isla_id/turno ... violates not-null constraint" y la
    // sesión nunca llega a Supabase (el admin no vería los turnos activos).
    isla_id: s.islaId,
    turno: s.turno,
    trabajador: s.trabajador ?? null,
    cerrada: s.cerrada,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    data: limpio(s),
  };
}

// `data` ya es la Sesion completa; el resto de columnas son espejo indexable.
function sesionDeFila(row: { data: Sesion }): Sesion {
  return row.data;
}

// ===== Sesiones =====

export async function fetchSesionesDesde(corte: string): Promise<Sesion[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("sesiones")
    .select("data")
    .gte("dia_operativo", corte);
  if (error) throw error;
  return (data ?? []).map((r) => sesionDeFila(r as { data: Sesion }));
}

export async function getSesion(id: string): Promise<Sesion | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("sesiones")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? sesionDeFila(data as { data: Sesion }) : null;
}

export async function upsertSesion(s: Sesion): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("sesiones").upsert(filaDeSesion(s));
  if (error) throw error;
}

export async function deleteSesion(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from("sesiones").delete().eq("id", id);
}

export async function deleteTodasSesiones(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  // neq a un id imposible = borrar todo, evitando el guardarraíl de Supabase
  // que prohíbe DELETE sin filtro.
  const { error } = await sb.from("sesiones").delete().neq("id", "__none__");
  if (error) throw error;
}

// Reset TOTAL para pruebas: borra TODOS los datos operativos y de cuenta
// corriente para dejar el sistema "de cero", CONSERVANDO solo las copias de
// seguridad (`backups`), las cuentas de usuario (`profiles`/Auth) y la
// configuración de settings (precios, trabajadores, logo). Se borra en orden de
// dependencias para no violar las claves foráneas:
//   pagos_credito → creditos → sesiones → cliente_alias → clientes →
//   precio_eventos → audit_log.
// `created_at >= 0` matchea todas las filas y satisface el guardarraíl de
// Supabase que prohíbe DELETE sin filtro.
export async function resetPruebasCompleto(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const borrados: Array<{ tabla: string; columna: string; valor: number }> = [
    { tabla: "pagos_credito", columna: "created_at", valor: 0 },
    { tabla: "creditos", columna: "created_at", valor: 0 },
    { tabla: "sesiones", columna: "created_at", valor: 0 },
    { tabla: "tanque_recargas", columna: "created_at", valor: 0 },
    { tabla: "tanque_registros", columna: "created_at", valor: 0 },
    { tabla: "tanque_capacidades", columna: "updated_at", valor: 0 },
    { tabla: "cliente_alias", columna: "created_at", valor: 0 },
    { tabla: "clientes", columna: "created_at", valor: 0 },
    { tabla: "precio_eventos", columna: "created_at", valor: 0 },
    { tabla: "audit_log", columna: "created_at", valor: 0 },
  ];
  for (const { tabla, columna, valor } of borrados) {
    const { error } = await sb.from(tabla).delete().gte(columna, valor);
    if (error) throw error;
  }
  // La lista de autocompletado de clientes (config/clientes) también se vacía;
  // precios, trabajadores y logo se conservan.
  await setConfig("clientes", { nombres: [] });
  await setConfig("clientes_descuento", { nombres: [] });
}

// Suscripción en vivo a una ventana de días. Trae el estado inicial UNA vez y
// luego mantiene la ventana en memoria aplicando SOLO la fila que cambió desde
// el payload del Realtime — sin volver a descargar toda la ventana en cada
// cambio. Antes hacía un refetch por evento: con varios dispositivos activos y
// el autoguardado del trabajador (~1 escritura/seg), eso era el mayor
// consumidor de ancho de banda del plan gratuito. Reemplaza al `onSnapshot` de
// Firestore. Devuelve una función para desuscribir.
export function subscribeSesiones(
  corte: string,
  onChange: (sesiones: Sesion[]) => void
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  let cancelado = false;

  // Estado local de la ventana [corte, hoy]. Se siembra con una consulta
  // inicial y de ahí en adelante se actualiza in-place con cada payload.
  const porId = new Map<string, Sesion>();
  const emitir = () => {
    if (!cancelado) onChange(Array.from(porId.values()));
  };

  const sembrar = async () => {
    try {
      const lista = await fetchSesionesDesde(corte);
      if (cancelado) return;
      porId.clear();
      for (const s of lista) porId.set(s.id, s);
      emitir();
    } catch {
      /* silencioso: la UI conserva el último estado conocido */
    }
  };
  sembrar(); // estado inicial (única descarga de la ventana completa)

  const channel = sb
    .channel(`sesiones-cambios-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "sesiones" },
      (payload) => {
        if (cancelado) return;
        if (payload.eventType === "DELETE") {
          // En DELETE el payload solo trae la clave primaria (id).
          const id = (payload.old as { id?: string } | null)?.id;
          if (id && porId.delete(id)) emitir();
          return;
        }
        // INSERT | UPDATE: la fila nueva incluye el documento completo en `data`,
        // así que no hace falta consultar la base para conocer el cambio.
        const row = payload.new as
          | { dia_operativo?: string; data?: Sesion }
          | null;
        if (!row?.data || !row.dia_operativo) return;
        // Ignorar cambios fuera de la ventana observada.
        if (row.dia_operativo < corte) return;
        porId.set(row.data.id, row.data);
        emitir();
      }
    )
    .subscribe();

  return () => {
    cancelado = true;
    sb.removeChannel(channel);
  };
}

// ===== Config (precios / trabajadores) =====

export async function getConfig<T>(key: string): Promise<T | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("config")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.value as T) : null;
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from("config")
    .upsert({ key, value: limpio(value) });
  if (error) throw error;
}

export function subscribeConfig<T>(
  key: string,
  onChange: (value: T) => void
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  getConfig<T>(key).then((v) => v != null && onChange(v));

  const channel = sb
    .channel(`config-${key}-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "config", filter: `key=eq.${key}` },
      (payload) => {
        const value = (payload.new as { value?: T } | null)?.value;
        if (value != null) onChange(value);
      }
    )
    .subscribe();

  return () => sb.removeChannel(channel);
}

export const setPreciosRemoto = (p: Precios) => setConfig("precios", p);
export const setTrabajadoresRemoto = (nombres: string[]) =>
  setConfig("trabajadores", { nombres });
// Lista de clientes (autocompletado de créditos/descuentos/adelantos).
// Autoritativa: reemplaza la lista completa. La usa SOLO la gestión de
// clientes del admin (agregar/eliminar), que es la fuente de verdad.
export const setClientesRemoto = (nombres: string[]) =>
  setConfig("clientes", { nombres });
export const setClientesDescuentoRemoto = (nombres: string[]) =>
  setConfig("clientes_descuento", { nombres });

// Agrega nombres a una lista remota de forma ADITIVA (lee, mezcla, escribe).
// Nunca pisa la lista completa, así un cliente que el admin eliminó NO se
// resucita cuando otro dispositivo (con su caché viejo) sube su lista. Solo
// los nombres realmente nuevos llegan a Supabase.
async function addNombresRemoto(key: string, nombres: string[]): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const actual = (await getConfig<{ nombres: string[] }>(key))?.nombres ?? [];
  const merged = aprenderClientes(actual, nombres);
  if (merged === actual) return; // ninguno era nuevo
  await setConfig(key, { nombres: merged });
}
export const addClientesRemoto = (nombres: string[]) =>
  addNombresRemoto("clientes", nombres);
export const addClientesDescuentoRemoto = (nombres: string[]) =>
  addNombresRemoto("clientes_descuento", nombres);
// Administradores (nombre + contraseña), gestionados por el desarrollador.
export const setAdminsRemoto = (admins: Admin[]) =>
  setConfig("admins", { admins });
// Logo de la empresa (data URL); null = volver al ícono por defecto.
export const setLogoRemoto = (dataUrl: string | null) =>
  setConfig("logo", { dataUrl });
// Datos del grifo cliente (nombre que aparece en sus reportes/PDFs), separado
// del nombre del sistema (Tanko, marca fija del software).
export const setGrifoRemoto = (nombre: string) => setConfig("grifo", { nombre });

// ===== Backups (copias de seguridad) =====
// Cada backup es una instantánea de las sesiones RECIENTES + la config en un
// momento dado. Permite recuperar datos ante errores (sobre todo los
// odómetros, continuos entre noche→mañana del día siguiente).
//
// Se crea uno automáticamente cada vez que un TURNO se completa (sus 3 islas
// cerradas) y también de forma manual. Se conservan las copias de los últimos
// DIAS_BACKUP días operativos; las de días más antiguos se podan.
export const DIAS_BACKUP = 3;

// Ventana de sesiones que guarda cada copia. El backup existe para recuperar
// odómetros/turnos recientes; la historia antigua ya la resguarda el archivado
// del servidor (pg_cron). Antes cada copia descargaba y re-subía TODA la tabla
// caliente (hasta 365 días, ~5 MB) 3 veces al día: mucho ancho de banda y
// almacenamiento duplicado. Con 7 días basta para el objetivo real del backup.
export const DIAS_SESIONES_BACKUP = 7;

export interface Backup {
  id: string;
  createdAt: number;
  dia: string;
  nota?: string; // etiqueta legible: "Turno mañana completo", "Manual"…
  sesiones: Sesion[];
  config: {
    precios?: Precios;
    trabajadores?: { nombres: string[] };
    clientes?: { nombres: string[] };
  };
}

type FilaBackup = {
  id: string;
  created_at: number;
  dia: string;
  sesiones: Sesion[];
  config: Backup["config"] & { nota?: string };
};

function backupDeFila(row: FilaBackup): Backup {
  return {
    id: row.id,
    createdAt: row.created_at,
    dia: row.dia,
    nota: row.config?.nota,
    sesiones: row.sesiones ?? [],
    config: row.config ?? {},
  };
}

export async function fetchBackups(): Promise<Backup[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("backups")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => backupDeFila(r as FilaBackup));
}

// Conserva las copias de los últimos DIAS_BACKUP días operativos distintos;
// borra las de días más antiguos (puede haber varias por día: una por turno).
async function podarBackups(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data } = await sb
    .from("backups")
    .select("id, dia")
    .order("created_at", { ascending: false });
  const filas = (data ?? []) as { id: string; dia: string }[];
  const diasRecientes: string[] = [];
  for (const f of filas) {
    if (!diasRecientes.includes(f.dia)) diasRecientes.push(f.dia);
  }
  const conservar = new Set(diasRecientes.slice(0, DIAS_BACKUP));
  const aBorrar = filas.filter((f) => !conservar.has(f.dia)).map((f) => f.id);
  if (aBorrar.length) await sb.from("backups").delete().in("id", aBorrar);
}

// Crea una copia de seguridad con el estado actual completo y poda las viejas.
// `id` determinístico (p. ej. por turno) hace la copia idempotente: al volver
// a dispararse el mismo turno, se actualiza en vez de duplicarse.
export async function crearBackup(opts?: {
  id?: string;
  dia?: string;
  nota?: string;
}): Promise<Backup | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const corte = diaMenos(diaOperativoActual(), DIAS_SESIONES_BACKUP);
  const [sesiones, precios, trabajadores, clientes] = await Promise.all([
    fetchSesionesDesde(corte),
    getConfig<Precios>("precios"),
    getConfig<{ nombres: string[] }>("trabajadores"),
    getConfig<{ nombres: string[] }>("clientes"),
  ]);
  const now = Date.now();
  const fila: FilaBackup = {
    id: opts?.id ?? `bk_manual_${now}`,
    created_at: now,
    dia: opts?.dia ?? diaOperativoActual(now),
    sesiones: limpio(sesiones),
    config: limpio({
      precios: precios ?? undefined,
      trabajadores: trabajadores ?? undefined,
      clientes: clientes ?? undefined,
      nota: opts?.nota ?? "Manual",
    }),
  };
  const { error } = await sb.from("backups").upsert(fila);
  if (error) throw error;
  await podarBackups();
  return backupDeFila(fila);
}

// Tras cerrar una isla: si con ese cierre el TURNO quedó completo (3 islas
// cerradas ese día), crea/actualiza la copia de seguridad de ese turno.
// Idempotente por id `bk_<dia>_<turno>`: si las 3 ya estaban, solo refresca.
export async function backupSiTurnoCompleto(
  dia: string,
  turno: TurnoId
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const lista = await fetchSesionesDesde(dia);
  const delDia = lista.filter((s) => diaOperativo(s) === dia);
  if (!turnoCompleto(delDia, turno)) return;
  await crearBackup({
    id: `bk_${dia}_${turno}`,
    dia,
    nota: `Turno ${turno} completo`,
  });
}

// Restaura una copia: vuelve a escribir sus sesiones (upsert) y la config.
// No borra sesiones creadas después del backup; sobrescribe las que existan.
// Flujo de recuperación recomendado: "Resetear base de datos" (no toca las
// copias) y luego "Restaurar" la copia de un punto seguro.
export async function restaurarBackup(b: Backup): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  if (b.sesiones.length) {
    const { error } = await sb.from("sesiones").upsert(b.sesiones.map(filaDeSesion));
    if (error) throw error;
  }
  if (b.config?.precios) await setConfig("precios", b.config.precios);
  if (b.config?.trabajadores) await setConfig("trabajadores", b.config.trabajadores);
  if (b.config?.clientes) await setConfig("clientes", b.config.clientes);
}

export async function deleteBackup(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("backups").delete().eq("id", id);
  if (error) throw error;
}
