"use client";

import { useEffect, useMemo, useState } from "react";
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
  crearBackup,
  deleteBackup,
  deleteSesion,
  deleteTodasSesiones,
  DIAS_BACKUP,
  fetchBackups,
  restaurarBackup,
  setAdminsRemoto,
  setLogoRemoto,
  setPreciosRemoto,
  setClientesRemoto,
  addClientesRemoto,
  setTrabajadoresRemoto,
  subscribeSesiones,
  upsertSesion,
  type Backup,
} from "@/lib/db";
import { clientesOrdenados } from "@/lib/clientes";
import { entradaAutomatica, uid, useStore } from "@/lib/store";
import { logoutSupabase } from "@/lib/data/auth";
import {
  BALONES,
  CONFIG_PASSWORD,
  getIsla,
  ISLAS,
  PERMISOS,
  PERMISOS_TODOS,
  PRODUCTOS,
  TURNOS,
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
import type { Admin, Permiso, PrecioKey, Precios, Rol, Sesion, TurnoId } from "@/lib/types";
import { cn } from "@/lib/utils";
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
} from "lucide-react";
import Link from "next/link";

// Días operativos a conservar; los más antiguos (ya completos) se borran
// automáticamente. Ver limpieza en el efecto de retención más abajo.
const DIAS_A_CONSERVAR = 7;

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

