"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  addClientesDescuentoRemoto,
  crearBackup,
  deleteBackup,
  deleteSesion,
  resetPruebasCompleto,
  DIAS_BACKUP,
  fetchBackups,
  fetchSesionesDesde,
  restaurarBackup,
  setGrifoRemoto,
  setLogoRemoto,
  setPreciosRemoto,
  setClientesDescuentoRemoto,
  setClientesRemoto,
  addClientesRemoto,
  setTrabajadoresRemoto,
  subscribeSesiones,
  upsertSesion,
  type Backup,
} from "@/lib/db";
import { sincronizarCreditosSesion } from "@/lib/data/creditos";
import { entradaAutomatica, uid, useStore } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { authHeaders, logoutSupabase } from "@/lib/data/auth";
import { registrarCambioPrecio } from "@/lib/data/precios";
import {
  fetchUltimosRegistrosTanques,
  type TanqueRegistro,
} from "@/lib/data/tanques";
import { registrarAuditoria } from "@/lib/data/auditoria";
import {
  getIsla,
  ISLAS,
  PERMISOS_TODOS,
  turnoLabel,
} from "@/lib/config";
import {
  diaMenos,
  diaOperativo,
  diaOperativoActual,
  diasConAlgunaSesionCerrada,
  diasCompletos,
  islasCerradasDeTurno,
  turnosCompletosDeDia,
  turnosConAlgunaIslaCerrada,
} from "@/lib/calc";
import type { Permiso, PrecioKey, Precios, Rol, Sesion, TurnoId } from "@/lib/types";
import { cn, descargarBlob } from "@/lib/utils";
import { SesionVista } from "@/components/grifo/sesion-vista";
import { ReporteDiaVista } from "@/components/grifo/reporte-dia-vista";
import { ThemeToggle } from "@/components/theme-toggle";
import { EstadoVacio, NavLabel, SideNav } from "@/features/admin/ui-admin";
import { PreciosEditor } from "@/features/admin/precios-editor";
import { EstadisticasSistema } from "@/features/admin/estadisticas-sistema";
import { VistaMover } from "@/features/admin/vista-mover";
import { VistaUsuarios } from "@/features/admin/vista-usuarios";
import { VistaClientes } from "@/features/admin/vista-clientes";
import { VistaExportar } from "@/features/admin/vista-exportar";
import { VistaConfig } from "@/features/admin/vista-config";
import {
  Fuel,
  LogOut,
  Wifi,
  Activity,
  BarChart3,
  CalendarDays,
  Users,
  Contact,
  Download,
  Settings,
  Save,
  ArrowLeftRight,
  Wallet,
  ScrollText,
  Droplet,
} from "lucide-react";
import Link from "next/link";

// Días operativos a conservar en caliente. Un día operativo con todos sus
// registros pesa ~5–20 KB, así que un año entero de historia (~30–60 MB) cabe
// de sobra en el plan gratuito de Supabase (500 MB). Por eso conservamos un año
// completo: el historial financiero no debe borrarse a los pocos días. La poda
// real y verificada (con backup previo) conviene moverla a un cron del servidor
// (ver supabase/08-retencion-cron.sql); este límite alto es el respaldo del
// cliente para no crecer indefinidamente tras varios años sin mantenimiento.
const DIAS_A_CONSERVAR = 365;

type Vista =
  | "estadisticas"
  | "activos"
  | "reporte"
  | "mover"
  | "usuarios"
  | "clientes"
  | "exportar"
  | "config";

// Campos de una sesión que pertenecen al TRABAJADOR (se mueven con él al
// corregir la isla). Lo que NO está aquí —odómetros y precios— pertenece a la
// isla física y se queda donde está.
const CAMPOS_TRABAJADOR = [
  "pagos",
  "creditos",
  "promociones",
  "descuentos",
  "gastos",
  "adelantos",
  "entregas",
  "conteos",
  "balones",
] as const;

// Extrae el contenido del trabajador (nombre + registros) de una sesión.
function contenidoTrabajador(s: Sesion) {
  const out: Record<string, unknown> = { trabajador: s.trabajador };
  for (const k of CAMPOS_TRABAJADOR) {
    out[k] = (s as unknown as Record<string, unknown>)[k] ?? [];
  }
  return out;
}

function sesionUsaPrecio(s: Sesion, precio: PrecioKey): boolean {
  const isla = getIsla(s.islaId);
  if (!isla) return false;
  return (
    isla.productos.some((p) => p === precio) ||
    (isla.tipo === "glp" && (precio === "gasfull" || precio === "zetagas"))
  );
}

