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
  { value: "cliente_fusionado", label: "Cliente fusionado" },
  { value: "alias_agregado", label: "Alias agregado" },
  { value: "cambio_precio", label: "Cambio de precio" },
  { value: "cierre_turno", label: "Cierre de turno" },
];

const fecha = (ms: number) =>
  new Date(ms).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "medium" });

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
                  <TableCell className="whitespace-nowrap font-medium">{f.accion}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {f.entidad}
                    {f.entidadId ? ` · ${f.entidadId.slice(0, 8)}` : ""}
                  </TableCell>
                  <TableCell>{f.actorNombre ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={JSON.stringify(f.detalle)}>
                    {JSON.stringify(f.detalle)}
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
