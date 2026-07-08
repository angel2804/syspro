"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import {
  Pencil,
  Check,
  X,
  CreditCard,
  NotebookPen,
  Gift,
  Tag,
  Banknote,
  HandCoins,
  Send,
  Cylinder,
  type LucideIcon,
} from "lucide-react";
import {
  getIsla,
  PRODUCTOS,
  PRODUCTO_COLOR,
  turnoLabel,
} from "@/lib/config";
import { calcularCuadre, preciosDe, soles } from "@/lib/calc";
import type { Precios, ProductoId, Sesion } from "@/lib/types";
import { cn } from "@/lib/utils";

// Vista de SOLO LECTURA de un turno — refleja lo que ve el trabajador.
// Si se pasa `onGuardarPrecios`, las etiquetas de precio se vuelven editables
// (usado por el admin para corregir el precio de un turno/periodo).
export function SesionVista({
  sesion,
  precios,
  onGuardarPrecios,
}: {
  sesion: Sesion;
  precios: Precios;
  onGuardarPrecios?: (nuevos: Precios) => void | Promise<void>;
}) {
  const isla = getIsla(sesion.islaId);
  // El turno se valoriza con SU precio propio (snapshot al abrirlo), no con el
  // global del momento; el global solo sirve de respaldo si faltara.
  const preciosTurno = preciosDe(sesion, precios);
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  if (!isla) return null;
  const precio = (p: ProductoId) => preciosTurno[p] ?? 0;
  const cuadre = calcularCuadre(sesion, precios);
  const esGlp = isla.tipo === "glp";

  function abrirEdicion() {
    const b: Record<string, string> = {};
    isla!.productos.forEach((p) => (b[p] = String(preciosTurno[p] ?? 0)));
    setBorrador(b);
    setEditando(true);
  }
  async function guardar() {
    if (!onGuardarPrecios) return;
    const nuevos: Precios = { ...preciosTurno };
    isla!.productos.forEach((p) => {
      const v = parseFloat(borrador[p]);
      if (!Number.isNaN(v) && v >= 0) nuevos[p] = v;
    });
    setGuardando(true);
    try {
      await onGuardarPrecios(nuevos);
      setEditando(false);
    } finally {
      setGuardando(false);
    }
  }

  const mini: { icon: LucideIcon; titulo: string; n: number; total: string }[] = [
    {
      icon: CreditCard,
      titulo: "Pagos",
      n: sesion.pagos.length,
      total: soles(cuadre.totalElectronico),
    },
    { icon: NotebookPen, titulo: "Créditos", n: sesion.creditos.length, total: soles(cuadre.totalCreditos) },
    {
      icon: Gift,
      titulo: "Promos",
      n: sesion.promociones.length,
      total: soles(cuadre.totalPromociones),
    },
    {
      icon: Tag,
      titulo: "Descuentos",
      n: sesion.descuentos.length,
      total: soles(cuadre.totalDescuentos),
    },
    { icon: Banknote, titulo: "Gastos", n: sesion.gastos.length, total: soles(cuadre.totalGastos) },
    {
      icon: HandCoins,
      titulo: "Adelantos",
      n: sesion.adelantos.length,
      total: soles(cuadre.totalAdelantos),
    },
    {
      icon: Send,
      titulo: "Entregas",
      n: (sesion.entregas ?? []).length,
      total: soles(cuadre.totalEntregado),
    },
    ...(esGlp
      ? [
          {
            icon: Cylinder,
            titulo: "Balones",
            n: (sesion.balones ?? []).length,
            total: soles(cuadre.totalBalones),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3 text-xs">
      {/* Cabecera del turno */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">{isla.nombre}</span>
        <Badge className="bg-primary text-primary-foreground hover:bg-primary">
          {turnoLabel(sesion.turno)}
        </Badge>
        <Badge variant="secondary">{sesion.trabajador}</Badge>
        {!sesion.cerrada && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            En vivo
          </span>
        )}
        {sesion.cerrada && <Badge variant="outline">Finalizado</Badge>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!editando ? (
            <>
              {isla.productos.map((p) => (
                <span key={p} className="rounded bg-muted px-2 py-0.5">
                  {PRODUCTOS[p]} <b>{soles(precio(p))}</b>
                </span>
              ))}
              {onGuardarPrecios && (
                <button
                  onClick={abrirEdicion}
                  title="Corregir precio"
                  className="flex items-center gap-1 rounded border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" /> Editar precio
                </button>
              )}
            </>
          ) : (
            <>
              {isla.productos.map((p) => (
                <span key={p} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                  {PRODUCTOS[p]}
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={borrador[p] ?? ""}
                    onChange={(e) =>
                      setBorrador((b) => ({ ...b, [p]: e.target.value }))
                    }
                    className="h-6 w-20 px-1.5 text-right text-xs"
                  />
                </span>
              ))}
              <Button
                size="sm"
                onClick={guardar}
                disabled={guardando}
                className="h-6 gap-1 px-2 text-[11px]"
              >
                <Check className="h-3 w-3" /> {guardando ? "Guardando…" : "Guardar"}
              </Button>
              <button
                onClick={() => setEditando(false)}
                disabled={guardando}
                title="Cancelar"
                className="flex h-6 items-center rounded border border-border px-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </span>
      </div>

      {/* Odómetros (solo lectura) */}
      <div className="overflow-hidden rounded-lg border">
        <div className="overflow-x-auto [&_td]:px-2 [&_td]:py-0.5 [&_th]:h-7 [&_th]:px-2">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="font-bold">N-D-ISLA</TableHead>
                <TableHead className="text-right font-bold text-red-500">INICIO</TableHead>
                <TableHead className="text-right font-bold text-red-500">FINAL</TableHead>
                <TableHead className="text-right font-bold">GALONES</TableHead>
                <TableHead className="text-right font-bold">PRECIO</TableHead>
                <TableHead className="text-right font-bold">EN SOLES</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isla.mangueras.map((m) => {
                const o = sesion.odometros[m.id];
                const gl = Math.max(0, (o?.salida ?? 0) - (o?.entrada ?? 0));
                const pr = precio(m.producto);
                return (
                  <TableRow key={m.id}>
                    <TableCell className={cn("font-semibold", PRODUCTO_COLOR[m.producto])}>
                      {m.label}
                    </TableCell>
                    <TableCell className="text-right">{o?.entrada || "—"}</TableCell>
                    <TableCell className="text-right">{o?.salida || "—"}</TableCell>
                    <TableCell className="text-right font-medium">{gl.toFixed(3)}</TableCell>
                    <TableCell className="text-right">{soles(pr)}</TableCell>
                    <TableCell className="text-right font-semibold">{soles(gl * pr)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted font-bold">
                <TableCell colSpan={5} className="text-right">
                  SUMA EN SOLES
                </TableCell>
                <TableCell className="text-right">{soles(cuadre.ventaTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Resumen de registros */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {mini.map((x) => (
          <div key={x.titulo} className="rounded-lg border bg-card p-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-medium">
                <x.icon className="h-3.5 w-3.5 text-primary" />
                {x.titulo}
              </span>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                {x.n}
              </Badge>
            </div>
            <div className="mt-0.5 text-right font-semibold">{x.total}</div>
          </div>
        ))}
      </div>

      {/* Cuadre */}
      <div className="rounded-lg border bg-card p-3">
        <div className="space-y-0.5">
          <Fila label="Venta total" valor={soles(cuadre.ventaTotal)} bold />
          <Fila label="− Créditos" valor={soles(cuadre.totalCreditos)} neg />
          <Fila label="− Promociones" valor={soles(cuadre.totalPromociones)} neg />
          <Fila label="− Descuentos" valor={soles(cuadre.totalDescuentos)} neg />
          <Fila label="− Pagos electrónicos" valor={soles(cuadre.totalElectronico)} neg />
          <Fila label="− Gastos" valor={soles(cuadre.totalGastos)} neg />
          <Fila label="+ Pago adelantado" valor={soles(cuadre.totalAdelantos)} pos />
          {esGlp && (
            <Fila label="+ Balones de gas" valor={soles(cuadre.totalBalones)} pos />
          )}
        </div>
        <div className="my-2 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-1.5">
          <span className="text-sm font-semibold">Efectivo a entregar</span>
          <span className="text-base font-bold text-primary">
            {soles(cuadre.efectivoAEntregar)}
          </span>
        </div>
        <Fila label="Entregado al encargado" valor={soles(cuadre.totalEntregado)} />
        <div className="mt-1 flex items-center justify-between rounded-lg bg-amber-500/15 px-3 py-1.5">
          <span className="text-sm font-semibold">Saldo pendiente</span>
          <span
            className={cn(
              "text-base font-bold",
              cuadre.saldoPendiente > 0.001 ? "text-amber-600" : "text-green-600"
            )}
          >
            {soles(cuadre.saldoPendiente)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Fila({
  label,
  valor,
  neg,
  pos,
  bold,
}: {
  label: string;
  valor: string;
  neg?: boolean;
  pos?: boolean;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>
        {label}
      </span>
      <span className={cn(bold && "font-semibold", neg && "text-red-500", pos && "text-green-600")}>
        {valor}
      </span>
    </div>
  );
}