export default function AdminPage() {
  const router = useRouter();
  const auth = useStore((s) => s.auth);
  const logout = useStore((s) => s.logout);
  const precios = useStore((s) => s.precios);
  const setPrecio = useStore((s) => s.setPrecio);
  const trabajadores = useStore((s) => s.trabajadores);
  const setTrabajadoresStore = useStore((s) => s.setTrabajadores);
  const aprenderClientesStore = useStore((s) => s.aprenderClientes);
  const aprenderClientesDescuentoStore = useStore(
    (s) => s.aprenderClientesDescuento
  );
  const clientes = useStore((s) => s.clientes);
  const clientesDescuento = useStore((s) => s.clientesDescuento);
  const setClientesStore = useStore((s) => s.setClientes);
  const setClientesDescuentoStore = useStore((s) => s.setClientesDescuento);
  const logo = useStore((s) => s.logo);
  const setLogo = useStore((s) => s.setLogo);
  const nombreGrifo = useStore((s) => s.nombreGrifo);
  const setNombreGrifo = useStore((s) => s.setNombreGrifo);

  // Una sola fuente acotada y en vivo: los últimos 60 días operativos.
  // Incluye tanto los turnos activos como los días recientes para reporte/
  // export. Reemplaza a los dos onSnapshot de Firestore por una suscripción
  // Realtime de Supabase.
  const [remoteList, setRemoteList] = useState<Sesion[]>([]);
  const [vista, setVista] = useState<Vista>("estadisticas");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDia, setSelectedDia] = useState<string | null>(null);
  const [exportTurno, setExportTurno] = useState<TurnoId>("manana");
  const [exportando, setExportando] = useState(false);
  const [exportandoGeneral, setExportandoGeneral] = useState(false);
  const [exportTurnoIsla, setExportTurnoIsla] = useState<TurnoId>("manana");
  const [exportIslaId, setExportIslaId] = useState<string | null>(null);
  const [exportandoIsla, setExportandoIsla] = useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoCliente, setNuevoCliente] = useState("");
  const [tipoClientes, setTipoClientes] = useState<"credito" | "descuento">(
    "credito"
  );
  const [paginaCliente, setPaginaCliente] = useState(0);
  const [conectado, setConectado] = useState(false);
  const resetSesiones = useStore((s) => s.resetSesiones);
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  // Forzar liberación de un turno abierto (zona de pruebas): lo borra para que
  // el slot quede libre "como si no se hubiera empezado".
  const [turnoALiberar, setTurnoALiberar] = useState<Sesion | null>(null);
  const [liberando, setLiberando] = useState(false);
  // ---- Mover trabajador (corregir isla mal elegida) ----
  const [moverOrigenId, setMoverOrigenId] = useState<string | null>(null);
  const [moverDestinoIsla, setMoverDestinoIsla] = useState<string | null>(null);
  const [confirmandoMover, setConfirmandoMover] = useState(false);
  // ---- Backups (copias de seguridad) ----
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creandoBackup, setCreandoBackup] = useState(false);
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);
  const [backupARestaurar, setBackupARestaurar] = useState<Backup | null>(null);
  const [tanques, setTanques] = useState<TanqueRegistro[]>([]);
  const hydrated = useHydrated();

  // Acceso al panel: dueño, admin o encargado (staff). El trabajador no entra.
  const esStaff = (r?: Rol) => r === "dueno" || r === "admin" || r === "encargado";
  useEffect(() => {
    if (hydrated && (!auth || !esStaff(auth.rol))) router.replace("/");
  }, [hydrated, auth, router]);

  // ---- Permisos efectivos del usuario que inició sesión ----
  // Fase 4: vienen del perfil de Supabase (dueño = todos). El login legacy con
  // contraseña maestra fija `permisos = PERMISOS_TODOS`, así que esta única
  // fuente cubre ambos casos.
  const permisos: Permiso[] = useMemo(
    () => auth?.permisos ?? PERMISOS_TODOS,
    [auth?.permisos]
  );
  const can = (p: Permiso) => permisos.includes(p);
  const puedeVerEstadisticas = can("activos") || can("reporte");

  // Si la vista actual no está permitida (p. ej. tras cargar permisos), saltar
  // a la primera vista que sí lo esté. "venta-normal" no es una vista propia.
  useEffect(() => {
    if (vista === "estadisticas" && puedeVerEstadisticas) return;
    if (can(vista as Permiso)) return;
    const primera = PERMISOS_TODOS.find(
      (p) => p !== "venta-normal" && permisos.includes(p)
    );
    // Ajuste idempotente de la vista a los permisos cargados (async): patrón
    // de sincronización con datos externos, no un bucle de render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (primera) setVista(primera as Vista);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permisos, vista, puedeVerEstadisticas]);

  useEffect(() => {
    if (!hydrated || !auth || !esStaff(auth.rol) || !puedeVerEstadisticas) return;
    let vivo = true;
    fetchUltimosRegistrosTanques()
      .then((rows) => {
        if (vivo) setTanques(rows);
      })
      .catch(() => {
        if (vivo) setTanques([]);
      });
    return () => {
      vivo = false;
    };
  }, [hydrated, auth, puedeVerEstadisticas]);

  // Suscripción en vivo a los últimos 60 días operativos (turnos activos +
  // días recientes para reporte/export), vía Supabase Realtime.
  useEffect(() => {
    if (!hydrated || !auth || !esStaff(auth.rol)) return;
    const corte = diaMenos(diaOperativoActual(), 60);
    const aplicar = (lista: Sesion[]) => {
      setRemoteList(lista);
      setConectado(true);
    };
    const refetch = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        aplicar(await fetchSesionesDesde(corte));
      } catch {
        setConectado(false);
      }
    };
    const unsub = subscribeSesiones(corte, (lista) => {
      aplicar(lista);
    });
    // Realtime ya refresca ante cada cambio; este sondeo es solo un respaldo
    // por si el canal se cae. A 30s (antes 3s) reduce ~10x el consumo de ancho
    // de banda del plan gratuito con el panel abierto todo el día.
    const poll = setInterval(refetch, 30000);
    return () => {
      clearInterval(poll);
      unsub();
    };
  }, [hydrated, auth]);

  const remote = remoteList;

  const activos = useMemo(
    () => remote.filter((s) => !s.cerrada).sort((a, b) => b.createdAt - a.createdAt),
    [remote]
  );
  // "Ver reporte por finalización" (en vivo): con el permiso, el día aparece a
  // medida que van cerrando los turnos (progreso parcial). Sin él, solo cuando
  // el día completo cerró (mañana, tarde y noche × 3 islas). Afecta tanto
  // "Reporte del día" como "Exportar" (comparten esta lista). El dueño siempre
  // lo ve en vivo (tiene todos los permisos).
  const reporteEnVivo = can("reporte-en-vivo");
  const dias = useMemo(
    () =>
      reporteEnVivo
        ? diasConAlgunaSesionCerrada(remote)
        : diasCompletos(remote),
    [remote, reporteEnVivo]
  );
  // Turnos ya completos del día seleccionado (para exportar por turno, 3 islas).
  const turnosListos = useMemo(
    () => (selectedDia ? turnosCompletosDeDia(remote, selectedDia) : []),
    [remote, selectedDia]
  );
  // Turnos con AL MENOS una isla cerrada (para exportar por isla individual).
  const turnosConIsla = useMemo(
    () => (selectedDia ? turnosConAlgunaIslaCerrada(remote.filter((s) => diaOperativo(s) === selectedDia)) : []),
    [remote, selectedDia]
  );

  // Los siguientes efectos SINCRONIZAN la selección por defecto con las listas
  // que llegan de Supabase (async). Son idempotentes (solo actúan si la
  // selección actual dejó de ser válida), no bucles de render; por eso se
  // exime la regla set-state-in-effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedId && activos.length) setSelectedId(activos[0].id);
  }, [activos, selectedId]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedDia && dias.length) setSelectedDia(dias[0]);
  }, [dias, selectedDia]);
  // Asegura que el turno a exportar sea uno que esté completo.
  useEffect(() => {
    if (turnosListos.length && !turnosListos.includes(exportTurno)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExportTurno(turnosListos[0]);
    }
  }, [turnosListos, exportTurno]);
  // Asegura que el turno/isla del export individual sean válidos.
  useEffect(() => {
    if (turnosConIsla.length && !turnosConIsla.includes(exportTurnoIsla)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExportTurnoIsla(turnosConIsla[0]);
    }
  }, [turnosConIsla, exportTurnoIsla]);

  const seleccionada = remote.find((s) => s.id === selectedId);
  const delDia = useMemo(
    () => remote.filter((s) => diaOperativo(s) === selectedDia),
    [remote, selectedDia]
  );
  // Islas con sesión cerrada para el turno del export individual.
  const islasCerradasTurnoIsla = useMemo(
    () => islasCerradasDeTurno(delDia, exportTurnoIsla),
    [delDia, exportTurnoIsla]
  );
  useEffect(() => {
    if (islasCerradasTurnoIsla.length && !islasCerradasTurnoIsla.includes(exportIslaId ?? "")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExportIslaId(islasCerradasTurnoIsla[0]);
    } else if (!islasCerradasTurnoIsla.length) {
      setExportIslaId(null);
    }
  }, [islasCerradasTurnoIsla, exportIslaId]);

  // ---- Retención: conservar solo los últimos DIAS_A_CONSERVAR días
  // COMPLETOS (9 turnos cerrados). Los más antiguos se borran solos en
  // Firestore (y de la vista local) en cuanto aparece un día completo de más.
  useEffect(() => {
    const completos = diasCompletos(remote); // más reciente primero
    if (completos.length <= DIAS_A_CONSERVAR) return;
    const diasABorrar = new Set(completos.slice(DIAS_A_CONSERVAR));
    const aBorrar = remote.filter((s) => diasABorrar.has(diaOperativo(s)));
    if (!aBorrar.length) return;
    aBorrar.forEach((s) => deleteSesion(s.id).catch(() => {}));
    const idsBorrados = new Set(aBorrar.map((s) => s.id));
    // Poda de retención: refleja localmente lo que se borró en Supabase.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemoteList((prev) => prev.filter((s) => !idsBorrados.has(s.id)));
  }, [remote]);

  // ---- Persistencia de ediciones del admin ----
  // Actualiza primero localmente (optimista) para que la UI responda al instante
  // mientras el guardado en Firestore viaja de ida y vuelta (onSnapshot tardaría
  // y el input "se resetearía" entre cada tecla si solo dependiéramos de eso).
  function persist(updated: Sesion) {
    // Optimista en la lista local; el documento remoto se actualiza en upsert.
    setRemoteList((prev) =>
      prev.map((s) => (s.id === updated.id ? updated : s))
    );
    upsertSesion(updated).catch(() => {});
    // Corregir un turno YA CERRADO es una acción sensible: se audita
    // (debounced por sesión, para no registrar una entrada por tecla mientras
    // se edita un campo numérico).
    if (updated.cerrada) auditarEdicionCerrada(updated);
  }
  // Debounce por id de sesión: acumula las ediciones de un turno cerrado y
  // registra UNA entrada de auditoría cuando el admin deja de escribir.
  const auditTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  function auditarEdicionCerrada(s: Sesion) {
    const prev = auditTimers.current[s.id];
    if (prev) clearTimeout(prev);
    auditTimers.current[s.id] = setTimeout(() => {
      delete auditTimers.current[s.id];
      registrarAuditoria({
        accion: "edicion_sesion",
        entidad: "turno",
        entidadId: s.id,
        actorId: auth?.userId,
        actorNombre: auth?.nombre,
        detalle: {
          correccion: "turno_cerrado",
          dia: s.diaOperativo,
          isla: s.islaId,
          turno: s.turno,
        },
      });
    }, 2500);
  }
  function onChangePrecio(
    k: PrecioKey,
    v: number,
    opts?: { motivo?: string; aplica?: "proximo" | "activo" }
  ) {
    const anterior = precios[k] ?? null;
    if (v === anterior) return; // sin cambio real: no tocar historial
    setPrecio(k, v);
    setPreciosRemoto({ ...precios, [k]: v }).catch(() => {});
    if ((opts?.aplica ?? "proximo") === "activo") {
      const ahora = Date.now();
      const afectadas = remoteList
        .filter((s) => !s.cerrada && sesionUsaPrecio(s, k))
        .map((s) => ({
          ...s,
          precios: { ...s.precios, [k]: v },
          updatedAt: ahora,
        }));
      if (afectadas.length) {
        const porId = new Map(afectadas.map((s) => [s.id, s]));
        setRemoteList((prev) => prev.map((s) => porId.get(s.id) ?? s));
        Promise.all(afectadas.map((s) => upsertSesion(s).catch(() => {}))).catch(
          () => {}
        );
      }
    }
    // Historial de precios (Fase 5): cada cambio queda con quién/cuándo/por qué.
    // Si `aplica: 'activo'`, los turnos abiertos afectados reciben el nuevo
    // precio en su snapshot y el trabajador ve el cambio en vivo.
    registrarCambioPrecio({
      producto: k,
      precioAnterior: anterior,
      precioNuevo: v,
      aplica: opts?.aplica ?? "proximo",
      motivo: opts?.motivo,
      actorId: auth?.userId,
      actorNombre: auth?.nombre,
    });
    registrarAuditoria({
      accion: "cambio_precio",
      entidad: "precio",
      entidadId: k,
      actorId: auth?.userId,
      actorNombre: auth?.nombre,
      detalle: { producto: k, anterior, nuevo: v, aplica: opts?.aplica ?? "proximo" },
    });
  }
  // Corrige el precio de un turno y lo propaga a TODOS los turnos del mismo
  // periodo (mañana/tarde/noche) de ese día operativo, para mantener el precio
  // bloqueado por periodo consistente. Actualiza local (optimista) y remoto.
  async function guardarPreciosPeriodo(base: Sesion, nuevos: Precios) {
    const dia = diaOperativo(base);
    const afectadas = remote.filter(
      (s) => diaOperativo(s) === dia && s.turno === base.turno
    );
    const ahora = Date.now();
    const actualizadas = afectadas.map((s) => ({
      ...s,
      precios: nuevos,
      updatedAt: ahora,
    }));
    setRemoteList((prev) =>
      prev.map((s) => actualizadas.find((u) => u.id === s.id) ?? s)
    );
    await Promise.all(actualizadas.map((s) => upsertSesion(s).catch(() => {})));
    registrarAuditoria({
      accion: "edicion_sesion",
      entidad: "turno",
      entidadId: base.id,
      actorId: auth?.userId,
      actorNombre: auth?.nombre,
      detalle: { correccion: "precios_periodo", dia, turno: base.turno, precios: nuevos },
    });
    toast.success(
      `Precio actualizado en ${actualizadas.length} turno(s) de ${turnoLabel(
        base.turno
      )}`
    );
  }

  // ---- Gestión de usuarios (trabajadores) ----
  function persistTrabajadores(nombres: string[]) {
    setTrabajadoresStore(nombres);
    setTrabajadoresRemoto(nombres).catch(() => {});
  }
  function agregarTrabajador() {
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    if (trabajadores.some((t) => t.toLowerCase() === nombre.toLowerCase())) return;
    persistTrabajadores([...trabajadores, nombre]);
    setNuevoNombre("");
  }
  function quitarTrabajador(nombre: string) {
    persistTrabajadores(trabajadores.filter((t) => t !== nombre));
  }

  // ---- Forzar liberación de un turno abierto (zona de pruebas) ----
  // Borra la sesión del turno para que el slot quede LIBRE, como si nunca se
  // hubiera empezado; así otro trabajador puede volver a tomarlo. Solo aplica a
  // turnos NO cerrados (los cerrados ya cuentan en los reportes).
  async function liberarTurno(s: Sesion) {
    setLiberando(true);
    try {
      await deleteSesion(s.id);
      setRemoteList((prev) => prev.filter((x) => x.id !== s.id));
      registrarAuditoria({
        accion: "edicion_sesion",
        entidad: "turno",
        entidadId: s.id,
        actorId: auth?.userId,
        actorNombre: auth?.nombre,
        detalle: {
          correccion: "turno_liberado",
          dia: s.diaOperativo,
          isla: s.islaId,
          turno: s.turno,
          trabajador: s.trabajador,
        },
      });
      toast.success("Turno liberado: el slot quedó disponible");
    } catch {
      toast.error("No se pudo liberar el turno");
    } finally {
      setLiberando(false);
      setTurnoALiberar(null);
    }
  }

  // ---- Logo de la empresa ----
  function onSubirLogo(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("El archivo debe ser una imagen");
      return;
    }
    if (file.size > 500 * 1024) {
      toast.error("La imagen es muy pesada (máx. 500 KB)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      setLogo(dataUrl);
      setLogoRemoto(dataUrl).catch(() => {});
      toast.success("Logo actualizado");
    };
    reader.onerror = () => toast.error("No se pudo leer la imagen");
    reader.readAsDataURL(file);
  }
  function quitarLogo() {
    setLogo(null);
    setLogoRemoto(null).catch(() => {});
    toast.success("Logo restablecido");
  }

  // ---- Nombre del grifo (aparece en los reportes/PDFs del cliente) ----
  // El input es de edición local; cuando el valor remoto (sincronizado por
  // Realtime) cambia, se re-siembra el input durante el render en vez de con un
  // efecto (evita el render en cascada que marca react-hooks/set-state-in-effect).
  const [nombreGrifoLocal, setNombreGrifoLocal] = useState(nombreGrifo);
  const [nombreGrifoPrev, setNombreGrifoPrev] = useState(nombreGrifo);
  if (nombreGrifo !== nombreGrifoPrev) {
    setNombreGrifoPrev(nombreGrifo);
    setNombreGrifoLocal(nombreGrifo);
  }
  function guardarNombreGrifo() {
    const nombre = nombreGrifoLocal.trim();
    if (!nombre || nombre === nombreGrifo) {
      setNombreGrifoLocal(nombreGrifo);
      return;
    }
    setNombreGrifo(nombre);
    setGrifoRemoto(nombre).catch(() => {});
    toast.success("Nombre del grifo actualizado");
  }

  // ---- Exportar reporte a Excel (plantilla por isla) ----
  async function descargarXlsx() {
    if (!selectedDia) return;
    const sesionesTurno = delDia.filter((s) => s.turno === exportTurno);
    setExportando(true);
    try {
      const res = await fetch("/api/export-isla", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          dia: selectedDia,
          turno: exportTurno,
          sesiones: sesionesTurno,
          precios,
        }),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      descargarBlob(blob, `reporte_${selectedDia}_${exportTurno}.xlsx`);
    } catch {
      toast.error("No se pudo generar el Excel");
    } finally {
      setExportando(false);
    }
  }

  // ---- Exportar reporte de UNA isla individual (no requiere que las 3
  // islas del turno hayan terminado, solo que esa isla en particular cerró).
  async function descargarXlsxIsla() {
    if (!selectedDia || !exportIslaId) return;
    const sesionIsla = delDia.filter(
      (s) => s.turno === exportTurnoIsla && s.islaId === exportIslaId
    );
    setExportandoIsla(true);
    try {
      const res = await fetch("/api/export-isla", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          dia: selectedDia,
          turno: exportTurnoIsla,
          sesiones: sesionIsla,
          precios,
        }),
      });
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const islaNombre = ISLAS.find((i) => i.id === exportIslaId)?.nombre ?? exportIslaId;
      descargarBlob(blob, `reporte_${selectedDia}_${exportTurnoIsla}_${islaNombre}.xlsx`);
    } catch {
      toast.error("No se pudo generar el Excel de la isla");
    } finally {
      setExportandoIsla(false);
    }
  }

  // ---- Resetear toda la base de datos (Configuraciones, solo pruebas) ----
  // Borra TODO (turnos, créditos, pagos, clientes, historial de precios,
  // auditoría) y deja el sistema de cero, conservando SOLO las copias de
  // seguridad, las cuentas de usuario y la configuración (precios/trabajadores).
  async function resetBaseDatos() {
    setReseteando(true);
    try {
      await resetPruebasCompleto();
      resetSesiones();
      setClientesStore([]);
      setClientesDescuentoStore([]);
      setRemoteList([]);
      setSelectedId(null);
      setSelectedDia(null);
      toast.success("Sistema reseteado: sin datos, listo para probar de cero");
    } catch (e) {
      console.error("reset:", e);
      toast.error("No se pudo resetear la base de datos");
    } finally {
      setReseteando(false);
      setConfirmandoReset(false);
    }
  }

  // ---- Backups (copias de seguridad, máx 3) ----
  const refrescarBackups = async () => {
    try {
      setBackups(await fetchBackups());
    } catch {
      /* silencioso: la lista conserva su último estado */
    }
  };
  // Carga la lista de copias al conectar. La creación es automática al
  // completarse cada turno (desde el cierre del trabajador) y también manual.
  useEffect(() => {
    if (!conectado) return;
    let vivo = true;
    fetchBackups()
      .then((b) => vivo && setBackups(b))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [conectado]);

  async function backupManual() {
    setCreandoBackup(true);
    try {
      await crearBackup();
      await refrescarBackups();
      toast.success("Copia de seguridad creada");
    } catch {
      toast.error("No se pudo crear la copia de seguridad");
    } finally {
      setCreandoBackup(false);
    }
  }

  async function confirmarRestaurar() {
    if (!backupARestaurar) return;
    setRestaurandoId(backupARestaurar.id);
    try {
      await restaurarBackup(backupARestaurar);
      toast.success("Datos restaurados desde la copia de seguridad");
    } catch {
      toast.error("No se pudo restaurar la copia");
    } finally {
      setRestaurandoId(null);
      setBackupARestaurar(null);
    }
  }

  async function eliminarBackup(id: string) {
    try {
      await deleteBackup(id);
      await refrescarBackups();
      toast.success("Copia eliminada");
    } catch {
      toast.error("No se pudo eliminar la copia");
    }
  }

  function descargarBackup(b: Backup) {
    const blob = new Blob([JSON.stringify(b, null, 2)], {
      type: "application/json",
    });
    descargarBlob(blob, `backup_grifosys_${b.dia}_${b.id}.json`);
  }

  // ---- Exportar reporte GENERAL del día (plantilla "madre") ----
  async function descargarGeneral() {
    if (!selectedDia) return;
    setExportandoGeneral(true);
    try {
      const res = await fetch("/api/export-general", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ dia: selectedDia, sesiones: delDia, precios }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error || "No se pudo generar el reporte general");
        return;
      }
      const blob = await res.blob();
      descargarBlob(blob, `reporte_general_${selectedDia}.xlsx`);
    } catch {
      toast.error("No se pudo generar el reporte general");
    } finally {
      setExportandoGeneral(false);
    }
  }

  function onUpdateRegistro(
    sesionId: string,
    tipo: string,
    rowId: string,
    patch: Record<string, unknown>
  ) {
    const s = remote.find((x) => x.id === sesionId);
    if (!s) return;
    const arr = ((s as unknown as Record<string, { id: string }[]>)[tipo] || []).map(
      (r) => (r.id === rowId ? { ...r, ...patch } : r)
    );
    const updated = { ...s, [tipo]: arr };
    persist(updated);
    sincronizarCreditosEditados(updated, tipo);
    aprenderCliente(patch.cliente, tipo);
  }
  function onRemoveRegistro(sesionId: string, tipo: string, rowId: string) {
    const s = remote.find((x) => x.id === sesionId);
    if (!s) return;
    const arr = ((s as unknown as Record<string, { id: string }[]>)[tipo] || []).filter(
      (r) => r.id !== rowId
    );
    const updated = { ...s, [tipo]: arr };
    persist(updated);
    sincronizarCreditosEditados(updated, tipo);
  }
  // El admin agrega un registro que el trabajador olvidó anotar (p. ej. un
  // pago, un crédito) directamente desde "Reporte del día".
  function onAddRegistro(sesionId: string, tipo: string, row: Record<string, unknown>) {
    const s = remote.find((x) => x.id === sesionId);
    if (!s) return;
    const arr = [
      ...((s as unknown as Record<string, { id: string }[]>)[tipo] ?? []),
      { ...row, id: uid() },
    ];
    const updated = { ...s, [tipo]: arr };
    persist(updated);
    sincronizarCreditosEditados(updated, tipo);
    aprenderCliente(row.cliente, tipo);
  }
  // El admin escribe nombres de cliente nuevos al registrar/editar créditos,
  // descuentos o adelantos: se aprenden en la base de clientes y se sincronizan
  // (igual que cuando el trabajador los anota desde su turno).
  function sincronizarCreditosEditados(sesion: Sesion, tipo: string) {
    if (tipo !== "creditos" || !sesion.cerrada) return;
    sincronizarCreditosSesion(sesion).catch((e) => {
      console.error("No se pudo sincronizar créditos editados:", e);
      toast.error("El crédito se guardó en el turno, pero no se sincronizó con clientes");
    });
  }

  function aprenderCliente(nombre: unknown, tipo: string = "creditos") {
    if (typeof nombre !== "string" || !nombre.trim()) return;
    if (tipo === "descuentos") {
      if (aprenderClientesDescuentoStore([nombre])) {
        addClientesDescuentoRemoto([nombre]).catch(() => {});
      }
      return;
    }
    // Aditivo: solo agrega el nombre nuevo a la lista remota, nunca pisa la
    // lista completa (así no resucita clientes que el admin ya eliminó).
    if (aprenderClientesStore([nombre])) {
      addClientesRemoto([nombre]).catch(() => {});
    }
  }
  // ---- Gestión de la lista de clientes (autocompletado) ----
  function persistClientes(
    lista: string[],
    tipo: "credito" | "descuento" = tipoClientes
  ) {
    if (tipo === "descuento") {
      setClientesDescuentoStore(lista);
      setClientesDescuentoRemoto(lista).catch(() => {});
      return;
    }
    setClientesStore(lista);
    setClientesRemoto(lista).catch(() => {});
  }
  function agregarCliente() {
    const nombre = nuevoCliente.trim().toUpperCase();
    if (!nombre) return;
    const lista = tipoClientes === "descuento" ? clientesDescuento : clientes;
    if (lista.some((c) => c.toUpperCase() === nombre)) {
      setNuevoCliente("");
      return;
    }
    persistClientes([...lista, nombre]);
    setNuevoCliente("");
  }
  function quitarCliente(nombre: string) {
    const lista = tipoClientes === "descuento" ? clientesDescuento : clientes;
    persistClientes(lista.filter((c) => c !== nombre));
  }
  function onUpdateOdometro(
    sesionId: string,
    mangueraId: string,
    patch: { entrada?: number; salida?: number }
  ) {
    const s = remote.find((x) => x.id === sesionId);
    if (!s) return;
    const od = {
      ...s.odometros,
      [mangueraId]: { ...s.odometros[mangueraId], ...patch },
    };
    persist({ ...s, odometros: od });
  }
  // El admin fija/corrige el precio de un turno: reemplaza el snapshot de
  // precios de esa sesión (cada turno se valoriza con su propio precio).
  function onSetPreciosSesion(sesionId: string, nuevosPrecios: Precios) {
    const s = remote.find((x) => x.id === sesionId);
    if (!s) return;
    persist({ ...s, precios: nuevosPrecios });
  }

  function abrirIsla(islaId: string) {
    const s = activos.find((x) => x.islaId === islaId);
    if (s) setSelectedId(s.id);
  }

  // ---- Mover trabajador a la isla correcta ----
  // Mueve el nombre y TODOS sus registros (pagos, créditos, ventas, gastos…) a
  // la isla destino. Los odómetros NO se mueven: pertenecen a la isla física y
  // se quedan donde están (continuos turno a turno). Funciona en dos casos:
  //   • Intercambio: la isla destino ya tiene a otro trabajador ese turno → se
  //     intercambian (cada uno conserva el odómetro de su isla).
  //   • Mover a isla libre: la isla destino no tiene sesión ese turno → se crea
  //     una con el odómetro propio de esa isla y la de origen queda sin asignar.
  const moverOrigen = remote.find((s) => s.id === moverOrigenId) ?? null;
  const moverDestinoId =
    moverOrigen && moverDestinoIsla
      ? `${diaOperativo(moverOrigen)}_${moverDestinoIsla}_${moverOrigen.turno}`
      : null;
  const moverDestino = moverDestinoId
    ? remote.find((s) => s.id === moverDestinoId) ?? null
    : null;
  // Islas válidas como destino: mismo tipo (líquido/GLP) y distintas a la de
  // origen, para no mezclar productos/balones incompatibles.
  const islasDestino = moverOrigen
    ? ISLAS.filter(
        (i) =>
          i.id !== moverOrigen.islaId &&
          i.tipo === getIsla(moverOrigen.islaId)?.tipo
      )
    : [];
  const destinoCerrado = !!moverDestino?.cerrada;

  async function moverTrabajador() {
    if (!moverOrigen || !moverDestinoIsla) return;
    if (destinoCerrado) {
      toast.error("La isla destino ya cerró su turno; no se puede mover.");
      return;
    }
    const dia = diaOperativo(moverOrigen);
    const turno = moverOrigen.turno;
    const ahora = Date.now();
    const islaOrigenNom = getIsla(moverOrigen.islaId)?.nombre ?? moverOrigen.islaId;
    const islaDestNom = getIsla(moverDestinoIsla)?.nombre ?? moverDestinoIsla;

    if (moverDestino) {
      // Intercambio: cada sesión conserva su odómetro y precios; se cruzan
      // nombre + registros.
      const nuevoOrigen = {
        ...moverOrigen,
        ...contenidoTrabajador(moverDestino),
        updatedAt: ahora,
      } as Sesion;
      const nuevoDestino = {
        ...moverDestino,
        ...contenidoTrabajador(moverOrigen),
        updatedAt: ahora,
      } as Sesion;
      setRemoteList((prev) =>
        prev.map((s) =>
          s.id === nuevoOrigen.id
            ? nuevoOrigen
            : s.id === nuevoDestino.id
            ? nuevoDestino
            : s
        )
      );
      upsertSesion(nuevoOrigen).catch(() => {});
      upsertSesion(nuevoDestino).catch(() => {});
      toast.success(
        `Intercambiados: ${moverOrigen.trabajador} → ${islaDestNom}, ${moverDestino.trabajador} → ${islaOrigenNom}`
      );
    } else {
      // Mover a isla libre: se crea la sesión destino con el odómetro propio de
      // esa isla (heredado del turno anterior) y la sesión de origen se ELIMINA
      // por completo: como el trabajador nunca trabajó ahí, ese turno queda como
      // si nunca se hubiera abierto. El odómetro de la isla origen no se rompe:
      // el próximo turno hereda la última salida real (anterior a este error).
      const isla = getIsla(moverDestinoIsla);
      if (!isla) return;
      const odometros: Record<string, { entrada: number; salida: number }> = {};
      isla.mangueras.forEach((m) => {
        odometros[m.id] = {
          entrada: entradaAutomatica(remote, moverDestinoIsla, turno, m.id, dia),
          salida: 0,
        };
      });
      const preciosPeriodo =
        remote.find((s) => diaOperativo(s) === dia && s.turno === turno)
          ?.precios ?? precios;
      const nuevoDestino = {
        id: moverDestinoId!,
        fecha: dia,
        islaId: moverDestinoIsla,
        turno,
        precios: { ...preciosPeriodo },
        odometros,
        ...contenidoTrabajador(moverOrigen),
        cerrada: false,
        createdAt: ahora,
        diaOperativo: dia,
        updatedAt: ahora,
        schemaVersion: moverOrigen.schemaVersion,
      } as Sesion;
      setRemoteList((prev) => [
        ...prev.filter((s) => s.id !== moverOrigen.id),
        nuevoDestino,
      ]);
      upsertSesion(nuevoDestino).catch(() => {});
      deleteSesion(moverOrigen.id).catch(() => {});
      toast.success(
        `${moverOrigen.trabajador} movido de ${islaOrigenNom} a ${islaDestNom}`
      );
    }
    setConfirmandoMover(false);
    setMoverOrigenId(null);
    setMoverDestinoIsla(null);
  }

  if (!hydrated || !auth || !esStaff(auth.rol)) return null;

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-background to-muted/40">
      {/* Header */}
      <header className="gs-topbar flex items-center gap-3 border-b border-white/10 px-4 py-2.5 text-white">
        <div className="flex min-w-0 shrink items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-amber-400 to-green-700 animate-pulse-ring">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <Fuel className="h-5 w-5 text-white" />
            )}
          </span>
          <span className="shrink-0 text-lg font-bold">Tanko</span>
          <span className="hidden shrink-0 rounded bg-white/10 px-2 py-0.5 text-xs font-medium sm:inline">
            Administrador
          </span>
          <span
            className={cn(
              "ml-1 hidden shrink-0 items-center gap-1 text-xs transition-colors md:flex",
              conectado ? "text-emerald-400" : "text-slate-400"
            )}
          >
            <Wifi className={cn("h-3.5 w-3.5", !conectado && "animate-pulse")} />
            {conectado ? "Tiempo real" : "Conectando…"}
          </span>
        </div>

        {/* Recordatorio fijo (antes en movimiento): solo en pantallas anchas
            para no chocar con las acciones de la derecha. */}
        <div className="mx-2 hidden min-w-0 flex-1 justify-center xl:flex">
          <span className="flex min-w-0 items-center gap-2 truncate rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300/90 ring-1 ring-amber-400/20">
            <Save className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              Descarga y guarda los reportes en tu PC — el historial se conserva
              en la nube por 1 año.
            </span>
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {auth?.rol === "dueno" && (
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-white hover:bg-white/10"
            >
              <Users className="h-4 w-4" /> Usuarios
            </Link>
          )}
          <PreciosEditor
            precios={precios}
            onChange={onChangePrecio}
            puedeVerHistorial={auth?.permisos?.includes("precios-historial")}
          />
          <ThemeToggle />
          <Button
            size="sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            onClick={async () => {
              await logoutSupabase();
              logout();
              router.replace("/");
            }}
          >
            <LogOut className="mr-1 h-4 w-4" /> Salir
          </Button>
        </div>
      </header>

      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r bg-sidebar p-3">
          <nav className="mb-3 space-y-1">
            {(can("activos") || can("reporte")) && <NavLabel>Operación</NavLabel>}
            {puedeVerEstadisticas && (
              <SideNav
                activo={vista === "estadisticas"}
                onClick={() => setVista("estadisticas")}
                icon={<BarChart3 className="h-4 w-4" />}
                label="Estadisticas"
              />
            )}
            {can("activos") && (
              <SideNav
                activo={vista === "activos"}
                onClick={() => setVista("activos")}
                icon={<Activity className="h-4 w-4" />}
                label="Turnos activos"
              />
            )}
            {can("reporte") && (
              <SideNav
                activo={vista === "reporte"}
                onClick={() => setVista("reporte")}
                icon={<CalendarDays className="h-4 w-4" />}
                label="Reporte del día"
              />
            )}
            {(can("mover") || can("usuarios")) && <NavLabel>Personal</NavLabel>}
            {can("mover") && (
              <SideNav
                activo={vista === "mover"}
                onClick={() => setVista("mover")}
                icon={<ArrowLeftRight className="h-4 w-4" />}
                label="Mover trabajador"
              />
            )}
            {can("usuarios") && (
              <SideNav
                activo={vista === "usuarios"}
                onClick={() => setVista("usuarios")}
                icon={<Users className="h-4 w-4" />}
                label="Usuarios"
              />
            )}
            {(can("clientes") || can("creditos")) && <NavLabel>Créditos</NavLabel>}
            {can("clientes") && (
              <SideNav
                activo={vista === "clientes"}
                onClick={() => setVista("clientes")}
                icon={<Contact className="h-4 w-4" />}
                label="Clientes"
              />
            )}
            {can("creditos") && (
              <Link
                href="/admin/creditos"
                className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:translate-x-0.5 hover:bg-accent"
              >
                <span className="transition-transform duration-200 group-hover:scale-110">
                  <Wallet className="h-4 w-4" />
                </span>
                Créditos por cliente
              </Link>
            )}
            {(can("exportar") || can("config") || can("auditoria") || can("inventario")) && (
              <NavLabel>Sistema</NavLabel>
            )}
            {can("exportar") && (
              <SideNav
                activo={vista === "exportar"}
                onClick={() => setVista("exportar")}
                icon={<Download className="h-4 w-4" />}
                label="Exportar"
              />
            )}
            {can("config") && (
              <SideNav
                activo={vista === "config"}
                onClick={() => setVista("config")}
                icon={<Settings className="h-4 w-4" />}
                label="Configuraciones"
              />
            )}
            {can("auditoria") && (
              <Link
                href="/admin/auditoria"
                className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:translate-x-0.5 hover:bg-accent"
              >
                <span className="transition-transform duration-200 group-hover:scale-110">
                  <ScrollText className="h-4 w-4" />
                </span>
                Auditoría
              </Link>
            )}
            {can("inventario") && (
              <Link
                href="/admin/inventario"
                className="group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium text-foreground transition-all duration-200 hover:translate-x-0.5 hover:bg-accent"
              >
                <span className="transition-transform duration-200 group-hover:scale-110">
                  <Droplet className="h-4 w-4" />
                </span>
                Inventario de Tanques
              </Link>
            )}
          </nav>

          {vista === "activos" ? (
            <div className="space-y-2">
              <h2 className="text-[11px] font-bold tracking-wide text-muted-foreground">
                EN CURSO
              </h2>
              {activos.length === 0 && (
                <p className="text-xs text-muted-foreground">No hay turnos activos.</p>
              )}
              {activos.map((s, i) => {
                const isla = ISLAS.find((i) => i.id === s.islaId);
                return (
                  <button
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    style={{ animationDelay: `${i * 50}ms` }}
                    className={cn(
                      "w-full animate-fade-up rounded-lg border p-2 text-left text-xs card-lift hover:bg-accent",
                      selectedId === s.id && "border-primary bg-accent ring-1 ring-primary"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{isla?.nombre}</span>
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                    </div>
                    <div className="text-muted-foreground">
                      {turnoLabel(s.turno)} · {s.trabajador}
                    </div>
                  </button>
                );
              })}
            </div>
          ) : vista === "reporte" || vista === "exportar" ? (
            <div className="space-y-2">
              <h2 className="text-[11px] font-bold tracking-wide text-muted-foreground">
                DÍAS FINALIZADOS
              </h2>
              {dias.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {reporteEnVivo
                    ? "Aún no hay ningún turno finalizado."
                    : "Aún no hay un día con todos sus turnos (mañana, tarde y noche) finalizados."}
                </p>
              )}
              {dias.map((d, i) => (
                <button
                  key={d}
                  onClick={() => setSelectedDia(d)}
                  style={{ animationDelay: `${i * 50}ms` }}
                  className={cn(
                    "w-full animate-fade-up rounded-lg border p-2 text-left text-xs card-lift hover:bg-accent",
                    selectedDia === d && "border-primary bg-accent ring-1 ring-primary"
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 shrink-0" /> {d}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        {/* Contenido */}
        <main className="flex-1 p-3">
          {vista === "estadisticas" ? (
            <EstadisticasSistema
              remote={remote}
              precios={precios}
              activos={activos.length}
              tanques={tanques}
            />
          ) : vista === "activos" ? (
            <>
              <div className="mb-3 flex gap-2">
                {ISLAS.map((isla) => {
                  const activa = activos.find((s) => s.islaId === isla.id);
                  const activoTab = seleccionada?.islaId === isla.id;
                  return (
                    <button
                      key={isla.id}
                      onClick={() => abrirIsla(isla.id)}
                      disabled={!activa}
                      className={cn(
                        "rounded-lg border px-4 py-1.5 text-sm font-medium transition-all",
                        activa ? "hover:bg-accent" : "cursor-not-allowed opacity-40",
                        activoTab && "border-primary bg-primary text-primary-foreground"
                      )}
                    >
                      {isla.nombre}
                    </button>
                  );
                })}
              </div>
              <div className="rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                {seleccionada ? (
                  <SesionVista
                    sesion={seleccionada}
                    precios={precios}
                    onGuardarPrecios={(nuevos) =>
                      guardarPreciosPeriodo(seleccionada, nuevos)
                    }
                  />
                ) : (
                  <EstadoVacio
                    icon={<Activity className="h-5 w-5" />}
                    titulo="Sin turno seleccionado"
                    texto="Elige un turno activo arriba para ver su detalle en tiempo real."
                  />
                )}
              </div>
            </>
          ) : vista === "reporte" ? (
            selectedDia && delDia.length > 0 ? (
              <ReporteDiaVista
                delDia={delDia}
                dia={selectedDia}
                precios={precios}
                onUpdateRegistro={onUpdateRegistro}
                onRemoveRegistro={onRemoveRegistro}
                onAddRegistro={onAddRegistro}
                onUpdateOdometro={onUpdateOdometro}
                onSetPreciosSesion={onSetPreciosSesion}
                mostrarVentaNormal={can("venta-normal")}
              />
            ) : (
              <EstadoVacio
                icon={<CalendarDays className="h-5 w-5" />}
                titulo="Aún no hay reporte para mostrar"
                texto={
                  reporteEnVivo
                    ? "El reporte aparece a medida que los turnos van finalizando (un turno está listo cuando sus 3 islas cerraron)."
                    : "El reporte aparecerá cuando el día completo (mañana, tarde y noche) haya cerrado."
                }
              />
            )
          ) : vista === "mover" ? (
            <VistaMover
              activos={activos}
              moverOrigenId={moverOrigenId}
              setMoverOrigenId={setMoverOrigenId}
              setMoverDestinoIsla={setMoverDestinoIsla}
              moverOrigen={moverOrigen}
              moverDestinoIsla={moverDestinoIsla}
              islasDestino={islasDestino}
              moverDestino={moverDestino}
              destinoCerrado={destinoCerrado}
              setConfirmandoMover={setConfirmandoMover}
            />
          ) : vista === "usuarios" ? (
            <VistaUsuarios
              nuevoNombre={nuevoNombre}
              setNuevoNombre={setNuevoNombre}
              agregarTrabajador={agregarTrabajador}
              trabajadores={trabajadores}
              quitarTrabajador={quitarTrabajador}
            />
          ) : vista === "clientes" ? (
            <VistaClientes
              tipoClientes={tipoClientes}
              setTipoClientes={setTipoClientes}
              clientes={clientes}
              clientesDescuento={clientesDescuento}
              paginaCliente={paginaCliente}
              setPaginaCliente={setPaginaCliente}
              nuevoCliente={nuevoCliente}
              setNuevoCliente={setNuevoCliente}
              agregarCliente={agregarCliente}
              quitarCliente={quitarCliente}
            />
          ) : vista === "exportar" ? (
            <VistaExportar
              diasAConservar={DIAS_A_CONSERVAR}
              selectedDia={selectedDia}
              turnosListos={turnosListos}
              exportTurno={exportTurno}
              setExportTurno={setExportTurno}
              descargarXlsx={descargarXlsx}
              exportando={exportando}
              turnosConIsla={turnosConIsla}
              exportTurnoIsla={exportTurnoIsla}
              setExportTurnoIsla={setExportTurnoIsla}
              exportIslaId={exportIslaId}
              setExportIslaId={setExportIslaId}
              islasCerradasTurnoIsla={islasCerradasTurnoIsla}
              descargarXlsxIsla={descargarXlsxIsla}
              exportandoIsla={exportandoIsla}
              descargarGeneral={descargarGeneral}
              exportandoGeneral={exportandoGeneral}
            />
          ) : (
            // vista === "config"
            <VistaConfig
              can={can}
              diasBackup={DIAS_BACKUP}
              backups={backups}
              backupManual={backupManual}
              creandoBackup={creandoBackup}
              descargarBackup={descargarBackup}
              setBackupARestaurar={setBackupARestaurar}
              restaurandoId={restaurandoId}
              eliminarBackup={eliminarBackup}
              logo={logo}
              onSubirLogo={onSubirLogo}
              quitarLogo={quitarLogo}
              nombreGrifoLocal={nombreGrifoLocal}
              setNombreGrifoLocal={setNombreGrifoLocal}
              guardarNombreGrifo={guardarNombreGrifo}
              activos={activos}
              setTurnoALiberar={setTurnoALiberar}
              setConfirmandoReset={setConfirmandoReset}
            />
          )}
        </main>
      </div>

      <Dialog
        open={!!backupARestaurar}
        onOpenChange={(o) => !o && setBackupARestaurar(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Restaurar esta copia de seguridad?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se reescribirán las sesiones (odómetros, pagos, etc.) y la
            configuración con los datos de la copia del{" "}
            <b>{backupARestaurar?.dia}</b> (
            {backupARestaurar
              ? new Date(backupARestaurar.createdAt).toLocaleString("es-PE")
              : ""}
            ). Los turnos que existan se sobrescriben con los de la copia.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBackupARestaurar(null)}>
              Cancelar
            </Button>
            <Button
              onClick={confirmarRestaurar}
              disabled={restaurandoId === backupARestaurar?.id}
            >
              {restaurandoId === backupARestaurar?.id
                ? "Restaurando…"
                : "Sí, restaurar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmandoMover} onOpenChange={setConfirmandoMover}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Mover al trabajador de isla?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {moverOrigen && moverDestinoIsla ? (
              moverDestino ? (
                <>
                  Se intercambiarán <b>{moverOrigen.trabajador}</b> y{" "}
                  <b>{moverDestino.trabajador}</b> entre{" "}
                  <b>{getIsla(moverOrigen.islaId)?.nombre}</b> y{" "}
                  <b>{getIsla(moverDestinoIsla)?.nombre}</b>, con todos sus
                  registros. Los odómetros de cada isla no se tocan.
                </>
              ) : (
                <>
                  Se moverá <b>{moverOrigen.trabajador}</b> (con todos sus
                  registros) de{" "}
                  <b>{getIsla(moverOrigen.islaId)?.nombre}</b> a{" "}
                  <b>{getIsla(moverDestinoIsla)?.nombre}</b>. Los odómetros de
                  cada isla no se tocan.
                </>
              )
            ) : null}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoMover(false)}>
              Cancelar
            </Button>
            <Button onClick={() => moverTrabajador()}>Sí, mover</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmandoReset} onOpenChange={setConfirmandoReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Borrar todos los turnos y reportes?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Esta acción no se puede deshacer. Se borrará TODO (turnos, créditos,
            pagos, clientes, inventario de tanques, historial de precios y
            auditoría) para dejar el sistema de cero. Se conservan las copias de
            seguridad, las cuentas de usuario y la configuración
            (precios/trabajadores).
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmandoReset(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={resetBaseDatos} disabled={reseteando}>
              {reseteando ? "Borrando…" : "Sí, borrar todo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!turnoALiberar}
        onOpenChange={(o) => !o && setTurnoALiberar(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>¿Liberar este turno?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            El turno de{" "}
            <b>
              {turnoALiberar
                ? `${getIsla(turnoALiberar.islaId)?.nombre ?? turnoALiberar.islaId} · ${turnoLabel(turnoALiberar.turno)}`
                : ""}
            </b>{" "}
            {turnoALiberar?.trabajador ? (
              <>
                (<b>{turnoALiberar.trabajador}</b>){" "}
              </>
            ) : null}
            se borrará por completo y el slot quedará libre, como si no se
            hubiera empezado. Se perderán los registros de ese turno. Esta
            acción no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTurnoALiberar(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => turnoALiberar && liberarTurno(turnoALiberar)}
              disabled={liberando}
            >
              {liberando ? "Liberando…" : "Sí, liberar turno"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
