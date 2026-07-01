"use client";

// ============================================================================
// Créditos por cliente (cuenta corriente). Estado de cuenta agrupado por
// cliente, registro de pagos (admin) y de créditos, anti-duplicados al crear
// clientes, fusión y exportación del estado de cuenta.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Download, FileText, GitMerge, Plus, Search, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PRODUCTOS } from "@/lib/config";
import type { ProductoId } from "@/lib/types";
import {
  construirCSVEstadoCuenta,
  formatoSaldo,
  type EstadoCliente,
} from "@/lib/domain/cuenta-corriente";
import { resolverCliente, type AliasRef, type ClienteRef } from "@/lib/domain/clientes";
import { imprimirEstadoCuenta } from "@/lib/pdf";
import {
  aClienteRef,
  crearCliente,
  fetchAlias,
  fetchClientes,
  fusionarClientes,
  type Cliente,
} from "@/lib/data/clientes";
import {
  anularCredito,
  anularPago,
  crearCredito,
  estadoCuentaCliente,
  fetchSaldos,
  registrarPago,
  type EstadoCuentaCliente,
  type SaldoCliente,
} from "@/lib/data/creditos";
import { usePermisoGuard } from "@/lib/use-permiso-guard";

const soles = (n: number) => "S/ " + (n || 0).toFixed(2);
const fechaLarga = (ms: number) =>
  new Date(ms).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
// Fecha corta dd/mm/aaaa para la tabla principal del estado de cuenta.
const fechaCorta = (ms: number) =>
  new Date(ms).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });
