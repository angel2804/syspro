"use client";

// Bitácora de auditoría consultable (acciones importantes del sistema).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ScrollText } from "lucide-react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchAuditoria, type AccionAudit, type FilaAudit } from "@/lib/data/auditoria";
import { usePermisoGuard } from "@/lib/use-permiso-guard";

const ACCIONES: { value: AccionAudit | "todas"; label: string }[] = [
  { value: "todas", label: "Todas las acciones" },
  { value: "credito_creado", label: "Crédito creado" },
  { value: "credito_anulado", label: "Crédito anulado" },
  { value: "pago_registrado", label: "Pago registrado" },
  { value: "pago_anulado", label: "Pago anulado" },
  { value: "registro_turno", label: "Registro de turno" },
  { value: "cliente_fusionado", label: "Cliente fusionado" },
  { value: "cliente_editado", label: "Cliente editado" },
  { value: "cliente_inactivado", label: "Cliente inactivado" },
  { value: "cliente_eliminado", label: "Cliente eliminado" },
  { value: "alias_agregado", label: "Alias agregado" },
  { value: "cambio_precio", label: "Cambio de precio" },
  { value: "precio_creditos_masivo", label: "Precio masivo" },
  { value: "cierre_turno", label: "Cierre de turno" },
];

const fecha = (ms: number) =>
  new Date(ms).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "medium" });

const ACCION_LABEL = new Map(ACCIONES.map((a) => [a.value, a.label]));
const texto = (v: unknown) => (v == null || v === "" ? "" : String(v));
const soles = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? `S/ ${n.toFixed(2)}` : "";
};

function detalleLegible(f: FilaAudit): string {
  const d = f.detalle ?? {};
  if (f.accion === "cambio_precio") {
    if ("precio_credito" in d) return d.precio_credito == null ? "Quitó precio especial del cliente" : `Cambió precio especial a ${soles(d.precio_credito)}`;
    if ("ajuste_precio" in d) return d.ajuste_precio == null ? "Quitó ajuste de precio de un crédito" : `Ajustó precio de un crédito a ${soles(d.ajuste_precio)}`;
    return `Cambió precio de ${texto(d.producto)} de ${soles(d.anterior)} a ${soles(d.nuevo)}`;
  }
  if (typeof d.mensaje === "string") return d.mensaje;
  if (f.accion === "cambio_precio") return "Cambió un precio";
  if (f.accion === "credito_creado") return `Creó crédito ${d.vale ? `vale ${d.vale}` : ""}`;
  if (f.accion === "pago_registrado") return `Registró pago de S/ ${d.monto ?? ""}`;
  if (f.accion === "usuario_creado") return `Creó usuario ${texto(d.email)} como ${texto(d.rol)}`;
  if (f.accion === "usuario_editado") {
    const partes = [
      d.nombre ? `nombre: ${d.nombre}` : "",
      d.rol ? `rol: ${d.rol}` : "",
      d.activo !== undefined ? `estado: ${d.activo ? "activo" : "inactivo"}` : "",
      d.auditoria_activa !== undefined ? `auditoría: ${d.auditoria_activa ? "activa" : "apagada"}` : "",
      Array.isArray(d.permisos) ? `permisos: ${d.permisos.length}` : "",
    ].filter(Boolean);
    return partes.length ? `Editó usuario (${partes.join(", ")})` : "Editó usuario";
  }
  if (f.accion === "usuario_password") return d.cuenta === "trabajador" ? "Cambió la clave de trabajador" : "Cambió una clave";
  if (f.accion === "alias_agregado") {
    if (d.validacion) return "Validó un cliente pendiente";
    if (d.alias) return `Agregó alias ${d.alias}`;
    if ("grupo_id" in d) return d.grupo_id ? "Asignó el cliente a un grupo" : "Quitó el cliente de un grupo";
    return "Actualizó datos auxiliares del cliente";
  }
  if (f.accion === "cliente_fusionado") return `Fusionó ${texto(d.origen)} con ${texto(d.destino)}`;
  if (f.accion === "precio_creditos_masivo") return `Cambió ${texto(d.creditos_actualizados)} créditos de ${texto(d.producto)} a ${soles(d.precio_ajustado)}`;
  if (f.accion === "credito_anulado") return d.motivo ? `Anuló crédito: ${d.motivo}` : "Anuló crédito";
  if (f.accion === "pago_anulado") return d.motivo ? `Anuló pago: ${d.motivo}` : "Anuló pago";
  if (f.accion === "edicion_sesion") {
    if (d.correccion === "precios_periodo") return `Corrigió precios del turno ${texto(d.turno)} del día ${texto(d.dia)}`;
    if (d.correccion === "liberar_turno") return `Liberó turno ${texto(d.turno)} de ${texto(d.trabajador)}`;
    return `Corrigió reporte del día ${texto(d.dia)} (${texto(d.isla)} ${texto(d.turno)})`;
  }
  if (f.accion === "exportacion") return `Generó reporte ${texto(d.formato)} ${texto(d.tipo)}`;
  if (f.accion === "registro_turno") return texto(d.campo) ? `Cambió ${texto(d.campo)}` : "Registró cambio en turno";
  if (f.accion === "cambio_precio" && "precio_credito" in d) return d.precio_credito == null ? "Quitó precio especial del cliente" : `Cambió precio especial a ${soles(d.precio_credito)}`;
  if (f.accion === "cambio_precio" && "ajuste_precio" in d) return d.ajuste_precio == null ? "Quitó ajuste de precio de un crédito" : `Ajustó precio de un crédito a ${soles(d.ajuste_precio)}`;
  return Object.keys(d).length ? "Detalle registrado" : "Sin detalle";
}

export default function AuditoriaPage() {
  const { listo, permitido } = usePermisoGuard("auditoria");
  const [filas, setFilas] = useState<FilaAudit[]>([]);
  const [accion, setAccion] = useState<AccionAudit | "todas">("todas");
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setFilas(await fetchAuditoria({ accion: accion === "todas" ? undefined : accion, limite: 300 }));
    } catch (e) {
      toast.error("No se pudo cargar la bitácora: " + (e as Error).message);
    } finally {
      setCargando(false);
    }
  }, [accion]);

  /* eslint-disable react-hooks/set-state-in-effect --
     Carga desde Supabase (sistema externo); el setState ocurre tras el await. */
  useEffect(() => {
    cargar();
  }, [cargar]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!listo || !permitido) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Verificando acceso…
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <ScrollText className="size-5 text-sky-600" />
        <h1 className="text-lg font-semibold">Auditoría</h1>
        <div className="ml-auto w-56">
          <Select value={accion} onValueChange={(v) => setAccion((v as AccionAudit) ?? "todas")}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCIONES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Entidad</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Detalle</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cargando ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Cargando…
                </TableCell>
              </TableRow>
            ) : filas.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Sin registros.
                </TableCell>
              </TableRow>
            ) : (
              filas.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="whitespace-nowrap text-xs">{fecha(f.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {ACCION_LABEL.get(f.accion as AccionAudit) ?? f.accion}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {f.entidad}
                    {f.entidadId ? ` · ${f.entidadId.slice(0, 8)}` : ""}
                  </TableCell>
                  <TableCell>{f.actorNombre ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={JSON.stringify(f.detalle)}>
                    {detalleLegible(f)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
