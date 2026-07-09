"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { clientesOrdenados } from "@/lib/clientes";
import { entradaAutomatica, uid, useStore } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { authHeaders, logoutSupabase } from "@/lib/data/auth";
import {
  fetchHistorialPrecios,
  registrarCambioPrecio,
  type PrecioEvento,
} from "@/lib/data/precios";
import { registrarAuditoria } from "@/lib/data/auditoria";
import {
  BALONES,
  getIsla,
  ISLAS,
  PERMISOS_TODOS,
  PRODUCTOS,
  TURNOS,
  turnoLabel,
} from "@/lib/config";
import {
  calcularReporteDia,
  diaMenos,
  diaOperativo,
  diaOperativoActual,
  diasConAlgunaSesionCerrada,
  diasCompletos,
  islasCerradasDeTurno,
  soles,
  turnosCompletosDeDia,
  turnosConAlgunaIslaCerrada,
} from "@/lib/calc";
import type { Permiso, PrecioKey, Precios, Rol, Sesion, TurnoId } from "@/lib/types";
import { cn, descargarBlob } from "@/lib/utils";
import { SesionVista } from "@/components/grifo/sesion-vista";
import { ReporteDiaVista } from "@/components/grifo/reporte-dia-vista";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Fuel,
  LogOut,
  Wifi,
  Activity,
  CalendarDays,
  Tag,
  Users,
  Contact,
  Download,
  Trash2,
  Settings,
  AlertTriangle,
  DatabaseBackup,
  RotateCcw,
  Save,
  ArrowLeftRight,
  Wallet,
  ScrollText,
  History,
  TrendingUp,
  TrendingDown,
  Banknote,
  NotebookPen,
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

  // Una sola fuente acotada y en vivo: los últimos 60 días operativos.
  // Incluye tanto los turnos activos como los días recientes para reporte/
  // export. Reemplaza a los dos onSnapshot de Firestore por una suscripción
  // Realtime de Supabase.
  const [remoteList, setRemoteList] = useState<Sesion[]>([]);
  const [vista, setVista] = useState<Vista>("activos");
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

  // Si la vista actual no está permitida (p. ej. tras cargar permisos), saltar
  // a la primera vista que sí lo esté. "venta-normal" no es una vista propia.
  useEffect(() => {
    if (can(vista as Permiso)) return;
    const primera = PERMISOS_TODOS.find(
      (p) => p !== "venta-normal" && permisos.includes(p)
    );
    // Ajuste idempotente de la vista a los permisos cargados (async): patrón
    // de sincronización con datos externos, no un bucle de render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (primera) setVista(primera as Vista);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permisos, vista]);

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
    // eslint-disable-next-line react-hooks/purity
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
          <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 animate-pulse-ring">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <Fuel className="h-5 w-5 text-white" />
            )}
          </span>
          <span className="shrink-0 text-lg font-bold">GrifoSys</span>
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
          {vista === "activos" ? (
            <>
              <PortadaKPIs remote={remote} precios={precios} activos={activos.length} />
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
            <div className="max-w-md animate-fade-up rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <h3 className="mb-1 flex items-center gap-2 text-base font-bold">
                <ArrowLeftRight className="h-4 w-4" /> Mover trabajador de isla
              </h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Corrige cuando un trabajador eligió la isla equivocada. Se mueve
                su nombre y todos sus registros (pagos, créditos, ventas,
                gastos…) a la isla correcta. <b>Los odómetros NO se mueven</b>:
                pertenecen a la isla física y se quedan donde están.
              </p>
              {activos.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No hay turnos activos para mover.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <Label className="text-xs">Trabajador / isla actual</Label>
                    <Select
                      value={moverOrigenId ?? ""}
                      onValueChange={(v) => {
                        setMoverOrigenId(v);
                        setMoverDestinoIsla(null);
                      }}
                    >
                      <SelectTrigger className="h-9 w-full">
                        <SelectValue placeholder="Elige el turno a corregir" />
                      </SelectTrigger>
                      <SelectContent>
                        {activos.map((s) => {
                          const isla = getIsla(s.islaId);
                          return (
                            <SelectItem key={s.id} value={s.id}>
                              {isla?.nombre} · {turnoLabel(s.turno)} ·{" "}
                              {s.trabajador}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {moverOrigen && (
                    <div className="space-y-1">
                      <Label className="text-xs">Isla correcta (destino)</Label>
                      <Select
                        value={moverDestinoIsla ?? ""}
                        onValueChange={(v) => setMoverDestinoIsla(v)}
                      >
                        <SelectTrigger className="h-9 w-full">
                          <SelectValue placeholder="Elige la isla destino" />
                        </SelectTrigger>
                        <SelectContent>
                          {islasDestino.map((i) => (
                            <SelectItem key={i.id} value={i.id}>
                              {i.nombre}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {moverOrigen && moverDestinoIsla && (
                    <div
                      className={cn(
                        "rounded-lg border p-3 text-xs",
                        destinoCerrado
                          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-300"
                          : "border-sky-300/60 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-950/20 dark:text-sky-200"
                      )}
                    >
                      {destinoCerrado ? (
                        <span>
                          La isla destino ya cerró su turno; no se puede mover
                          ahí.
                        </span>
                      ) : moverDestino ? (
                        <span>
                          <b>Intercambio.</b> {moverOrigen.trabajador} pasará a{" "}
                          <b>{getIsla(moverDestinoIsla)?.nombre}</b> y{" "}
                          {moverDestino.trabajador} pasará a{" "}
                          <b>{getIsla(moverOrigen.islaId)?.nombre}</b>. Cada isla
                          conserva su odómetro.
                        </span>
                      ) : (
                        <span>
                          <b>Mover a isla libre.</b> {moverOrigen.trabajador}{" "}
                          pasará a <b>{getIsla(moverDestinoIsla)?.nombre}</b> con
                          el odómetro propio de esa isla. El turno de{" "}
                          {getIsla(moverOrigen.islaId)?.nombre} se eliminará
                          (como si nunca se hubiera abierto ahí); su odómetro no
                          se rompe.
                        </span>
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    disabled={!moverOrigen || !moverDestinoIsla || destinoCerrado}
                    onClick={() => setConfirmandoMover(true)}
                  >
                    <ArrowLeftRight className="mr-1 h-4 w-4" /> Mover trabajador
                  </Button>
                </div>
              )}
            </div>
          ) : vista === "usuarios" ? (
            <div className="max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <h3 className="mb-1 text-base font-bold">Gestión de usuarios</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Trabajadores que pueden iniciar sesión y elegir turno. Los
                cambios se aplican en todo el sistema al instante.
              </p>
              <div className="mb-3 flex gap-2">
                <Input
                  placeholder="Nombre del trabajador"
                  value={nuevoNombre}
                  onChange={(e) => setNuevoNombre(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && agregarTrabajador()}
                  className="h-9"
                />
                <Button size="sm" className="h-9" onClick={agregarTrabajador}>
                  + Agregar
                </Button>
              </div>
              <div className="space-y-2">
                {trabajadores.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No hay trabajadores registrados.
                  </p>
                )}
                {trabajadores.map((nombre) => (
                  <div
                    key={nombre}
                    className="flex items-center justify-between rounded-lg border p-2 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
                        {nombre[0]}
                      </span>
                      {nombre}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-red-500 hover:text-red-600"
                      onClick={() => quitarTrabajador(nombre)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ) : vista === "clientes" ? (
            (() => {
              const POR_PAGINA = 30;
              const esDescuento = tipoClientes === "descuento";
              const listaClientes = esDescuento ? clientesDescuento : clientes;
              const ordenados = clientesOrdenados(listaClientes);
              const totalPaginas = Math.max(1, Math.ceil(ordenados.length / POR_PAGINA));
              const pagina = Math.min(paginaCliente, totalPaginas - 1);
              const visibles = ordenados.slice(
                pagina * POR_PAGINA,
                pagina * POR_PAGINA + POR_PAGINA
              );
              return (
                <div className="max-w-3xl rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                  <h3 className="mb-1 text-base font-bold">Gestión de clientes</h3>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Clientes de crédito y clientes de descuento se manejan por separado.
                    El mismo nombre puede existir en ambas listas sin mezclarse.
                  </p>
                  <div className="mb-3 inline-flex rounded-lg border bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={!esDescuento ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => {
                        setTipoClientes("credito");
                        setPaginaCliente(0);
                      }}
                    >
                      Clientes crédito
                    </Button>
                    <Button
                      size="sm"
                      variant={esDescuento ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => {
                        setTipoClientes("descuento");
                        setPaginaCliente(0);
                      }}
                    >
                      Clientes descuento
                    </Button>
                  </div>
                  <div className="mb-3 flex max-w-md gap-2">
                    <Input
                      placeholder={esDescuento ? "Cliente para descuento" : "Cliente de crédito"}
                      value={nuevoCliente}
                      onChange={(e) => setNuevoCliente(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
                      className="h-9"
                    />
                    <Button size="sm" className="h-9" onClick={agregarCliente}>
                      + Agregar
                    </Button>
                  </div>
                  {listaClientes.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No hay clientes registrados.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                        {visibles.map((nombre) => (
                          <div
                            key={nombre}
                            className="flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs"
                          >
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[10px] font-bold text-white">
                                {nombre[0]}
                              </span>
                              <span className="truncate">{nombre}</span>
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 shrink-0 px-0 text-red-500 hover:text-red-600"
                              onClick={() => quitarCliente(nombre)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      {totalPaginas > 1 && (
                        <div className="mt-3 flex flex-wrap items-center gap-1">
                          {Array.from({ length: totalPaginas }, (_, i) => (
                            <Button
                              key={i}
                              size="sm"
                              variant={i === pagina ? "default" : "outline"}
                              className="h-7 w-7 px-0 text-xs"
                              onClick={() => setPaginaCliente(i)}
                            >
                              {i + 1}
                            </Button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()
          ) : vista === "exportar" ? (
            <div className="max-w-md animate-fade-up rounded-2xl border border-border/60 bg-card p-4 shadow-sm card-lift">
              <h3 className="mb-1 text-base font-bold">Exportar reporte</h3>
              <p className="mb-3 text-xs text-muted-foreground">
                Elige un día (lista a la izquierda, últimos {DIAS_A_CONSERVAR} días).
                Las ediciones que hagas en &quot;Reporte del día&quot; se reflejan
                automáticamente la próxima vez que exportes.
              </p>
              {/* Aviso importante: descargar y guardar en la PC */}
              <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <Download className="mt-0.5 h-4 w-4 shrink-0 animate-bounce" />
                <span>
                  <b>No olvides guardar los reportes en tu PC.</b> Los datos se
                  conservan solo los últimos {DIAS_A_CONSERVAR} días; después se
                  borran automáticamente. Descarga el Excel y guárdalo en una
                  carpeta segura.
                </span>
              </div>
              {!selectedDia ? (
                <p className="text-xs text-muted-foreground">
                  Selecciona un día en la barra lateral.
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="text-xs">
                    Día: <b>{selectedDia}</b>
                  </div>

                  {/* Por turno (3 islas) */}
                  <div className="space-y-2 border-t pt-3">
                    <h4 className="text-xs font-bold text-muted-foreground">
                      POR TURNO (3 ISLAS)
                    </h4>
                    {turnosListos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aún no hay ningún turno completo (las 3 islas de un
                        turno deben haber finalizado) para exportar.
                      </p>
                    ) : (
                      <>
                        <Select
                          value={exportTurno}
                          onValueChange={(v) => setExportTurno((v as TurnoId) ?? turnosListos[0])}
                        >
                          <SelectTrigger className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TURNOS.filter((t) => turnosListos.includes(t.id)).map(
                              (t) => (
                                <SelectItem key={t.id} value={t.id}>
                                  {t.label}
                                </SelectItem>
                              )
                            )}
                          </SelectContent>
                        </Select>
                        <Button
                          className="w-full"
                          onClick={descargarXlsx}
                          disabled={exportando || !turnosListos.includes(exportTurno)}
                        >
                          <Download className="mr-1 h-4 w-4" />
                          {exportando ? "Generando…" : "Descargar Excel del turno (.xlsx)"}
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Por turno e isla individual */}
                  <div className="space-y-2 border-t pt-3">
                    <h4 className="text-xs font-bold text-muted-foreground">
                      POR ISLA INDIVIDUAL
                    </h4>
                    {turnosConIsla.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aún ninguna isla finalizó un turno este día.
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <Select
                            value={exportTurnoIsla}
                            onValueChange={(v) =>
                              setExportTurnoIsla((v as TurnoId) ?? turnosConIsla[0])
                            }
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TURNOS.filter((t) => turnosConIsla.includes(t.id)).map(
                                (t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.label}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                          <Select
                            value={exportIslaId ?? ""}
                            onValueChange={(v) => setExportIslaId(v)}
                          >
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder="Isla" />
                            </SelectTrigger>
                            <SelectContent>
                              {ISLAS.filter((i) => islasCerradasTurnoIsla.includes(i.id)).map(
                                (i) => (
                                  <SelectItem key={i.id} value={i.id}>
                                    {i.nombre}
                                  </SelectItem>
                                )
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          className="w-full"
                          onClick={descargarXlsxIsla}
                          disabled={exportandoIsla || !exportIslaId}
                        >
                          <Download className="mr-1 h-4 w-4" />
                          {exportandoIsla ? "Generando…" : "Descargar Excel de la isla (.xlsx)"}
                        </Button>
                      </>
                    )}
                  </div>

                  <div className="border-t pt-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Reporte general del día completo (plantilla &quot;madre&quot;):
                      ventas, clientes, vales, descuentos y formas de pago de
                      todos los turnos.
                    </p>
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={descargarGeneral}
                      disabled={exportandoGeneral}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      {exportandoGeneral ? "Generando…" : "Descargar reporte general (.xlsx)"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            // vista === "config"
            <div className="max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
              <h3 className="mb-1 flex items-center gap-2 text-base font-bold">
                <Settings className="h-4 w-4" /> Configuraciones
              </h3>
              {!can("reset") && !can("backups-ver") && !can("backups-generar") ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    No tienes permiso para ver esta sección. Pídele al dueño el
                    permiso de backups o de reseteo del sistema.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Copias de seguridad */}
                  <div className="rounded-lg border border-sky-300/60 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-950/20">
                    <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-sky-700 dark:text-sky-300">
                      <DatabaseBackup className="h-4 w-4" /> Copias de seguridad
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Instantáneas de todas las sesiones (incluidos los
                      odómetros) y la configuración. Se crea una automáticamente
                      al completarse cada turno (3 islas) y puedes crear una
                      manual. Se conservan los últimos {DIAS_BACKUP} días.
                      <br />
                      <span className="text-[11px]">
                        Para recuperar: usa &quot;Resetear base de datos&quot;
                        (no borra las copias) y luego restaura un punto seguro.
                      </span>
                    </p>
                    <Button
                      size="sm"
                      className="mb-3 w-full"
                      onClick={backupManual}
                      disabled={creandoBackup}
                    >
                      <Save className="mr-1 h-4 w-4" />
                      {creandoBackup ? "Creando…" : "Crear copia ahora"}
                    </Button>
                    {backups.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aún no hay copias de seguridad.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {backups.map((b) => (
                          <div
                            key={b.id}
                            className="animate-fade-up rounded-lg border bg-card p-2 text-xs card-lift"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="flex items-center gap-1.5 font-semibold">
                                  <CalendarDays className="h-3.5 w-3.5 shrink-0" /> {b.dia}
                                  {b.nota && (
                                    <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                                      {b.nota}
                                    </span>
                                  )}
                                </div>
                                <div className="text-[11px] text-muted-foreground">
                                  {new Date(b.createdAt).toLocaleString("es-PE")} ·{" "}
                                  {b.sesiones.length} sesiones
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2"
                                  onClick={() => descargarBackup(b)}
                                  title="Descargar copia (.json)"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="h-7 px-2"
                                  onClick={() => setBackupARestaurar(b)}
                                  disabled={restaurandoId === b.id}
                                  title="Restaurar esta copia"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-red-500 hover:text-red-600"
                                  onClick={() => eliminarBackup(b.id)}
                                  title="Eliminar copia"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Logo de la empresa */}
                  <div className="rounded-lg border border-violet-300/60 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-950/20">
                    <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-violet-700 dark:text-violet-300">
                      <Tag className="h-4 w-4" /> Logo de la empresa
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Reemplaza el ícono del login y del panel por el logo de la
                      empresa. Imagen PNG/JPG de máx. 500 KB.
                    </p>
                    <div className="flex items-center gap-3">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-card">
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logo}
                            alt="Logo actual"
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <Fuel className="h-7 w-7 text-amber-500" />
                        )}
                      </span>
                      <div className="flex flex-col gap-2">
                        <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                          {logo ? "Cambiar logo" : "Subir logo"}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              onSubirLogo(e.target.files?.[0]);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        {logo && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9"
                            onClick={quitarLogo}
                          >
                            Quitar logo
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Liberar turnos abiertos (destrabar turnos de prueba) */}
                  <div className="rounded-lg border border-orange-300/60 bg-orange-50 p-3 dark:border-orange-500/30 dark:bg-orange-950/20">
                    <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-orange-700 dark:text-orange-300">
                      <RotateCcw className="h-4 w-4" /> Liberar turnos abiertos
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Fuerza la liberación de un turno en curso: se borra por
                      completo y el slot queda <b>libre</b>, como si no se
                      hubiera empezado, para que otro trabajador pueda tomarlo.
                      Útil para destrabar turnos de prueba con trabajadores que
                      ya no existen.
                    </p>
                    {activos.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No hay turnos abiertos.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {activos.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs"
                          >
                            <div>
                              <div className="font-semibold">
                                {getIsla(s.islaId)?.nombre ?? s.islaId} ·{" "}
                                {turnoLabel(s.turno)}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {s.trabajador || "(sin trabajador)"} · {s.diaOperativo}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 border-orange-400 px-2 text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-900/30"
                              onClick={() => setTurnoALiberar(s)}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Liberar
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {can("reset") && (
                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:bg-red-950/30">
                    <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-red-600">
                      <AlertTriangle className="h-4 w-4" /> Zona de pruebas
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Borra TODO para probar el sistema de cero: turnos, créditos,
                      pagos, clientes, historial de precios y auditoría. NO se
                      borran las copias de seguridad, las cuentas de usuario
                      (dueño/admin/trabajador) ni la configuración (precios y
                      lista de trabajadores).
                    </p>
                    <Button
                      variant="destructive"
                      className="w-full"
                      onClick={() => setConfirmandoReset(true)}
                    >
                      <Trash2 className="mr-1 h-4 w-4" />
                      Resetear base de datos
                    </Button>
                  </div>
                  )}
                </div>
              )}
            </div>
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
            pagos, clientes, historial de precios y auditoría) para dejar el
            sistema de cero. Se conservan las copias de seguridad, las cuentas de
            usuario y la configuración (precios/trabajadores).
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

// Input de precio con estado LOCAL: el valor solo se confirma (sube al store)
// al salir del campo o presionar Enter, no en cada tecla. Así el admin puede
// escribir "18" sin que el sistema se recargue/reinicie a mitad de la edición.
function PrecioInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [local, setLocal] = useState(value ? String(value) : "");
  const [prevValue, setPrevValue] = useState(value);

  // Mientras no se está editando, refleja el valor externo (ej. otro cambio).
  // Ajuste de estado en render (patrón recomendado por React) en vez de effect.
  if (value !== prevValue && !focused) {
    setPrevValue(value);
    setLocal(value ? String(value) : "");
  }

  const commit = () => {
    const n = Number(local);
    onCommit(Number.isFinite(n) && n > 0 ? n : 0);
  };

  return (
    <Input
      type="number"
      step="0.01"
      inputMode="decimal"
      className="h-9"
      value={local}
      onFocus={() => setFocused(true)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        }
      }}
      onWheel={(e) => e.currentTarget.blur()}
    />
  );
}

function PreciosEditor({
  precios,
  onChange,
  puedeVerHistorial,
}: {
  precios: import("@/lib/types").Precios;
  onChange: (
    k: PrecioKey,
    v: number,
    opts?: { motivo?: string; aplica?: "proximo" | "activo" }
  ) => void;
  puedeVerHistorial?: boolean;
}) {
  const combustibles: PrecioKey[] = ["bio", "regular", "premium", "glp"];
  const balones: PrecioKey[] = ["gasfull", "zetagas"];
  const label = (k: PrecioKey) =>
    (PRODUCTOS as Record<string, string>)[k] ??
    (BALONES as Record<string, string>)[k] ??
    k;
  const [motivo, setMotivo] = useState("");
  const [aplica, setAplica] = useState<"proximo" | "activo">("proximo");
  const [verHistorial, setVerHistorial] = useState(false);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="secondary"
            className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Tag className="mr-1 h-4 w-4" /> Precios
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Precios del sistema</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          El nuevo precio rige desde el <b>próximo turno</b>. Los turnos abiertos
          pueden conservarlo o actualizarse si eliges <b>Aplicar ya</b>.
        </p>
        {/* Motivo + alcance del cambio (quedan en el historial) */}
        <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/40 p-2.5">
          <div className="space-y-1">
            <Label className="text-xs">Motivo del cambio (opcional)</Label>
            <Input
              className="h-8"
              placeholder="Ej. ajuste de mayorista"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={aplica === "proximo" ? "default" : "outline"}
              className="h-7 flex-1 text-xs"
              onClick={() => setAplica("proximo")}
            >
              Desde próximo turno
            </Button>
            <Button
              type="button"
              size="sm"
              variant={aplica === "activo" ? "default" : "outline"}
              className="h-7 flex-1 text-xs"
              onClick={() => setAplica("activo")}
            >
              Aplicar ya
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <h4 className="mb-1 text-xs font-bold text-muted-foreground">
              COMBUSTIBLES (por galón)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {combustibles.map((k) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label(k)}</Label>
                  <PrecioInput
                    value={precios[k] || 0}
                    onCommit={(v) => onChange(k, v, { motivo, aplica })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-bold text-muted-foreground">
              BALONES DE GAS (por unidad)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {balones.map((k) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label(k)}</Label>
                  <PrecioInput
                    value={precios[k] || 0}
                    onCommit={(v) => onChange(k, v, { motivo, aplica })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        {puedeVerHistorial && (
          <div className="border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-full justify-start text-xs text-muted-foreground"
              onClick={() => setVerHistorial((v) => !v)}
            >
              <History className="mr-1 h-3.5 w-3.5" />
              {verHistorial ? "Ocultar historial" : "Ver historial de precios"}
            </Button>
            {verHistorial && <HistorialPrecios />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Historial de cambios de precio (permiso 'precios-historial'). Carga bajo
// demanda al abrirse; más reciente primero.
function HistorialPrecios() {
  const [eventos, setEventos] = useState<PrecioEvento[] | null>(null);
  useEffect(() => {
    let vivo = true;
    fetchHistorialPrecios({ limite: 50 })
      .then((e) => vivo && setEventos(e))
      .catch(() => vivo && setEventos([]));
    return () => {
      vivo = false;
    };
  }, []);
  const label = (k: string) =>
    (PRODUCTOS as Record<string, string>)[k] ??
    (BALONES as Record<string, string>)[k] ??
    k;
  if (eventos == null)
    return <p className="px-1 py-2 text-xs text-muted-foreground">Cargando…</p>;
  if (eventos.length === 0)
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        Aún no hay cambios de precio registrados.
      </p>
    );
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
      {eventos.map((e) => (
        <div key={e.id} className="rounded-md bg-muted/50 px-2 py-1 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{label(e.producto)}</span>
            <span className="tabular-nums">
              {e.precioAnterior != null ? soles(e.precioAnterior) : "—"} →{" "}
              <b>{soles(e.precioNuevo)}</b>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>
              {e.cambiadoPorNombre ?? "—"}
              {e.aplica === "activo" ? " · aplicó ya" : " · próximo turno"}
              {e.motivo ? ` · ${e.motivo}` : ""}
            </span>
            <span>{new Date(e.createdAt).toLocaleString("es-PE")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Estado vacío reutilizable: icono en círculo + título + texto de ayuda.
function EstadoVacio({
  icon,
  titulo,
  texto,
}: {
  icon: React.ReactNode;
  titulo: string;
  texto?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/50 px-6 py-16 text-center shadow-sm">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium">{titulo}</p>
      {texto && <p className="max-w-sm text-xs text-muted-foreground">{texto}</p>}
    </div>
  );
}

// Encabezado de grupo en el sidebar (Operación / Personal / Créditos / Sistema).
function NavLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1">
      {children}
    </p>
  );
}

function SideNav({
  activo,
  onClick,
  icon,
  label,
}: {
  activo: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
        activo
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-foreground hover:translate-x-0.5 hover:bg-accent"
      )}
    >
      {/* Indicador lateral animado del ítem activo */}
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-amber-400 transition-all duration-300",
          activo ? "opacity-100" : "opacity-0 -translate-x-1"
        )}
      />
      <span className="transition-transform duration-200 group-hover:scale-110">
        {icon}
      </span>
      {label}
    </button>
  );
}

// ===========================================================================
// Portada de KPIs del día (vista "Turnos activos"): venta, efectivo esperado,
// créditos y avance de turnos, comparado con el día operativo anterior.
// ===========================================================================
function PortadaKPIs({
  remote,
  precios,
  activos,
}: {
  remote: Sesion[];
  precios: Precios;
  activos: number;
}) {
  const kpi = useMemo(() => {
    const hoyOp = diaOperativoActual();
    const ayerOp = diaMenos(hoyOp, 1);
    const sesHoy = remote.filter((s) => diaOperativo(s) === hoyOp);
    const sesAyer = remote.filter((s) => diaOperativo(s) === ayerOp);
    return {
      hoy: calcularReporteDia(sesHoy, hoyOp, precios),
      ayer: calcularReporteDia(sesAyer, ayerOp, precios),
      cerradosHoy: sesHoy.filter((s) => s.cerrada).length,
    };
  }, [remote, precios]);

  // Variación % de la venta vs. el día anterior (null si ayer no tuvo venta).
  const delta =
    kpi.ayer.ventaTotal > 0.01
      ? ((kpi.hoy.ventaTotal - kpi.ayer.ventaTotal) / kpi.ayer.ventaTotal) * 100
      : null;

  return (
    <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <KpiCard
        icon={<Banknote className="h-4 w-4" />}
        label="Venta del día"
        valor={soles(kpi.hoy.ventaTotal)}
        pie={
          delta == null ? (
            <span className="text-muted-foreground">Sin venta ayer para comparar</span>
          ) : (
            <span
              className={cn(
                "flex items-center gap-1 font-medium",
                delta >= 0 ? "text-emerald-600" : "text-red-600"
              )}
            >
              {delta >= 0 ? (
                <TrendingUp className="h-3.5 w-3.5" />
              ) : (
                <TrendingDown className="h-3.5 w-3.5" />
              )}
              {delta >= 0 ? "+" : ""}
              {delta.toFixed(0)}% vs ayer
            </span>
          )
        }
      />
      <KpiCard
        icon={<Wallet className="h-4 w-4" />}
        label="Efectivo esperado"
        valor={soles(kpi.hoy.efectivoAEntregar)}
        pie={<span className="text-muted-foreground">A entregar al encargado</span>}
      />
      <KpiCard
        icon={<NotebookPen className="h-4 w-4" />}
        label="Créditos del día"
        valor={soles(kpi.hoy.totalCreditos)}
        pie={<span className="text-muted-foreground">Vales a cuenta corriente</span>}
      />
      <KpiCard
        icon={<Activity className="h-4 w-4" />}
        label="Turnos"
        valor={`${activos} activo${activos === 1 ? "" : "s"}`}
        pie={
          <span className="text-muted-foreground">
            {kpi.cerradosHoy}/9 turnos cerrados hoy
          </span>
        }
      />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  valor,
  pie,
}: {
  icon: React.ReactNode;
  label: string;
  valor: string;
  pie?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-extrabold tabular-nums">{valor}</div>
      <div className="mt-0.5 text-[11px]">{pie}</div>
    </div>
  );
}
