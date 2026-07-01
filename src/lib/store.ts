"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  Adelanto,
  Admin,
  Balon,
  Credito,
  Descuento,
  Entrega,
  Gasto,
  OdometroValor,
  PagoElectronico,
  Permiso,
  PrecioKey,
  Precios,
  Promocion,
  Rol,
  Sesion,
  TurnoId,
} from "./types";
import { getIsla, PERMISOS_TODOS, PRECIOS_DEFAULT, TRABAJADORES_DEFAULT } from "./config";
import { aprenderClientes } from "./clientes";
import {
  diaActivoParaNuevosTurnos,
  diaOperativo,
  preciosDe,
  sesionSinTrabajador,
} from "./calc";

const TURNO_ORDEN: TurnoId[] = ["manana", "tarde", "noche"];
// Versión del esquema de cada documento de sesión en Firestore.
const SCHEMA_VERSION = 5;

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function hoy(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AuthState {
  rol: Rol;
  trabajador: string; // nombre operativo, vacío para staff
  nombre: string; // nombre a mostrar del usuario autenticado
  permisos: Permiso[]; // permisos efectivos (el dueño trae todos)
  userId?: string; // auth.uid() de Supabase (Fase 4)
  // Compat: id del admin de la lista legacy (contraseña en config). `null` =
  // contraseña maestra. En la Fase 4 el rol/permisos vienen de `profiles`.
  adminId?: string | null;
}

// Estado de sincronización con Supabase, visible en la UI operativa para que el
// trabajador/admin sepa si sus cambios están guardados en la nube.
//   conectado   → suscrito y al día, sin cambios pendientes
//   pendiente   → hay ediciones locales aún no enviadas
//   guardando   → enviando a Supabase ahora
//   guardado    → recién confirmado (muestra "último guardado")
//   sinConexion → falló el guardado / sin red
export type SyncEstado =
  | "conectando"
  | "conectado"
  | "pendiente"
  | "guardando"
  | "guardado"
  | "sinConexion";

export interface SyncState {
  estado: SyncEstado;
  ultimoGuardado: number | null; // ms epoch del último guardado confirmado
}

interface StoreState {
  auth: AuthState | null;
  sesiones: Sesion[];
  currentSesionId: string | null;
  sync: SyncState;
  setSync: (parcial: Partial<SyncState>) => void;
  precios: Precios; // precios globales (sincronizados con Firestore config/precios)
  trabajadores: string[]; // sincronizados con Firestore config/trabajadores
  clientes: string[]; // nombres de clientes de crédito, sincronizados con config/clientes
  clientesDescuento: string[]; // nombres libres usados en descuentos, sincronizados con config/clientes_descuento
  admins: Admin[]; // administradores con nombre+contraseña, sincronizados con config/admins
  logo: string | null; // logo de la empresa (data URL), sincronizado con config/logo

  setPrecios: (p: Precios) => void;
  setPrecio: (k: PrecioKey, v: number) => void;
  setTrabajadores: (t: string[]) => void;
  setClientes: (c: string[]) => void;
  setClientesDescuento: (c: string[]) => void;
  setAdmins: (a: Admin[]) => void;
  setLogo: (url: string | null) => void;
  // Aprende uno o más nombres de cliente: los agrega a la lista si no existen
  // (sin distinguir mayúsculas/acentos). Devuelve true si la lista cambió.
  aprenderClientes: (nombres: (string | undefined)[]) => boolean;
  aprenderClientesDescuento: (nombres: (string | undefined)[]) => boolean;

  loginAdmin: (adminId?: string | null) => void;
  loginTrabajador: (nombre: string) => void;
  // Fija la sesión desde un perfil de Supabase Auth (Fase 4). Fuente de verdad.
  setAuth: (a: AuthState) => void;
  logout: () => void;

  iniciarSesion: (islaId: string, turno: TurnoId) => string;
  setCurrentSesion: (id: string | null) => void;
  getCurrentSesion: () => Sesion | undefined;

  setOdometro: (mangueraId: string, valor: Partial<OdometroValor>) => void;

  addPago: (p: Omit<PagoElectronico, "id">) => void;
  updatePago: (id: string, p: Partial<PagoElectronico>) => void;
  removePago: (id: string) => void;

  addCredito: (c: Omit<Credito, "id">) => void;
  updateCredito: (id: string, c: Partial<Credito>) => void;
  removeCredito: (id: string) => void;

  addPromocion: (p: Omit<Promocion, "id">) => void;
  updatePromocion: (id: string, p: Partial<Promocion>) => void;
  removePromocion: (id: string) => void;

  addDescuento: (d: Omit<Descuento, "id">) => void;
  updateDescuento: (id: string, d: Partial<Descuento>) => void;
  removeDescuento: (id: string) => void;

  addGasto: (g: Omit<Gasto, "id">) => void;
  updateGasto: (id: string, g: Partial<Gasto>) => void;
  removeGasto: (id: string) => void;

  addAdelanto: (a: Omit<Adelanto, "id">) => void;
  updateAdelanto: (id: string, a: Partial<Adelanto>) => void;
  removeAdelanto: (id: string) => void;

  addEntrega: (e: Omit<Entrega, "id">) => void;
  updateEntrega: (id: string, e: Partial<Entrega>) => void;
  removeEntrega: (id: string) => void;

  addBalon: (b: Omit<Balon, "id">) => void;
  updateBalon: (id: string, b: Partial<Balon>) => void;
  removeBalon: (id: string) => void;

  cerrarSesion: (id: string) => void;

  // Fusiona sesiones traídas de Firestore sin pisar ediciones locales más
  // nuevas. Si se pasa `cutoff` (día operativo desde el que se consultó
  // Firestore), también elimina del caché local cualquier sesión dentro de
  // esa ventana que ya no exista remotamente — así un reset de base de
  // datos hecho desde OTRO dispositivo se refleja aquí en vez de quedar
  // "zombie" en localStorage.
  mergeRemoteSesiones: (remotas: Sesion[], cutoff?: string) => void;

  // Borra todas las sesiones (local + deja de referenciar la activa). Usado
  // por el botón "Resetear base de datos" de Configuraciones; el caller es
  // responsable de también borrar los documentos remotos en Firestore.
  resetSesiones: () => void;
}

// Busca la salida del turno anterior para la misma isla/manguera y la usa
// como entrada automática.
export function entradaAutomatica(
  sesiones: Sesion[],
  islaId: string,
  turno: TurnoId,
  mangueraId: string,
  diaActivo: string
): number {
  const idxTurno = TURNO_ORDEN.indexOf(turno);
  // Candidatas: misma isla, distintas (orden por createdAt desc)
  const previas = sesiones
    .filter((s) => s.islaId === islaId && s.odometros[mangueraId])
    .sort((a, b) => b.createdAt - a.createdAt);

  // Preferir el turno inmediatamente anterior del mismo día operativo
  // (el día "activo" del sistema, no la fecha real del reloj).
  if (idxTurno > 0) {
    const turnoPrev = TURNO_ORDEN[idxTurno - 1];
    const mismoDia = previas.find(
      (s) => s.turno === turnoPrev && diaOperativo(s) === diaActivo
    );
    if (mismoDia) return mismoDia.odometros[mangueraId].salida;
  }
  // Si no, tomar la salida más reciente registrada
  return previas[0]?.odometros[mangueraId].salida ?? 0;
}

function mutateCurrent(
  set: (fn: (s: StoreState) => Partial<StoreState>) => void,
  get: () => StoreState,
  fn: (s: Sesion) => Sesion
) {
  const id = get().currentSesionId;
  if (!id) return;
  set((state) => ({
    // Toda mutación de la sesión actual actualiza updatedAt automáticamente.
    sesiones: state.sesiones.map((s) =>
      s.id === id ? { ...fn(s), updatedAt: Date.now() } : s
    ),
  }));
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      auth: null,
      sesiones: [],
      currentSesionId: null,
      sync: { estado: "conectando", ultimoGuardado: null },
      setSync: (parcial) => set((s) => ({ sync: { ...s.sync, ...parcial } })),
      precios: { ...PRECIOS_DEFAULT },
      trabajadores: [...TRABAJADORES_DEFAULT],
      clientes: [],
      clientesDescuento: [],
      admins: [],
      logo: null,

      setPrecios: (p) => set({ precios: p }),
      setPrecio: (k, v) => set((s) => ({ precios: { ...s.precios, [k]: v } })),
      setTrabajadores: (t) => set({ trabajadores: t }),
      setClientes: (c) => set({ clientes: c }),
      setClientesDescuento: (c) => set({ clientesDescuento: c }),
      setAdmins: (a) => set({ admins: a }),
      setLogo: (url) => set({ logo: url }),
      aprenderClientes: (nombres) => {
        const actuales = get().clientes;
        const siguientes = aprenderClientes(actuales, nombres);
        if (siguientes === actuales) return false; // sin cambios
        set({ clientes: siguientes });
        return true;
      },
      aprenderClientesDescuento: (nombres) => {
        const actuales = get().clientesDescuento;
        const siguientes = aprenderClientes(actuales, nombres);
        if (siguientes === actuales) return false;
        set({ clientesDescuento: siguientes });
        return true;
      },

      loginAdmin: (adminId = null) =>
        set({
          auth: {
            rol: "admin",
            trabajador: "",
            nombre: "Administrador",
            permisos: [...PERMISOS_TODOS],
            adminId,
          },
        }),
      loginTrabajador: (nombre) =>
        set({
          auth: { rol: "trabajador", trabajador: nombre, nombre, permisos: [] },
        }),
      setAuth: (a) => set({ auth: a }),
      logout: () => set({ auth: null, currentSesionId: null }),

      iniciarSesion: (islaId, turno) => {
        const { sesiones } = get();
        // Día operativo "activo": no depende del reloj, depende de qué día
        // ya completó sus 9 turnos en los reportes (ver diaActivoParaNuevosTurnos).
        const diaActivo = diaActivoParaNuevosTurnos(sesiones);
        // ID determinístico (día+isla+turno): así es físicamente imposible
        // crear dos sesiones para el mismo turno, incluso si esta acción se
        // dispara dos veces (doble clic, dos pestañas, recarga a destiempo).
        const id = `${diaActivo}_${islaId}_${turno}`;

        const existente = sesiones.find((s) => s.id === id);
        if (existente) {
          // Si el turno existe pero está SIN trabajador asignado (p. ej. quedó
          // así tras mover al trabajador a otra isla), quien lo abre lo RECLAMA:
          // se le pone su nombre. Conserva odómetros/registros existentes.
          const { auth } = get();
          if (!existente.cerrada && sesionSinTrabajador(existente)) {
            set((st) => ({
              sesiones: st.sesiones.map((s) =>
                s.id === id
                  ? {
                      ...s,
                      trabajador: auth?.trabajador || "Admin",
                      updatedAt: Date.now(),
                    }
                  : s
              ),
              currentSesionId: id,
            }));
            return id;
          }
          // Ya existe con trabajador (activa o cerrada): se reutiliza tal cual,
          // nunca se pisa con datos nuevos en blanco.
          set({ currentSesionId: id });
          return id;
        }

        const isla = getIsla(islaId);
        const { auth, precios } = get();
        // Precio bloqueado por periodo: el PRIMER turno que se abre en este
        // día operativo para este periodo (mañana/tarde/noche) fija el precio;
        // los siguientes turnos del mismo periodo heredan ese precio en vez de
        // tomar el global del momento. Si aún no hay ninguno, este es el
        // primero y usa el precio global actual.
        const preciosPeriodo = sesiones.find(
          (s) => diaOperativo(s) === diaActivo && s.turno === turno
        )?.precios;
        const preciosTurno = preciosPeriodo ?? precios;
        const odometros: Record<string, OdometroValor> = {};
        isla?.mangueras.forEach((m) => {
          const entrada = entradaAutomatica(sesiones, islaId, turno, m.id, diaActivo);
          // La entrada se hereda de la salida del turno anterior; la salida
          // del turno nuevo arranca vacía (0) para que el operador la llene.
          odometros[m.id] = { entrada, salida: 0 };
        });
        const ahora = Date.now();
        const nueva: Sesion = {
          id,
          fecha: diaActivo,
          trabajador: auth?.trabajador || "Admin",
          islaId,
          turno,
          precios: { ...preciosTurno },
          odometros,
          pagos: [],
          creditos: [],
          promociones: [],
          descuentos: [],
          gastos: [],
          adelantos: [],
          entregas: [],
          conteos: [],
          balones: [],
          cerrada: false,
          createdAt: ahora,
          diaOperativo: diaActivo,
          updatedAt: ahora,
          schemaVersion: SCHEMA_VERSION,
        };
        set((s) => ({
          sesiones: [...s.sesiones, nueva],
          currentSesionId: nueva.id,
        }));
        return nueva.id;
      },

      setCurrentSesion: (id) => set({ currentSesionId: id }),
      getCurrentSesion: () =>
        get().sesiones.find((s) => s.id === get().currentSesionId),

      setOdometro: (mangueraId, valor) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          odometros: {
            ...s.odometros,
            [mangueraId]: { ...s.odometros[mangueraId], ...valor },
          },
        })),

      addPago: (p) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          pagos: [...s.pagos, { ...p, id: uid() }],
        })),
      updatePago: (id, p) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          pagos: s.pagos.map((x) => (x.id === id ? { ...x, ...p } : x)),
        })),
      removePago: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          pagos: s.pagos.filter((x) => x.id !== id),
        })),

      addCredito: (c) => {
        get().aprenderClientes([c.cliente]);
        mutateCurrent(set, get, (s) => ({
          ...s,
          creditos: [...s.creditos, { ...c, id: uid() }],
        }));
      },
      updateCredito: (id, c) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          creditos: s.creditos.map((x) => (x.id === id ? { ...x, ...c } : x)),
        })),
      removeCredito: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          creditos: s.creditos.filter((x) => x.id !== id),
        })),

      addPromocion: (p) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          promociones: [...s.promociones, { ...p, id: uid() }],
        })),
      updatePromocion: (id, p) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          promociones: s.promociones.map((x) =>
            x.id === id ? { ...x, ...p } : x
          ),
        })),
      removePromocion: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          promociones: s.promociones.filter((x) => x.id !== id),
        })),

      addDescuento: (d) => {
        get().aprenderClientesDescuento([d.cliente]);
        mutateCurrent(set, get, (s) => ({
          ...s,
          descuentos: [...s.descuentos, { ...d, id: uid() }],
        }));
      },
      updateDescuento: (id, d) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          descuentos: s.descuentos.map((x) =>
            x.id === id ? { ...x, ...d } : x
          ),
        })),
      removeDescuento: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          descuentos: s.descuentos.filter((x) => x.id !== id),
        })),

      addGasto: (g) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          gastos: [...s.gastos, { ...g, id: uid() }],
        })),
      updateGasto: (id, g) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          gastos: s.gastos.map((x) => (x.id === id ? { ...x, ...g } : x)),
        })),
      removeGasto: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          gastos: s.gastos.filter((x) => x.id !== id),
        })),

      addAdelanto: (a) => {
        // Los adelantos ya no usan "cliente" sino "descripcion" libre: no se
        // aprenden como clientes ni alimentan el autocompletado.
        mutateCurrent(set, get, (s) => ({
          ...s,
          adelantos: [...s.adelantos, { ...a, id: uid() }],
        }));
      },
      updateAdelanto: (id, a) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          adelantos: s.adelantos.map((x) => (x.id === id ? { ...x, ...a } : x)),
        })),
      removeAdelanto: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          adelantos: s.adelantos.filter((x) => x.id !== id),
        })),

      addEntrega: (e) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          entregas: [...s.entregas, { ...e, id: uid() }],
        })),
      updateEntrega: (id, e) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          entregas: s.entregas.map((x) => (x.id === id ? { ...x, ...e } : x)),
        })),
      removeEntrega: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          entregas: s.entregas.filter((x) => x.id !== id),
        })),

      addBalon: (b) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          balones: [...(s.balones ?? []), { ...b, id: uid() }],
        })),
      updateBalon: (id, b) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          balones: (s.balones ?? []).map((x) => (x.id === id ? { ...x, ...b } : x)),
        })),
      removeBalon: (id) =>
        mutateCurrent(set, get, (s) => ({
          ...s,
          balones: (s.balones ?? []).filter((x) => x.id !== id),
        })),

      cerrarSesion: (id) =>
        set((state) => {
          const ahora = Date.now();
          const globales = state.precios;
          return {
            sesiones: state.sesiones.map((s) =>
              s.id === id
                ? {
                    ...s,
                    // Al finalizar, el precio del turno se CONGELA con el que
                    // estaba vigente en ese momento (su snapshot, o el global
                    // como respaldo). Así un turno cerrado nunca cambia aunque
                    // el admin modifique el precio global después.
                    precios: preciosDe(s, globales),
                    cerrada: true,
                    closedAt: ahora,
                    updatedAt: ahora,
                  }
                : s
            ),
          };
        }),

      mergeRemoteSesiones: (remotas, cutoff) =>
        set((state) => {
          const activa = state.currentSesionId;
          const remotasIds = new Set(remotas.map((r) => r.id));
          // Si se conoce la ventana consultada (cutoff), las sesiones locales
          // DENTRO de esa ventana que ya no aparecen en la respuesta remota
          // se consideran borradas en Firestore (p. ej. un reset de base de
          // datos hecho desde otro dispositivo) y se eliminan del caché local.
          // La sesión activa de este dispositivo se respeta para no perder
          // una edición que aún no llegó a sincronizarse.
          const base =
            cutoff == null
              ? state.sesiones
              : state.sesiones.filter(
                  (s) =>
                    diaOperativo(s) < cutoff ||
                    remotasIds.has(s.id) ||
                    s.id === activa
                );
          const locales = new Map(base.map((s) => [s.id, s]));
          remotas.forEach((r) => {
            // El remoto gana (refleja correcciones del admin y mantiene la
            // verdad de la nube). Para la sesión activa de ESTE dispositivo
            // solo se acepta la versión remota si es MÁS NUEVA que la local:
            //  - Mientras el trabajador teclea aquí, su `updatedAt` se renueva
            //    en cada cambio, así que su versión local gana y no se pisa
            //    lo que está escribiendo.
            //  - Si dejó este equipo y siguió en otro (p. ej. PC → celular),
            //    al volver este recibe esa versión más reciente en vez de
            //    quedarse con datos viejos y pisarlos.
            const local = locales.get(r.id);
            if (r.id === activa && local && local.updatedAt >= r.updatedAt) {
              return;
            }
            locales.set(r.id, r);
          });
          return { sesiones: Array.from(locales.values()) };
        }),

      resetSesiones: () => set({ sesiones: [], currentSesionId: null }),
    }),
    {
      name: "grifo-sys",
      version: 8,
      // Los turnos (`sesiones`) y la lista de clientes (`clientes`) NO se
      // guardan en localStorage: siempre se traen frescos de Supabase al
      // abrir. Así un reset/edición hecho desde otro equipo no deja datos
      // "zombie" pegados en el caché local (p. ej. clientes ya borrados que
      // reaparecían en otra PC). En cambio SÍ se conserva `currentSesionId`
      // (solo un id) para que al recargar el trabajador vuelva automáticamente
      // a su turno abierto; si ese turno ya no existe en Supabase, no habrá
      // sesión activa y se vuelve al setup, sin mostrar datos viejos.
      partialize: (state) => {
        const { sesiones, clientes, clientesDescuento, sync, ...resto } = state;
        void sesiones;
        void clientes;
        void clientesDescuento;
        void sync;
        return resto as StoreState;
      },
      migrate: (persisted, persistedVersion) => {
        const state = persisted as StoreState;
        // v5: los turnos ya no se cachean. v6: tampoco los clientes. Se
        // descartan los que hubiera guardado una versión anterior (evita
        // datos "zombie") y se traerán frescos de Supabase.
        state.sesiones = [];
        if (persistedVersion < 5) state.currentSesionId = null;
        state.clientes = [];
        state.clientesDescuento = [];
        // v7: la auth pasó a incluir `nombre`/`permisos` (Supabase Auth). Se
        // normaliza cualquier sesión persistida antes; el AuthProvider la
        // re-deriva de Supabase al montar (fuente de verdad).
        if (state.auth) {
          const a = state.auth as Partial<AuthState>;
          state.auth = {
            rol: a.rol ?? "trabajador",
            trabajador: a.trabajador ?? "",
            nombre: a.nombre ?? a.trabajador ?? "",
            permisos: Array.isArray(a.permisos)
              ? a.permisos
              : a.rol === "trabajador"
                ? []
                : [...PERMISOS_TODOS],
            userId: a.userId,
            adminId: a.adminId,
          };
        }
        if (!state.precios) state.precios = { ...PRECIOS_DEFAULT };
        if (!state.trabajadores) state.trabajadores = [...TRABAJADORES_DEFAULT];
        if (!state.admins) state.admins = [];
        if (state.logo === undefined) state.logo = null;
        return state;
      },
    }
  )
);