// Dispara la descarga de un blob de forma robusta. El <a> debe agregarse al
// DOM y el objeto URL revocarse después (no de inmediato), o algunos
// navegadores bloquean la descarga pidiendo permiso ("se necesita permiso
// para continuar con la descarga").
function descargarBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
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
  const clientes = useStore((s) => s.clientes);
  const setClientesStore = useStore((s) => s.setClientes);
  const logo = useStore((s) => s.logo);
  const setLogo = useStore((s) => s.setLogo);
  const admins = useStore((s) => s.admins);
  const setAdmins = useStore((s) => s.setAdmins);

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
  const [paginaCliente, setPaginaCliente] = useState(0);
  const [conectado, setConectado] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const resetSesiones = useStore((s) => s.resetSesiones);
  const [configPass, setConfigPass] = useState("");
  const [configUnlocked, setConfigUnlocked] = useState(false);
  const [nuevoAdminNombre, setNuevoAdminNombre] = useState("");
  const [nuevoAdminPass, setNuevoAdminPass] = useState("");
  const [nuevoAdminPermisos, setNuevoAdminPermisos] =
    useState<Permiso[]>(PERMISOS_TODOS);
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [reseteando, setReseteando] = useState(false);
  // ---- Mover trabajador (corregir isla mal elegida) ----
  const [moverOrigenId, setMoverOrigenId] = useState<string | null>(null);
  const [moverDestinoIsla, setMoverDestinoIsla] = useState<string | null>(null);
  const [confirmandoMover, setConfirmandoMover] = useState(false);
  // ---- Backups (copias de seguridad) ----
  const [backups, setBackups] = useState<Backup[]>([]);
  const [creandoBackup, setCreandoBackup] = useState(false);
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);
  const [backupARestaurar, setBackupARestaurar] = useState<Backup | null>(null);
  useEffect(() => setHydrated(true), []);

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
    if (primera) setVista(primera as Vista);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permisos, vista]);

  // Suscripción en vivo a los últimos 60 días operativos (turnos activos +
  // días recientes para reporte/export), vía Supabase Realtime.
  useEffect(() => {
    const corte = diaMenos(diaOperativoActual(), 60);
    const unsub = subscribeSesiones(corte, (lista) => {
      setRemoteList(lista);
      setConectado(true);
    });
    return unsub;
  }, []);

  const remote = remoteList;

  const activos = useMemo(
    () => remote.filter((s) => !s.cerrada).sort((a, b) => b.createdAt - a.createdAt),
    [remote]
  );
  // Superset de "días completos": incluye días con progreso parcial (al
  // menos una isla cerrada), necesario para poder exportar por isla
  // individual antes de que el turno completo (3 islas) termine.
  const dias = useMemo(() => diasConAlgunaSesionCerrada(remote), [remote]);
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

  useEffect(() => {
    if (!selectedId && activos.length) setSelectedId(activos[0].id);
  }, [activos, selectedId]);
  useEffect(() => {
    if (!selectedDia && dias.length) setSelectedDia(dias[0]);
  }, [dias, selectedDia]);
  // Asegura que el turno a exportar sea uno que esté completo.
  useEffect(() => {
    if (turnosListos.length && !turnosListos.includes(exportTurno)) {
      setExportTurno(turnosListos[0]);
    }
  }, [turnosListos, exportTurno]);
  // Asegura que el turno/isla del export individual sean válidos.
  useEffect(() => {
    if (turnosConIsla.length && !turnosConIsla.includes(exportTurnoIsla)) {
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
  }
  function onChangePrecio(k: PrecioKey, v: number) {
    setPrecio(k, v);
    setPreciosRemoto({ ...precios, [k]: v }).catch(() => {});
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

  // ---- Gestión de administradores (sección desarrollador) ----
  function persistAdmins(lista: Admin[]) {
    setAdmins(lista);
    setAdminsRemoto(lista).catch(() => {});
  }
  function agregarAdmin() {
    const nombre = nuevoAdminNombre.trim();
    const pass = nuevoAdminPass.trim();
    if (!nombre || !pass) {
      toast.error("Nombre y contraseña son obligatorios");
      return;
    }
    if (admins.some((a) => a.nombre.toLowerCase() === nombre.toLowerCase())) {
      toast.error("Ya existe un administrador con ese nombre");
      return;
    }
    persistAdmins([
      ...admins,
      { id: uid(), nombre, password: pass, permisos: nuevoAdminPermisos },
    ]);
    setNuevoAdminNombre("");
    setNuevoAdminPass("");
    setNuevoAdminPermisos(PERMISOS_TODOS);
    toast.success("Administrador creado");
  }
  function quitarAdmin(id: string) {
    persistAdmins(admins.filter((a) => a.id !== id));
  }
  // Activa/desactiva un permiso para un admin ya creado y lo guarda.
  function togglePermisoAdmin(id: string, permiso: Permiso) {
    persistAdmins(
      admins.map((a) => {
        if (a.id !== id) return a;
        const actuales = a.permisos ?? PERMISOS_TODOS;
        const permisos = actuales.includes(permiso)
          ? actuales.filter((p) => p !== permiso)
          : [...actuales, permiso];
        return { ...a, permisos };
      })
    );
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
        headers: { "Content-Type": "application/json" },
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
        headers: { "Content-Type": "application/json" },
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
  async function resetBaseDatos() {
    setReseteando(true);
    try {
      await deleteTodasSesiones();
      resetSesiones();
      setRemoteList([]);
      setSelectedId(null);
      setSelectedDia(null);
      toast.success("Base de datos reseteada");
    } catch {
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
    refrescarBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        headers: { "Content-Type": "application/json" },
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
    persist({ ...s, [tipo]: arr });
    aprenderCliente(patch.cliente);
  }
  function onRemoveRegistro(sesionId: string, tipo: string, rowId: string) {
    const s = remote.find((x) => x.id === sesionId);
    if (!s) return;
    const arr = ((s as unknown as Record<string, { id: string }[]>)[tipo] || []).filter(
      (r) => r.id !== rowId
    );
    persist({ ...s, [tipo]: arr });
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
    persist({ ...s, [tipo]: arr });
    aprenderCliente(row.cliente);
  }
  // El admin escribe nombres de cliente nuevos al registrar/editar créditos,
  // descuentos o adelantos: se aprenden en la base de clientes y se sincronizan
  // (igual que cuando el trabajador los anota desde su turno).
  function aprenderCliente(nombre: unknown) {
    if (typeof nombre !== "string" || !nombre.trim()) return;
    // Aditivo: solo agrega el nombre nuevo a la lista remota, nunca pisa la
    // lista completa (así no resucita clientes que el admin ya eliminó).
    if (aprenderClientesStore([nombre])) {
      addClientesRemoto([nombre]).catch(() => {});
    }
  }
  // ---- Gestión de la lista de clientes (autocompletado) ----
  function persistClientes(lista: string[]) {
    setClientesStore(lista);
    setClientesRemoto(lista).catch(() => {});
  }
  function agregarCliente() {
    const nombre = nuevoCliente.trim().toUpperCase();
    if (!nombre) return;
    if (clientes.some((c) => c.toUpperCase() === nombre)) {
      setNuevoCliente("");
      return;
    }
    persistClientes([...clientes, nombre]);
    setNuevoCliente("");
  }
  function quitarCliente(nombre: string) {
    persistClientes(clientes.filter((c) => c !== nombre));
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
      <header className="gs-topbar flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-white">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 animate-pulse-ring">
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="Logo" className="h-full w-full object-contain" />
            ) : (
              <Fuel className="h-5 w-5 text-white" />
            )}
          </span>
          <span className="text-lg font-bold">GrifoSys</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-xs font-medium">
            Administrador
          </span>
          <span
            className={cn(
              "ml-2 flex items-center gap-1 text-xs transition-colors",
              conectado ? "text-emerald-400" : "text-slate-400"
            )}
          >
            <Wifi className={cn("h-3.5 w-3.5", !conectado && "animate-pulse")} />
            {conectado ? "Tiempo real" : "Conectando…"}
          </span>
        </div>

        {/* Recordatorio en movimiento: guardar los reportes en la PC */}
        <div className="mx-4 hidden flex-1 overflow-hidden md:block">
          <div className="marquee-track gap-12 text-xs font-medium text-amber-300/90">
            <span className="inline-flex items-center gap-2">
              💾 No olvides descargar y guardar los reportes en tu PC — los
              datos se conservan solo los últimos 7 días.
            </span>
            <span className="inline-flex items-center gap-2" aria-hidden>
              💾 No olvides descargar y guardar los reportes en tu PC — los
              datos se conservan solo los últimos 7 días.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {auth?.rol === "dueno" && (
            <Link
              href="/admin/usuarios"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-white hover:bg-white/10"
            >
              <Users className="h-4 w-4" /> Usuarios
            </Link>
          )}
          <PreciosEditor precios={precios} onChange={onChangePrecio} />
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
                  Aún no hay un día con todos sus turnos finalizados.
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
                  📅 {d}
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        {/* Contenido */}
        <main className="flex-1 p-3">
          {vista === "activos" ? (
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
                  <div className="py-20 text-center text-sm text-muted-foreground">
                    Selecciona un turno activo para ver su detalle en tiempo real.
                  </div>
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
              <div className="rounded-2xl border border-border/60 bg-card py-20 text-center text-sm text-muted-foreground shadow-sm">
                El reporte aparece a medida que los turnos van finalizando (un
                turno se considera listo cuando sus 3 islas cerraron).
              </div>
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
              const ordenados = clientesOrdenados(clientes);
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
                    Clientes que aparecen como sugerencia al registrar créditos y
                    descuentos. Se guardan en MAYÚSCULAS y se sincronizan al instante.
                  </p>
                  <div className="mb-3 flex max-w-md gap-2">
                    <Input
                      placeholder="Nombre del cliente"
                      value={nuevoCliente}
                      onChange={(e) => setNuevoCliente(e.target.value.toUpperCase())}
                      onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
                      className="h-9"
                    />
                    <Button size="sm" className="h-9" onClick={agregarCliente}>
                      + Agregar
                    </Button>
                  </div>
                  {clientes.length === 0 ? (
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
              {!configUnlocked ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Sección restringida. Ingresa la contraseña de
                    configuraciones para continuar.
                  </p>
                  <Input
                    type="password"
                    placeholder="Contraseña"
                    value={configPass}
                    onChange={(e) => setConfigPass(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      if (configPass === CONFIG_PASSWORD) setConfigUnlocked(true);
                      else toast.error("Contraseña incorrecta");
                    }}
                    className="h-9"
                  />
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (configPass === CONFIG_PASSWORD) setConfigUnlocked(true);
                      else toast.error("Contraseña incorrecta");
                    }}
                  >
                    Entrar
                  </Button>
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
                                <div className="font-semibold">
                                  📅 {b.dia}
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

                  {/* Administradores */}
                  <div className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-950/20">
                    <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-amber-700 dark:text-amber-300">
                      <Users className="h-4 w-4" /> Administradores
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Crea administradores con su nombre y contraseña. Aparecerán
                      en la pantalla de login (opción Administrador) para que
                      ingresen con la contraseña que les asignes aquí.
                    </p>
                    <div className="mb-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        placeholder="Nombre"
                        className="h-9"
                        value={nuevoAdminNombre}
                        onChange={(e) => setNuevoAdminNombre(e.target.value)}
                      />
                      <Input
                        placeholder="Contraseña"
                        className="h-9"
                        value={nuevoAdminPass}
                        onChange={(e) => setNuevoAdminPass(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && agregarAdmin()}
                      />
                      <Button size="sm" className="h-9 shrink-0" onClick={agregarAdmin}>
                        Agregar
                      </Button>
                    </div>
                    {/* Permisos del nuevo admin: qué secciones podrá ver */}
                    <div className="mb-3 rounded-lg border border-amber-200/70 bg-white/60 p-2 dark:border-amber-500/20 dark:bg-black/20">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Permisos del nuevo admin
                      </p>
                      <PermisosGrid
                        seleccionados={nuevoAdminPermisos}
                        onToggle={(p) =>
                          setNuevoAdminPermisos((prev) =>
                            prev.includes(p)
                              ? prev.filter((x) => x !== p)
                              : [...prev, p]
                          )
                        }
                      />
                    </div>
                    {admins.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Aún no hay administradores creados.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {admins.map((a) => (
                          <div
                            key={a.id}
                            className="rounded-lg border bg-card p-2 text-sm"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-2">
                                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 text-xs font-bold text-white">
                                  {a.nombre[0]?.toUpperCase()}
                                </span>
                                <span className="font-medium">{a.nombre}</span>
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-red-500 hover:text-red-600"
                                onClick={() => quitarAdmin(a.id)}
                                title="Eliminar administrador"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            {/* Permisos editables de este admin */}
                            <div className="mt-2 border-t pt-2">
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Puede ver
                              </p>
                              <PermisosGrid
                                seleccionados={a.permisos ?? PERMISOS_TODOS}
                                onToggle={(p) => togglePermisoAdmin(a.id, p)}
                              />
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

                  <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:bg-red-950/30">
                    <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-red-600">
                      <AlertTriangle className="h-4 w-4" /> Zona de pruebas
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Borra TODOS los turnos y reportes guardados (Supabase y
                      este dispositivo). Útil para probar el sistema desde
                      cero. Los precios y la lista de trabajadores NO se
                      borran.
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
            Esta acción no se puede deshacer. Se borrarán todas las sesiones
            (turnos activos y días ya cerrados) de Supabase y de este
            dispositivo.
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
}: {
  precios: import("@/lib/types").Precios;
  onChange: (k: PrecioKey, v: number) => void;
}) {
  const combustibles: PrecioKey[] = ["bio", "regular", "premium", "glp"];
  const balones: PrecioKey[] = ["gasfull", "zetagas"];
  const label = (k: PrecioKey) =>
    (PRODUCTOS as Record<string, string>)[k] ??
    (BALONES as Record<string, string>)[k] ??
    k;

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
          Los cambios se aplican en todo el sistema (turnos y reportes) en tiempo
          real.
        </p>
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
                    onCommit={(v) => onChange(k, v)}
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
                    onCommit={(v) => onChange(k, v)}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Cuadrícula de casillas para elegir qué secciones puede ver un admin. Se usa
// tanto al crear un admin nuevo como al editar uno existente.
function PermisosGrid({
  seleccionados,
  onToggle,
}: {
  seleccionados: Permiso[];
  onToggle: (p: Permiso) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {PERMISOS.map((p) => {
        const activo = seleccionados.includes(p.id);
        return (
          <label
            key={p.id}
            className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-accent"
          >
            <input
              type="checkbox"
              checked={activo}
              onChange={() => onToggle(p.id)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            <span className={cn(!activo && "text-muted-foreground")}>
              {p.label}
            </span>
          </label>
        );
      })}
    </div>
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
