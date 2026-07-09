"use client";

// ============================================================================
// Créditos por cliente (cuenta corriente). Estado de cuenta agrupado por
// cliente, registro de pagos (admin) y de créditos, anti-duplicados al crear
// clientes, fusión y exportación del estado de cuenta.
// ============================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  Check,
  Download,
  FileText,
  Search,
  Users,
  Pencil,
  X,
  Folder,
  ChevronRight,
  ChevronDown,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  construirEstadoCuenta,
  formatoSaldo,
  precioEfectivoCredito,
  resumenCliente,
  totalCredito,
  type CreditoCC,
  type EstadoCliente,
  type PagoCC,
} from "@/lib/domain/cuenta-corriente";
import { type AliasRef, type ClienteRef } from "@/lib/domain/clientes";
import {
  aClienteRef,
  fetchAlias,
  fetchClientes,
  validarCliente,
  setPrecioCreditoCliente,
  setGrupoCliente,
  renombrarCliente,
  type Cliente,
} from "@/lib/data/clientes";
import {
  anularCredito,
  anularPago,
  ajustarPrecioCredito,
  estadoCuentaCliente,
  estadoCuentaGrupo,
  fetchCreditos,
  fetchPagos,
  fetchSaldos,
  type EstadoCuentaCliente,
  type SaldoCliente,
} from "@/lib/data/creditos";
import { usePermisoGuard } from "@/lib/use-permiso-guard";
import { authHeaders } from "@/lib/data/auth";
import { descargarBlob } from "@/lib/utils";
import { soles, fechaLarga, fechaCorta } from "@/features/creditos/format";
import {
  NuevoClienteDialog,
  RegistrarPagoDialog,
  RegistrarCreditoDialog,
  FusionarDialog,
} from "@/features/creditos/dialogs";

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
  "saldo-favor": { txt: "Saldo a favor", cls: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" },
};

function estadoDeSaldo(deuda: number): EstadoCliente {
  if (deuda > 0.005) return "con-deuda";
  if (deuda < -0.005) return "saldo-favor";
  return "sin-deuda";
}