// Inicio (00:00) y fin (23:59:59.999) del día local de un input <date> (YYYY-MM-DD).
function inicioDia(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}
function finDia(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

type Filtro = "todos" | "con-deuda" | "sin-deuda" | "saldo-favor" | "pendientes";

const ESTADO_BADGE: Record<EstadoCliente, { txt: string; cls: string }> = {
  "con-deuda": { txt: "Con deuda", cls: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" },
  "sin-deuda": { txt: "Sin deuda", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  "saldo-favor": { txt: "Saldo a favor", cls: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" },
};

function estadoDeSaldo(deuda: number): EstadoCliente {
  if (deuda > 0.005) return "con-deuda";
  if (deuda < -0.005) return "saldo-favor";
  return "sin-deuda";
}

function descargarCSV(nombre: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

// Reporte: todos los clientes con deuda (deudaPendiente > 0), mayor deuda primero.
function exportarClientesConDeuda(saldos: SaldoCliente[]) {
  const conDeuda = saldos
    .filter((s) => s.deudaPendiente > 0.005)
    .sort((a, b) => b.deudaPendiente - a.deudaPendiente);
  const filas = [
    ["Cliente", "Total créditos", "Total pagos", "Deuda pendiente"],
    ...conDeuda.map((s) => [
      s.nombre,
      s.totalCreditos.toFixed(2),
      s.totalPagos.toFixed(2),
      s.deudaPendiente.toFixed(2),
    ]),
    ["TOTAL", "", "", conDeuda.reduce((a, s) => a + s.deudaPendiente, 0).toFixed(2)],
  ];
  const csv = filas
    .map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(","))
    .join("\n");
  descargarCSV("clientes-con-deuda.csv", csv);
}

export default function CreditosPage() {
  const { listo, permitido } = usePermisoGuard("creditos");
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [saldos, setSaldos] = useState<SaldoCliente[]>([]);
  const [alias, setAlias] = useState<AliasRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selId, setSelId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<EstadoCuentaCliente | null>(null);

  const recargarListado = useCallback(async () => {
    setCargando(true);
    try {
      const [cs, ss, al] = await Promise.all([fetchClientes(), fetchSaldos(), fetchAlias()]);
      setClientes(cs);
      setSaldos(ss);
      setAlias(al);
    } catch (e) {
      toast.error("No se pudo cargar: " + (e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  const recargarDetalle = useCallback(async (id: string) => {
    try {
      setDetalle(await estadoCuentaCliente(id));
    } catch (e) {
      toast.error("No se pudo cargar el detalle: " + (e as Error).message);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect --
     Sincronización con Supabase (sistema externo) al montar y al cambiar el
     cliente seleccionado. El setState real ocurre dentro de funciones async
     tras el await; es el uso correcto de un efecto para datos remotos, no el
     setState de render que la regla busca evitar. */
  useEffect(() => {
    recargarListado();
  }, [recargarListado]);

  useEffect(() => {
    if (selId) recargarDetalle(selId);
    else setDetalle(null);
  }, [selId, recargarDetalle]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saldoPorId = useMemo(() => {
    const m = new Map<string, SaldoCliente>();
    for (const s of saldos) m.set(s.clienteId, s);
    return m;
  }, [saldos]);

  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return clientes
      .filter((c) => c.estado !== "fusionado")
      .filter((c) => (q ? c.nombre.toLowerCase().includes(q) : true))
      .filter((c) => {
        if (filtro === "pendientes") return c.estado === "pendiente";
        const deuda = saldoPorId.get(c.id)?.deudaPendiente ?? 0;
        const est = estadoDeSaldo(deuda);
        if (filtro === "con-deuda") return est === "con-deuda";
        if (filtro === "sin-deuda") return est === "sin-deuda";
        if (filtro === "saldo-favor") return est === "saldo-favor";
        return true;
      })
      .sort((a, b) => (saldoPorId.get(b.id)?.deudaPendiente ?? 0) - (saldoPorId.get(a.id)?.deudaPendiente ?? 0));
  }, [clientes, busqueda, filtro, saldoPorId]);

  const selCliente = clientes.find((c) => c.id === selId) ?? null;
  const refs: ClienteRef[] = useMemo(() => clientes.map(aClienteRef), [clientes]);

  async function refrescarTodo() {
    await recargarListado();
    if (selId) await recargarDetalle(selId);
  }

  if (!listo || !permitido) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Verificando acceso…
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-7xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <Users className="size-5 text-sky-600" />
        <h1 className="text-lg font-semibold">Créditos por cliente</h1>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarClientesConDeuda(saldos)}
            disabled={saldos.every((s) => s.deudaPendiente <= 0.005)}
          >
            <Download className="size-4" /> Clientes con deuda
          </Button>
          <NuevoClienteDialog refs={refs} alias={alias} onCreado={refrescarTodo} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* Panel izquierdo: buscador + filtros + lista */}
        <aside className="flex flex-col gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar cliente…"
              className="pl-8"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              ["todos", "Todos"],
              ["con-deuda", "Con deuda"],
              ["sin-deuda", "Sin deuda"],
              ["saldo-favor", "A favor"],
              ["pendientes", "Pendientes"],
            ] as [Filtro, string][]).map(([id, txt]) => (
              <button
                key={id}
                onClick={() => setFiltro(id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  filtro === id ? "bg-sky-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {txt}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border">
            {cargando ? (
              <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
            ) : lista.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Sin clientes para este filtro.</p>
            ) : (
              <ul className="divide-y">
                {lista.map((c) => {
                  const deuda = saldoPorId.get(c.id)?.deudaPendiente ?? 0;
                  const est = estadoDeSaldo(deuda);
                  return (
                    <li key={c.id}>
                      <button
                        onClick={() => setSelId(c.id)}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50 ${
                          selId === c.id ? "bg-muted" : ""
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{c.nombre}</span>
                          {c.estado === "pendiente" && (
                            <span className="text-[11px] text-amber-600">pendiente de revisión</span>
                          )}
                        </span>
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                            est === "con-deuda"
                              ? "text-red-600"
                              : est === "saldo-favor"
                                ? "text-sky-600"
                                : "text-emerald-600"
                          }`}
                        >
                          {formatoSaldo(-deuda)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Panel derecho: detalle del cliente */}
        <section className="min-w-0">
          {!selCliente ? (
            <div className="flex h-full min-h-64 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
              Selecciona un cliente para ver su estado de cuenta.
            </div>
          ) : (
            <DetalleCliente
              cliente={selCliente}
              detalle={detalle}
              clientes={clientes}
              onCambio={refrescarTodo}
            />
          )}
        </section>
      </div>
    </div>
  );
}

// ============================================================================
// Detalle de un cliente: resumen + acciones + estado de cuenta / créditos / pagos
// ============================================================================
function DetalleCliente({
  cliente,
  detalle,
  clientes,
  onCambio,
}: {
  cliente: Cliente;
  detalle: EstadoCuentaCliente | null;
  clientes: Cliente[];
  onCambio: () => Promise<void>;
}) {
  const resumen = detalle?.resumen;
  const est = resumen ? resumen.estado : "sin-deuda";

  // Filtro por rango de fechas para el estado de cuenta (inclusivo). Vacío = sin límite.
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const filasFiltradas = useMemo(() => {
    const min = desde ? inicioDia(desde) : -Infinity;
    const max = hasta ? finDia(hasta) : Infinity;
    return (detalle?.filas ?? []).filter((f) => f.fecha >= min && f.fecha <= max);
  }, [detalle, desde, hasta]);

  function exportar() {
    if (!detalle) return;
    const csv = construirCSVEstadoCuenta(cliente.nombre, filasFiltradas, detalle.resumen);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estado-cuenta-${cliente.nombre}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportarPDF() {
    if (!detalle) return;
    const ok = imprimirEstadoCuenta({
      nombreCliente: cliente.nombre,
      filas: filasFiltradas,
      resumen: detalle.resumen,
      rango: { desde: desde || undefined, hasta: hasta || undefined },
    });
    if (!ok) {
      toast.error("El navegador bloqueó la ventana. Permite las ventanas emergentes para generar el PDF.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{cliente.nombre}</h2>
          <Badge className={ESTADO_BADGE[est].cls}>{ESTADO_BADGE[est].txt}</Badge>
          <div className="ml-auto flex flex-wrap gap-2">
            <RegistrarCreditoDialog clienteId={cliente.id} onListo={onCambio} />
            <RegistrarPagoDialog
              clienteId={cliente.id}
              deuda={resumen?.deudaPendiente ?? 0}
              onListo={onCambio}
            />
            <FusionarDialog cliente={cliente} clientes={clientes} onListo={onCambio} />
            <Button variant="outline" size="sm" onClick={exportar} disabled={!detalle}>
              <Download className="size-4" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={exportarPDF} disabled={!detalle}>
              <FileText className="size-4" /> PDF
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Resumen label="Total créditos" valor={soles(resumen?.totalCreditos ?? 0)} />
          <Resumen label="Total pagos" valor={soles(resumen?.totalPagos ?? 0)} />
          <Resumen
            label="Deuda pendiente"
            valor={formatoSaldo(-(resumen?.deudaPendiente ?? 0))}
            destacar={est}
          />
        </div>
      </div>

      <Tabs defaultValue="estado">
        <TabsList>
          <TabsTrigger value="estado">Estado de cuenta</TabsTrigger>
          <TabsTrigger value="creditos">Créditos</TabsTrigger>
          <TabsTrigger value="pagos">Pagos</TabsTrigger>
        </TabsList>

        {/* Estado de cuenta: formato obligatorio */}
        <TabsContent value="estado">
          <div className="mb-2 flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="ec-desde" className="text-xs">Desde</Label>
              <Input id="ec-desde" type="date" className="h-8" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ec-hasta" className="text-xs">Hasta</Label>
              <Input id="ec-hasta" type="date" className="h-8" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
            {(desde || hasta) && (
              <Button variant="ghost" size="sm" onClick={() => { setDesde(""); setHasta(""); }}>
                Limpiar
              </Button>
            )}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Galones</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Vale</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Total crédito</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead className="text-right">Deuda pendiente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filasFiltradas.map((f) => (
                  <TableRow key={f.movimientoId}>
                    <TableCell className="whitespace-nowrap tabular-nums">{fechaCorta(f.fecha)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.galones ?? ""}</TableCell>
                    <TableCell>{f.producto ? PRODUCTOS[f.producto] : ""}</TableCell>
                    <TableCell>{f.vale ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.precio != null ? f.precio.toFixed(2) : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.totalCredito != null ? f.totalCredito.toFixed(2) : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">
                      {f.pago != null ? f.pago.toFixed(2) : ""}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        f.saldoAcumulado < -0.005 ? "text-red-600" : f.saldoAcumulado > 0.005 ? "text-sky-600" : ""
                      }`}
                    >
                      {formatoSaldo(f.saldoAcumulado)}
                    </TableCell>
                  </TableRow>
                ))}
                {filasFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      Sin movimientos.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Créditos (historial con fecha) */}
        <TabsContent value="creditos">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Turno</TableHead>
                  <TableHead>Isla</TableHead>
                  <TableHead>Trabajador</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Galones</TableHead>
                  <TableHead>Vale</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detalle?.creditos ?? []).map((c) => (
                  <TableRow key={c.id} className={c.estado !== "activo" ? "opacity-50" : ""}>
                    <TableCell className="whitespace-nowrap">{fechaLarga(c.fecha)}</TableCell>
                    <TableCell>{c.turno ?? ""}</TableCell>
                    <TableCell>{c.islaId ?? ""}</TableCell>
                    <TableCell>{c.trabajadorNombre ?? ""}</TableCell>
                    <TableCell>{PRODUCTOS[c.producto]}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.galones}</TableCell>
                    <TableCell>{c.vale}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.precioUnitario.toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.total.toFixed(2)}</TableCell>
                    <TableCell>
                      {c.estado === "activo" ? (
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={async () => {
                            await anularCredito(c.id, "Admin");
                            toast.success("Crédito anulado");
                            await onCambio();
                          }}
                        >
                          Anular
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{c.estado}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Pagos (historial con fecha) */}
        <TabsContent value="pagos">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Registró</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Referencia</TableHead>
                  <TableHead className="text-right">Monto</TableHead>
                  <TableHead>Observación</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detalle?.pagos ?? []).map((p) => (
                  <TableRow key={p.id} className={p.estado !== "activo" ? "opacity-50" : ""}>
                    <TableCell className="whitespace-nowrap">{fechaLarga(p.fecha)}</TableCell>
                    <TableCell>{p.registradoPorNombre ?? ""}</TableCell>
                    <TableCell>{p.metodoPago ?? ""}</TableCell>
                    <TableCell>{p.referencia ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">{p.monto.toFixed(2)}</TableCell>
                    <TableCell>{p.observacion ?? ""}</TableCell>
                    <TableCell>
                      {p.estado === "activo" ? (
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={async () => {
                            await anularPago(p.id, "Admin");
                            toast.success("Pago anulado");
                            await onCambio();
                          }}
                        >
                          Anular
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{p.estado}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Resumen({ label, valor, destacar }: { label: string; valor: string; destacar?: EstadoCliente }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-bold tabular-nums ${
          destacar === "con-deuda" ? "text-red-600" : destacar === "saldo-favor" ? "text-sky-600" : ""
        }`}
      >
        {valor}
      </div>
    </div>
  );
}

// ============================================================================
// Diálogos
// ============================================================================
function NuevoClienteDialog({
  refs,
  alias,
  onCreado,
}: {
  refs: ClienteRef[];
  alias: AliasRef[];
  onCreado: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const resolucion = nombre.trim() ? resolverCliente(nombre, refs, alias) : null;
  const bloqueado = resolucion?.tipo === "confirmar";

  async function crear(forzar = false) {
    if (!nombre.trim()) return;
    if (resolucion?.tipo === "exacto") {
      toast.info("Ese cliente ya existe: " + resolucion.cliente.nombre);
      return;
    }
    if (bloqueado && !forzar) return;
    setGuardando(true);
    try {
      await crearCliente({ nombre, creadoPorNombre: "Admin" });
      toast.success("Cliente creado");
      setNombre("");
      setOpen(false);
      await onCreado();
    } catch (e) {
      toast.error("No se pudo crear: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Nuevo cliente
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>
            Se detectan nombres parecidos para evitar duplicados.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="nc-nombre">Nombre</Label>
            <Input
              id="nc-nombre"
              value={nombre}
              autoFocus
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Belquer"
            />
          </div>
          {resolucion && resolucion.tipo !== "nuevo" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              {resolucion.tipo === "exacto" ? (
                <p>Ya existe: <b>{resolucion.cliente.nombre}</b>.</p>
              ) : (
                <>
                  <p className="mb-1 font-medium">¿Quisiste decir…?</p>
                  <ul className="list-disc pl-5">
                    {resolucion.sugerencias.slice(0, 3).map((s) => (
                      <li key={s.cliente.id}>
                        {s.cliente.nombre}{" "}
                        <span className="text-muted-foreground">
                          ({Math.round(s.similitud * 100)}%{s.viaAlias ? `, alias ${s.viaAlias}` : ""})
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {bloqueado ? (
            <Button variant="destructive" disabled={guardando} onClick={() => crear(true)}>
              Crear de todos modos
            </Button>
          ) : (
            <Button disabled={guardando || !nombre.trim() || resolucion?.tipo === "exacto"} onClick={() => crear()}>
              Crear cliente
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegistrarPagoDialog({
  clienteId,
  deuda,
  onListo,
}: {
  clienteId: string;
  deuda: number;
  onListo: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const m = parseFloat(monto);
    if (!(m > 0)) return toast.error("Monto inválido");
    setGuardando(true);
    try {
      await registrarPago({
        clienteId,
        monto: m,
        metodoPago: metodo,
        referencia: referencia || undefined,
        observacion: obs || undefined,
        registradoPorNombre: "Admin",
      });
      toast.success("Pago registrado");
      setMonto("");
      setReferencia("");
      setObs("");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error("No se pudo registrar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        Registrar pago
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            Se aplica contra la deuda total del cliente (deuda actual: {soles(deuda)}).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="pago-monto">Monto</Label>
            <Input
              id="pago-monto"
              type="number"
              inputMode="decimal"
              value={monto}
              autoFocus
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>
          <div>
            <Label>Método</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v ?? "efectivo")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["efectivo", "yape", "transferencia", "visa", "culqui"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pago-ref">Referencia (opcional)</Label>
            <Input id="pago-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pago-obs">Observación (opcional)</Label>
            <Input id="pago-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={guardando} onClick={guardar}>
            Guardar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RegistrarCreditoDialog({
  clienteId,
  onListo,
}: {
  clienteId: string;
  onListo: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [producto, setProducto] = useState<ProductoId>("bio");
  const [galones, setGalones] = useState("");
  const [vale, setVale] = useState("");
  const [precio, setPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);

  const total = (parseFloat(galones) || 0) * (parseFloat(precio) || 0);

  async function guardar() {
    if (!vale.trim()) return toast.error("El vale es obligatorio");
    const g = parseFloat(galones);
    const p = parseFloat(precio);
    if (!(g > 0)) return toast.error("Galones inválidos");
    if (!(p >= 0)) return toast.error("Precio inválido");
    setGuardando(true);
    try {
      await crearCredito({
        clienteId,
        producto,
        galones: g,
        vale: vale.trim(),
        precioUnitario: p,
        trabajadorNombre: "Admin",
      });
      toast.success("Crédito registrado");
      setGalones("");
      setVale("");
      setPrecio("");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error("No se pudo registrar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Crédito
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar crédito (vale)</DialogTitle>
          <DialogDescription>El precio queda congelado en este crédito.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Producto</Label>
            <Select value={producto} onValueChange={(v) => v && setProducto(v as ProductoId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRODUCTOS) as ProductoId[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRODUCTOS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cr-gal">Galones</Label>
              <Input id="cr-gal" type="number" inputMode="decimal" value={galones} onChange={(e) => setGalones(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cr-precio">Precio</Label>
              <Input id="cr-precio" type="number" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="cr-vale">Vale (obligatorio)</Label>
            <Input id="cr-vale" value={vale} onChange={(e) => setVale(e.target.value)} placeholder="Ej. 0001" />
          </div>
          <p className="text-sm text-muted-foreground">Total: {soles(total)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={guardando} onClick={guardar}>
            Guardar crédito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FusionarDialog({
  cliente,
  clientes,
  onListo,
}: {
  cliente: Cliente;
  clientes: Cliente[];
  onListo: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [destinoId, setDestinoId] = useState("");
  const [guardando, setGuardando] = useState(false);

  const candidatos = clientes.filter((c) => c.id !== cliente.id && c.estado !== "fusionado");

  async function fusionar() {
    const destino = clientes.find((c) => c.id === destinoId);
    if (!destino) return toast.error("Elige el cliente destino");
    setGuardando(true);
    try {
      await fusionarClientes(cliente, destino, "Admin");
      toast.success(`"${cliente.nombre}" fusionado en "${destino.nombre}"`);
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error("No se pudo fusionar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <GitMerge className="size-4" /> Fusionar
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionar cliente</DialogTitle>
          <DialogDescription>
            Mueve los créditos, pagos y alias de <b>{cliente.nombre}</b> a otro cliente
            oficial. {cliente.nombre} quedará como alias del destino (no se borra).
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label>Cliente destino (se conserva)</Label>
          <Select value={destinoId} onValueChange={(v) => setDestinoId(v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {candidatos.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={guardando || !destinoId} onClick={fusionar}>
            Fusionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