function descargarCSV(nombre: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  descargarBlob(blob, nombre);
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
  const nombreGrifo = useStore((s) => s.nombreGrifo);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [saldos, setSaldos] = useState<SaldoCliente[]>([]);
  const [alias, setAlias] = useState<AliasRef[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [selId, setSelId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<EstadoCuentaCliente | null>(null);
  // Carpetas de grupo expandidas en la lista.
  const [gruposAbiertos, setGruposAbiertos] = useState<Set<string>>(new Set());
  const [exportandoTodos, setExportandoTodos] = useState(false);

  // Exporta el estado de cuenta de TODOS los clientes con movimientos. Cada
  // GRUPO (madre + sub-clientes) sale en UNA sola hoja/sección, con el nombre
  // del sub-cliente correspondiente en cada fila (REDCOL TOMAS, REDCOL MIGUEL…).
  // Los clientes sueltos salen en su propia hoja como antes.
  async function exportarTodosClientes(formato: "xlsx" | "pdf") {
    setExportandoTodos(true);
    try {
      const [creditos, pagos] = await Promise.all([fetchCreditos(), fetchPagos()]);
      const porCliente = new Map<string, { creditos: CreditoCC[]; pagos: PagoCC[] }>();
      const asegurar = (id: string) => {
        let g = porCliente.get(id);
        if (!g) porCliente.set(id, (g = { creditos: [], pagos: [] }));
        return g;
      };
      for (const c of creditos) asegurar(c.clienteId).creditos.push(c);
      for (const p of pagos) asegurar(p.clienteId).pagos.push(p);

      const nombrePorId = new Map(clientes.map((c) => [c.id, c.nombre]));
      const subsPorMadre = new Map<string, Cliente[]>();
      for (const c of clientes) {
        if (c.estado === "fusionado" || !c.grupoId) continue;
        const arr = subsPorMadre.get(c.grupoId) ?? [];
        arr.push(c);
        subsPorMadre.set(c.grupoId, arr);
      }

      const secciones = clientes
        .filter((c) => c.estado !== "fusionado" && !c.grupoId) // los sub-clientes van dentro de su madre
        .map((c) => {
          const subs = subsPorMadre.get(c.id) ?? [];
          const idsGrupo = [c.id, ...subs.map((s) => s.id)];
          // Créditos de la madre + todos los sub-clientes; pagos solo de la madre.
          const creditosG = idsGrupo.flatMap((id) => porCliente.get(id)?.creditos ?? []);
          const pagosG = porCliente.get(c.id)?.pagos ?? [];
          const filas = construirEstadoCuenta(creditosG, pagosG);
          return {
            cliente: c.nombre,
            resumen: resumenCliente(creditosG, pagosG),
            filas: filas.map((f) => ({
              fecha: f.fecha,
              cliente: nombrePorId.get(f.clienteId ?? "") ?? c.nombre,
              galones: f.galones,
              producto: f.producto ? PRODUCTOS[f.producto] : "",
              vale: f.vale ?? "",
              precio: f.precio,
              totalCredito: f.totalCredito,
              pago: f.pago,
              referencia: f.referencia ?? "",
              deudaPendiente: f.saldoAcumulado,
            })),
          };
        })
        .filter((s) => s.filas.length > 0)
        .sort((a, b) => a.cliente.localeCompare(b.cliente, "es"));

      if (secciones.length === 0) {
        toast.error("No hay clientes con movimientos para exportar.");
        return;
      }

      const res = await fetch("/api/export-creditos", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ formato, clientes: secciones, empresa: nombreGrifo }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "No se pudo generar el archivo.");
      }
      const blob = await res.blob();
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/i);
      descargarBlob(blob, match?.[1] ?? `creditos-todos-los-clientes.${formato}`);
      toast.success(`Exportados ${secciones.length} clientes`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExportandoTodos(false);
    }
  }

  const recargarListado = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true);
    try {
      const [cs, ss, al] = await Promise.all([fetchClientes(), fetchSaldos(), fetchAlias()]);
      setClientes(cs);
      setSaldos(ss);
      setAlias(al);
    } catch (e) {
      if (!silencioso) toast.error("No se pudo cargar: " + (e as Error).message);
    } finally {
      if (!silencioso) setCargando(false);
    }
  }, []);

  const recargarDetalle = useCallback(
    async (id: string) => {
      try {
        // Si el cliente es una madre de grupo (tiene sub-clientes), su detalle
        // es el estado de cuenta AGREGADO del grupo; si no, el individual.
        const subIds = clientes
          .filter((c) => c.grupoId === id && c.estado !== "fusionado")
          .map((c) => c.id);
        setDetalle(
          subIds.length
            ? await estadoCuentaGrupo(id, subIds)
            : await estadoCuentaCliente(id)
        );
      } catch (e) {
        toast.error("No se pudo cargar el detalle: " + (e as Error).message);
      }
    },
    [clientes]
  );

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

  useEffect(() => {
    // Respaldo periódico (30s, antes 3s): refresca por si algo cambió en otra
    // PC. A 3s consumía ~10x más ancho de banda del plan gratuito con el panel
    // abierto todo el día.
    const poll = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void recargarListado(true);
      if (selId) void recargarDetalle(selId);
    }, 30000);
    return () => clearInterval(poll);
  }, [recargarListado, recargarDetalle, selId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const saldoPorId = useMemo(() => {
    const m = new Map<string, SaldoCliente>();
    for (const s of saldos) m.set(s.clienteId, s);
    return m;
  }, [saldos]);

  // Árbol de la lista: los sub-clientes se agrupan bajo su cliente madre; el
  // resto se muestra suelto. La deuda de un grupo es la suma de la madre + subs.
  const arbol = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const deudaDe = (id: string) => saldoPorId.get(id)?.deudaPendiente ?? 0;
    const subsPorGrupo = new Map<string, Cliente[]>();
    for (const c of clientes) {
      if (c.estado === "fusionado" || !c.grupoId) continue;
      const arr = subsPorGrupo.get(c.grupoId) ?? [];
      arr.push(c);
      subsPorGrupo.set(c.grupoId, arr);
    }

    type Item =
      | { kind: "solo"; cliente: Cliente; deuda: number }
      | { kind: "grupo"; head: Cliente; subs: Cliente[]; deuda: number };

    const items: Item[] = [];
    for (const c of clientes) {
      if (c.estado === "fusionado" || c.grupoId) continue; // subs van dentro
      const subs = (subsPorGrupo.get(c.id) ?? []).sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es")
      );
      if (subs.length) {
        const deuda = [c, ...subs].reduce((a, x) => a + deudaDe(x.id), 0);
        items.push({ kind: "grupo", head: c, subs, deuda });
      } else {
        items.push({ kind: "solo", cliente: c, deuda: deudaDe(c.id) });
      }
    }

    // Filtro de búsqueda: coincide la madre o cualquier sub.
    const coincide = (c: Cliente) => (q ? c.nombre.toLowerCase().includes(q) : true);
    const pasaFiltro = (deuda: number, cli: Cliente) => {
      if (filtro === "pendientes") return cli.estado === "pendiente";
      const est = estadoDeSaldo(deuda);
      if (filtro === "con-deuda") return est === "con-deuda";
      if (filtro === "sin-deuda") return est === "sin-deuda";
      if (filtro === "saldo-favor") return est === "saldo-favor";
      return true;
    };

    return items
      .filter((it) =>
        it.kind === "grupo"
          ? coincide(it.head) || it.subs.some(coincide)
          : coincide(it.cliente)
      )
      .filter((it) =>
        it.kind === "grupo" ? pasaFiltro(it.deuda, it.head) : pasaFiltro(it.deuda, it.cliente)
      )
      .sort((a, b) => b.deuda - a.deuda);
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
    <div className="min-h-dvh bg-gradient-to-b from-background to-muted/40">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-4 md:p-6">
        <header className="flex items-center gap-3 rounded-xl border border-border/60 bg-card p-3 shadow-sm">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <Users className="size-5 text-primary" />
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarTodosClientes("xlsx")}
            disabled={exportandoTodos || clientes.length === 0}
            title="Excel con una hoja por cliente"
          >
            <Download className="size-4" /> {exportandoTodos ? "Generando…" : "Excel (todos)"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportarTodosClientes("pdf")}
            disabled={exportandoTodos || clientes.length === 0}
            title="PDF con todos los clientes"
          >
            <FileText className="size-4" /> {exportandoTodos ? "Generando…" : "PDF (todos)"}
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
                  filtro === id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {txt}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-lg border">
            {cargando ? (
              <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
            ) : arbol.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Sin clientes para este filtro.</p>
            ) : (
              <ul className="divide-y">
                {arbol.map((it) =>
                  it.kind === "solo" ? (
                    <li key={it.cliente.id}>
                      <FilaCliente
                        cliente={it.cliente}
                        deuda={it.deuda}
                        seleccionado={selId === it.cliente.id}
                        onClick={() => setSelId(it.cliente.id)}
                      />
                    </li>
                  ) : (
                    <li key={it.head.id}>
                      {/* Carpeta de grupo (madre): deuda agregada + expandible */}
                      <div
                        className={`flex w-full items-center gap-1 px-1 ${
                          selId === it.head.id ? "bg-muted" : ""
                        }`}
                      >
                        <button
                          onClick={() =>
                            setGruposAbiertos((prev) => {
                              const n = new Set(prev);
                              if (n.has(it.head.id)) n.delete(it.head.id);
                              else n.add(it.head.id);
                              return n;
                            })
                          }
                          className="rounded p-1 text-muted-foreground hover:bg-muted"
                          aria-label={gruposAbiertos.has(it.head.id) ? "Contraer grupo" : "Expandir grupo"}
                        >
                          {gruposAbiertos.has(it.head.id) ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setSelId(it.head.id)}
                          className="flex min-w-0 flex-1 items-center justify-between gap-2 py-2 pr-2 text-left"
                        >
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Folder className="size-4 shrink-0 text-amber-500" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold">
                                {it.head.nombre}
                              </span>
                              <span className="text-[11px] text-muted-foreground">
                                Grupo · {it.subs.length} sub-cliente{it.subs.length === 1 ? "" : "s"}
                              </span>
                            </span>
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
                              estadoDeSaldo(it.deuda) === "con-deuda"
                                ? "text-red-600"
                                : estadoDeSaldo(it.deuda) === "saldo-favor"
                                  ? "text-amber-600"
                                  : "text-emerald-600"
                            }`}
                          >
                            {formatoSaldo(-it.deuda)}
                          </span>
                        </button>
                      </div>
                      {gruposAbiertos.has(it.head.id) && (
                        <ul className="border-t bg-muted/20">
                          {it.subs.map((s) => (
                            <li key={s.id}>
                              <FilaCliente
                                cliente={s}
                                deuda={saldoPorId.get(s.id)?.deudaPendiente ?? 0}
                                seleccionado={selId === s.id}
                                onClick={() => setSelId(s.id)}
                                sub
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                )}
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
  const nombreGrifo = useStore((s) => s.nombreGrifo);
  const resumen = detalle?.resumen;
  const est = resumen ? resumen.estado : "sin-deuda";

  // Grupo: subs = este cliente es madre; esSub = este cliente cuelga de otra.
  const subs = clientes.filter(
    (c) => c.grupoId === cliente.id && c.estado !== "fusionado"
  );
  const esGrupo = subs.length > 0;
  const esSub = !!cliente.grupoId;
  const madre = esSub ? clientes.find((c) => c.id === cliente.grupoId) : undefined;

  // Filtro por rango de fechas para el estado de cuenta (inclusivo). Vacío = sin límite.
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const filasFiltradas = useMemo(() => {
    const min = desde ? inicioDia(desde) : -Infinity;
    const max = hasta ? finDia(hasta) : Infinity;
    return (detalle?.filas ?? []).filter((f) => f.fecha >= min && f.fecha <= max);
  }, [detalle, desde, hasta]);

  // Nombre por id de cliente, para etiquetar cada fila con su sub-cliente en el
  // Excel de un grupo (REDCOL TOMAS, REDCOL MIGUEL, …).
  const nombrePorId = useMemo(
    () => new Map(clientes.map((c) => [c.id, c.nombre])),
    [clientes]
  );

  async function exportar(formato: "xlsx" | "pdf") {
    if (!detalle) return;
    try {
      const res = await fetch("/api/export-creditos", {
        method: "POST",
        headers: await authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          formato,
          cliente: cliente.nombre,
          resumen: detalle.resumen,
          empresa: nombreGrifo,
          rango: { desde: desde || undefined, hasta: hasta || undefined },
          filas: filasFiltradas.map((f) => ({
            fecha: f.fecha,
            cliente: nombrePorId.get(f.clienteId ?? "") ?? cliente.nombre,
            galones: f.galones,
            producto: f.producto ? PRODUCTOS[f.producto] : "",
            vale: f.vale ?? "",
            precio: f.precio,
            totalCredito: f.totalCredito,
            pago: f.pago,
            referencia: f.referencia ?? "",
            deudaPendiente: f.saldoAcumulado,
          })),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || "No se pudo generar el archivo.");
      }
      const blob = await res.blob();
      const fallback = `creditos-${cliente.nombre}.${formato}`;
      const contentDisposition = res.headers.get("content-disposition") ?? "";
      const match = contentDisposition.match(/filename="?([^"]+)"?/i);
      descargarBlob(blob, match?.[1] ?? fallback);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">{cliente.nombre}</h2>
          <Badge className={ESTADO_BADGE[est].cls}>{ESTADO_BADGE[est].txt}</Badge>
          {esGrupo && (
            <Badge variant="secondary" className="gap-1 text-amber-600">
              <Folder className="size-3" /> Grupo · {subs.length} sub-cliente
              {subs.length === 1 ? "" : "s"}
            </Badge>
          )}
          {esSub && madre && (
            <Badge variant="secondary">Sub-cliente de {madre.nombre}</Badge>
          )}
          {cliente.estado === "pendiente" && (
            <Badge variant="secondary" className="text-amber-600">
              Pendiente de revisión
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            {cliente.estado === "pendiente" && (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await validarCliente(cliente.id, "Admin");
                    toast.success("Cliente validado");
                    await onCambio();
                  } catch (e) {
                    toast.error("No se pudo validar: " + (e as Error).message);
                  }
                }}
              >
                <CheckCircle2 className="size-4" /> Validar cliente
              </Button>
            )}
            <RegistrarCreditoDialog clienteId={cliente.id} onListo={onCambio} />
            {esSub ? (
              <span className="inline-flex items-center rounded-md border border-dashed px-2.5 py-1 text-xs text-muted-foreground">
                Los pagos se registran en el grupo{madre ? ` ${madre.nombre}` : ""}
              </span>
            ) : (
              <RegistrarPagoDialog
                clienteId={cliente.id}
                deuda={resumen?.deudaPendiente ?? 0}
                onListo={onCambio}
              />
            )}
            <FusionarDialog cliente={cliente} clientes={clientes} onListo={onCambio} />
            <Button variant="outline" size="sm" onClick={() => exportar("xlsx")} disabled={!detalle}>
              <Download className="size-4" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportar("pdf")} disabled={!detalle}>
              <FileText className="size-4" /> PDF
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <Resumen
            label={esGrupo ? "Créditos del grupo" : "Total créditos"}
            valor={soles(resumen?.totalCreditos ?? 0)}
          />
          <Resumen label="Total pagos" valor={soles(resumen?.totalPagos ?? 0)} />
          <Resumen
            label={esGrupo ? "Deuda del grupo" : "Deuda pendiente"}
            valor={formatoSaldo(-(resumen?.deudaPendiente ?? 0))}
            destacar={est}
          />
        </div>

        <ConfigCliente cliente={cliente} clientes={clientes} onCambio={onCambio} />
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
                  <TableHead>Referencia</TableHead>
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
                      {f.tipo === "credito" && f.precio != null ? (
                        <PrecioCreditoEditable
                          creditoId={f.movimientoId}
                          precio={f.precio}
                          onCambio={onCambio}
                        />
                      ) : f.precio != null ? (
                        f.precio.toFixed(2)
                      ) : (
                        ""
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.totalCredito != null ? f.totalCredito.toFixed(2) : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-600">
                      {f.pago != null ? f.pago.toFixed(2) : ""}
                    </TableCell>
                    <TableCell>{f.referencia ?? ""}</TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        f.saldoAcumulado < -0.005 ? "text-red-600" : f.saldoAcumulado > 0.005 ? "text-amber-600" : ""
                      }`}
                    >
                      {formatoSaldo(f.saldoAcumulado)}
                    </TableCell>
                  </TableRow>
                ))}
                {filasFiltradas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
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
                    <TableCell className="text-right tabular-nums">
                      {precioEfectivoCredito(c).toFixed(2)}
                      {precioEfectivoCredito(c) !== c.precioUnitario && (
                        <span className="ml-1 text-[10px] text-muted-foreground line-through">
                          {c.precioUnitario.toFixed(2)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{totalCredito(c).toFixed(2)}</TableCell>
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

// Precio de un crédito con lápiz para editarlo (descuento interno). Vacío o 0
// negativo se rechaza; borrar el campo quita el ajuste (vuelve al precio base).
function PrecioCreditoEditable({
  creditoId,
  precio,
  onCambio,
}: {
  creditoId: string;
  precio: number;
  onCambio: () => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(precio.toFixed(2));
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const txt = valor.trim();
    const v = txt === "" ? null : Number(txt);
    if (v != null && (Number.isNaN(v) || v < 0)) {
      toast.error("Precio inválido");
      return;
    }
    setGuardando(true);
    try {
      await ajustarPrecioCredito(creditoId, v, "Admin");
      toast.success("Precio del crédito actualizado");
      setEditando(false);
      await onCambio();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  if (!editando) {
    return (
      <span className="inline-flex items-center justify-end gap-1">
        <span className="tabular-nums">{precio.toFixed(2)}</span>
        <button
          onClick={() => {
            setValor(precio.toFixed(2));
            setEditando(true);
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
          title="Editar precio (descuento para este vale)"
        >
          <Pencil className="size-3" />
        </button>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        inputMode="decimal"
        autoFocus
        className="h-7 w-20 text-right"
        onKeyDown={(e) => {
          if (e.key === "Enter") guardar();
          if (e.key === "Escape") setEditando(false);
        }}
      />
      <button onClick={guardar} disabled={guardando} className="text-emerald-600" title="Guardar">
        <Check className="size-4" />
      </button>
      <button onClick={() => setEditando(false)} className="text-muted-foreground" title="Cancelar">
        <X className="size-4" />
      </button>
    </span>
  );
}

// Barra de configuración del cliente: precio fijo con descuento, grupo (madre) y
// renombrar. Todo cambia la cuenta corriente, no los reportes del grifero.
function ConfigCliente({
  cliente,
  clientes,
  onCambio,
}: {
  cliente: Cliente;
  clientes: Cliente[];
  onCambio: () => Promise<void>;
}) {
  const [editPrecio, setEditPrecio] = useState(false);
  const [precioTxt, setPrecioTxt] = useState(cliente.precioCredito?.toFixed(2) ?? "");
  const [editNombre, setEditNombre] = useState(false);
  const [nombreTxt, setNombreTxt] = useState(cliente.nombre);

  // Posibles madres: clientes activos distintos de este y que no sean sus subs
  // (evita ciclos). Sub-clientes tampoco pueden ser madre.
  const posiblesMadres = clientes.filter(
    (c) =>
      c.id !== cliente.id &&
      c.estado !== "fusionado" &&
      !c.grupoId &&
      c.grupoId !== cliente.id
  );
  const subDeEste = clientes.some((c) => c.grupoId === cliente.id);

  async function guardarPrecio() {
    const txt = precioTxt.trim();
    const v = txt === "" ? null : Number(txt);
    if (v != null && (Number.isNaN(v) || v < 0)) {
      toast.error("Precio inválido");
      return;
    }
    try {
      await setPrecioCreditoCliente(cliente.id, v, "Admin");
      toast.success(v == null ? "Precio especial quitado" : "Precio especial guardado");
      setEditPrecio(false);
      await onCambio();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function guardarNombre() {
    if (!nombreTxt.trim()) return;
    try {
      await renombrarCliente(cliente.id, nombreTxt, "Admin");
      toast.success("Cliente renombrado");
      setEditNombre(false);
      await onCambio();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function cambiarGrupo(valor: string | null) {
    const destino = !valor || valor === "ninguno" ? null : valor;
    try {
      await setGrupoCliente(cliente.id, destino, "Admin");
      toast.success(destino ? "Movido de grupo" : "Quitado del grupo");
      await onCambio();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted/40 p-2.5 text-xs">
      {/* Precio especial (descuento fijo del cliente) */}
      <div className="flex items-center gap-1.5">
        <Tag className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Precio especial:</span>
        {editPrecio ? (
          <>
            <Input
              value={precioTxt}
              onChange={(e) => setPrecioTxt(e.target.value)}
              inputMode="decimal"
              placeholder="normal"
              autoFocus
              className="h-7 w-24 text-right"
              onKeyDown={(e) => {
                if (e.key === "Enter") guardarPrecio();
                if (e.key === "Escape") setEditPrecio(false);
              }}
            />
            <button onClick={guardarPrecio} className="text-emerald-600" title="Guardar">
              <Check className="size-4" />
            </button>
            <button onClick={() => setEditPrecio(false)} className="text-muted-foreground" title="Cancelar">
              <X className="size-4" />
            </button>
          </>
        ) : (
          <>
            <span className="font-semibold tabular-nums">
              {cliente.precioCredito != null ? soles(cliente.precioCredito) : "Normal"}
            </span>
            <button
              onClick={() => {
                setPrecioTxt(cliente.precioCredito?.toFixed(2) ?? "");
                setEditPrecio(true);
              }}
              className="text-muted-foreground hover:text-foreground"
              title="Precio con descuento para todos los créditos de este cliente"
            >
              <Pencil className="size-3" />
            </button>
          </>
        )}
      </div>

      {/* Grupo (cliente madre). No aplica si este cliente ya es una madre. */}
      {!subDeEste && (
        <div className="flex items-center gap-1.5">
          <Folder className="size-3.5 text-muted-foreground" />
          <span className="text-muted-foreground">Grupo:</span>
          <Select value={cliente.grupoId ?? "ninguno"} onValueChange={cambiarGrupo}>
            <SelectTrigger className="h-7 w-44">
              <SelectValue placeholder="Ninguno" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ninguno">Ninguno (independiente)</SelectItem>
              {posiblesMadres.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Renombrar (si el grifero lo escribió mal) */}
      <div className="flex items-center gap-1.5">
        {editNombre ? (
          <>
            <Input
              value={nombreTxt}
              onChange={(e) => setNombreTxt(e.target.value)}
              autoFocus
              className="h-7 w-44"
              onKeyDown={(e) => {
                if (e.key === "Enter") guardarNombre();
                if (e.key === "Escape") setEditNombre(false);
              }}
            />
            <button onClick={guardarNombre} className="text-emerald-600" title="Guardar">
              <Check className="size-4" />
            </button>
            <button onClick={() => setEditNombre(false)} className="text-muted-foreground" title="Cancelar">
              <X className="size-4" />
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              setNombreTxt(cliente.nombre);
              setEditNombre(true);
            }}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            title="Renombrar cliente"
          >
            <Pencil className="size-3" /> Renombrar
          </button>
        )}
      </div>
    </div>
  );
}

// Fila de cliente en la lista (suelto o sub-cliente dentro de una carpeta).
function FilaCliente({
  cliente,
  deuda,
  seleccionado,
  onClick,
  sub,
}: {
  cliente: Cliente;
  deuda: number;
  seleccionado: boolean;
  onClick: () => void;
  sub?: boolean;
}) {
  const est = estadoDeSaldo(deuda);
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-muted/50 ${
        sub ? "pl-9 pr-3" : "px-3"
      } ${seleccionado ? "bg-muted" : ""}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{cliente.nombre}</span>
        {cliente.estado === "pendiente" ? (
          <span className="text-[11px] text-amber-600">pendiente de revisión</span>
        ) : sub ? (
          <span className="text-[11px] text-muted-foreground">crédito del sub-cliente</span>
        ) : null}
      </span>
      <span
        className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
          sub
            ? "text-muted-foreground"
            : est === "con-deuda"
              ? "text-red-600"
              : est === "saldo-favor"
                ? "text-amber-600"
                : "text-emerald-600"
        }`}
      >
        {formatoSaldo(-deuda)}
      </span>
    </button>
  );
}

function Resumen({ label, valor, destacar }: { label: string; valor: string; destacar?: EstadoCliente }) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-bold tabular-nums ${
          destacar === "con-deuda" ? "text-red-600" : destacar === "saldo-favor" ? "text-amber-600" : ""
        }`}
      >
        {valor}
      </div>
    </div>
  );
}
