"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getIsla,
  ISLAS,
  PRODUCTOS,
  PRODUCTO_COLOR,
  TURNOS,
} from "@/lib/config";
import { calcularReporteDia, preciosDe, soles } from "@/lib/calc";
import { clientesOrdenados } from "@/lib/clientes";
import { useStore } from "@/lib/store";
import type { PagoElectronico, Precios, ProductoId, Sesion, TurnoId } from "@/lib/types";
import type { Col } from "./registro-fields";
import { ReporteRegistroModal, type Grupo } from "./reporte-registro-modal";
import { cn } from "@/lib/utils";
import {
  colsAdelanto,
  colsBalon,
  colsConteo,
  colsCredito,
  colsDescuento,
  colsEntrega,
  colsGasto,
  colsPago,
  colsPromo,
  nuevoAdelanto,
  nuevoBalon,
  nuevoConteo,
  nuevoCredito,
  nuevoDescuento,
  nuevoEntrega,
  nuevoGasto,
  nuevoPago,
  nuevoPromo,
  resumenPagos,
  resumenPorProducto,
  validarAdelanto,
  validarBalon,
  validarConteo,
  validarCredito,
  validarDescuento,
  validarEntrega,
  validarGasto,
  validarPago,
  validarPromo,
} from "@/lib/registro-columns";

type Tipo =
  | "pagos"
  | "creditos"
  | "promociones"
  | "descuentos"
  | "gastos"
  | "adelantos"
  | "entregas"
  | "conteos"
  | "balones";

interface Props {
  delDia: Sesion[];
  dia: string;
  precios: Precios;
  onUpdateRegistro: (
    sesionId: string,
    tipo: Tipo,
    rowId: string,
    patch: Record<string, unknown>
  ) => void;
  onRemoveRegistro: (sesionId: string, tipo: Tipo, rowId: string) => void;
  onAddRegistro: (
    sesionId: string,
    tipo: Tipo,
    row: Record<string, unknown>
  ) => void;
  onUpdateOdometro: (
    sesionId: string,
    mangueraId: string,
    patch: { entrada?: number; salida?: number }
  ) => void;
  // El admin corrige el precio de un turno (p. ej. cambio de las 2pm o un
  // tipeo). Reemplaza el snapshot de precios de esa sesión.
  onSetPreciosSesion: (sesionId: string, precios: Precios) => void;
  // Muestra la tabla "Venta a precio normal". Se oculta para admins sin ese
  // permiso. Por defecto visible.
  mostrarVentaNormal?: boolean;
}

function productoOpts(s: Sesion) {
  return (getIsla(s.islaId)?.productos ?? []).map((p) => ({
    value: p,
    label: PRODUCTOS[p],
  }));
}

export function ReporteDiaVista({
  delDia,
  dia,
  precios,
  onUpdateRegistro,
  onRemoveRegistro,
  onAddRegistro,
  onUpdateOdometro,
  onSetPreciosSesion,
  mostrarVentaNormal = true,
}: Props) {
  // Turno específico (mañana/tarde/noche) o "general" (todo el día). Isla opcional.
  const [filtroTurno, setFiltroTurno] = useState<string>("manana");
  const [filtroIsla, setFiltroIsla] = useState<string>("todas");
  const esGeneral = filtroTurno === "general";

  const precio = (p: ProductoId) => precios[p] ?? 0;
  // Precio EFECTIVO de un turno (snapshot de la sesión con fallback al global).
  const preciosSes = (s: Sesion) => preciosDe(s, precios);
  const precioSesFn = (s: Sesion) => (p: ProductoId) => preciosSes(s)[p] ?? 0;
  const sugClientes = clientesOrdenados(useStore((s) => s.clientes));

  // Sesiones del turno (o de todos los turnos si general), filtradas por isla
  const filtradas = delDia.filter(
    (s) =>
      (esGeneral || s.turno === filtroTurno) &&
      (filtroIsla === "todas" || s.islaId === filtroIsla)
  );

  const rep = calcularReporteDia(filtradas, dia, precios);

  const islasMostrar =
    filtroIsla === "todas" ? ISLAS : ISLAS.filter((i) => i.id === filtroIsla);
  const sesionDeIsla = (id: string) => filtradas.find((s) => s.islaId === id);
  const sesionDe = (islaId: string, turno: TurnoId) =>
    delDia.find((s) => s.islaId === islaId && s.turno === turno);

  // Odómetros:
  //  - general: INICIO = entrada del turno mañana, FINAL = salida del turno
  //    noche. Editable: cada campo apunta a su propia sesión (mañana/noche).
  //  - por turno: inicio/salida de ese turno, editables ("FALTA" si no existe)
  const odoFilas = esGeneral
    ? islasMostrar.flatMap((isla) =>
        isla.mangueras.map((m) => {
          const sMañana = sesionDe(isla.id, "manana");
          const sNoche = sesionDe(isla.id, "noche");
          const inicio = sMañana?.odometros[m.id]?.entrada ?? 0;
          const final = sNoche?.odometros[m.id]?.salida ?? 0;
          const galones = Math.max(0, final - inicio);
          // Precio representativo del día (turno más reciente); la SUMA usa el
          // total por tramos (rep.ventaTotal), exacto aunque cambie a las 2pm.
          const ref = sNoche ?? sMañana;
          const pr = ref ? preciosSes(ref)[m.producto] ?? 0 : precio(m.producto);
          return {
            m,
            sesionInicio: sMañana,
            sesionFinal: sNoche,
            inicio,
            final,
            galones,
            precio: pr,
            soles: galones * pr,
          };
        })
      )
    : islasMostrar.flatMap((isla) =>
        isla.mangueras.map((m) => {
          const s = sesionDeIsla(isla.id);
          const o = s?.odometros[m.id];
          const inicio = o?.entrada ?? 0;
          const final = o?.salida ?? 0;
          const galones = Math.max(0, final - inicio);
          const pr = s ? preciosSes(s)[m.producto] ?? 0 : precio(m.producto);
          return {
            m,
            sesionInicio: s,
            sesionFinal: s,
            inicio,
            final,
            galones,
            precio: pr,
            soles: galones * pr,
          };
        })
      );

  const encargados = islasMostrar.map((isla) => ({
    isla,
    sesion: sesionDeIsla(isla.id),
  }));

  const hayGlp = islasMostrar.some((i) => i.tipo === "glp");

  // Precio editable por turno: todas las sesiones de ESTE turno (las 3 islas)
  // comparten el precio; al editarlo se reemplaza el snapshot de cada una. Así
  // el admin fija el precio nuevo de las 2pm en la tarde, o corrige un tipeo.
  const sesionesTurno = esGeneral
    ? []
    : delDia.filter((s) => s.turno === filtroTurno);
  const productosTurno = Array.from(
    new Set(islasMostrar.flatMap((i) => i.productos))
  );
  const precioTurno = (p: ProductoId) =>
    sesionesTurno[0] ? preciosSes(sesionesTurno[0])[p] ?? 0 : precio(p);
  const setPrecioTurno = (p: ProductoId, v: number) => {
    sesionesTurno.forEach((s) =>
      onSetPreciosSesion(s.id, { ...preciosSes(s), [p]: v })
    );
  };

  // Columnas por tipo (precio global), delegadas al módulo compartido con
  // dashboard/page.tsx (src/lib/registro-columns.ts).
  type RowAny = { id: string };
  function grupos(tipo: Tipo, cols: (s: Sesion) => Col<RowAny>[]): Grupo<RowAny>[] {
    return filtradas.map((s) => ({
      sesion: s,
      rows: ((s as unknown as Record<string, RowAny[]>)[tipo] ?? []),
      columns: cols(s),
    }));
  }

  const nuevoRowAny =
    <A,>(fn: (s: Sesion) => Omit<A, "id">) =>
    (s: Sesion) =>
      fn(s) as unknown as Omit<RowAny, "id">;
  const validarRowAny =
    <A,>(fn: (r: Omit<A, "id">) => string | null) =>
    (r: Omit<RowAny, "id">) =>
      fn(r as unknown as Omit<A, "id">);

  // Galones por producto desglosados: créditos, descuentos y promociones
  const creditosGal = new Map<string, number>();
  const descuentosGal = new Map<string, number>();
  const promoGal = new Map<string, number>();
  filtradas.forEach((s) => {
    s.creditos.forEach((c) => creditosGal.set(c.producto, (creditosGal.get(c.producto) ?? 0) + c.galones));
    s.descuentos.forEach((d) => descuentosGal.set(d.producto, (descuentosGal.get(d.producto) ?? 0) + d.galones));
    s.promociones.forEach((p) => promoGal.set(p.producto, (promoGal.get(p.producto) ?? 0) + p.galones));
  });

  // Total contado en físico por el admin (conteos de todas las sesiones).
  const totalContado = filtradas.reduce(
    (a, s) => a + (s.conteos ?? []).reduce((x, c) => x + c.monto, 0),
    0
  );
  // Dos cuadres contra el efectivo que el sistema dice que debe haber en caja:
  //  - según los trabajadores: lo que ellos declararon entregar.
  //  - según el admin: lo que el admin contó físicamente.
  // Positivo = falta efectivo; negativo = sobra.
  const cuadreTrabajadores = rep.efectivoAEntregar - rep.totalEntregado;
  const cuadreAdmin = rep.efectivoAEntregar - totalContado;

  const cards = [
    {
      tipo: "pagos" as Tipo,
      icon: "💳",
      titulo: "Pagos",
      n: filtradas.reduce((a, s) => a + s.pagos.length, 0),
      total: rep.totalElectronico,
      grupos: grupos("pagos", () => colsPago() as unknown as Col<RowAny>[]),
      nuevo: nuevoRowAny(() => nuevoPago()),
      validar: validarRowAny(validarPago),
      resumen: (rows: RowAny[]) =>
        resumenPagos(rows as unknown as PagoElectronico[]),
    },
    {
      tipo: "creditos" as Tipo,
      icon: "📒",
      titulo: "Créditos",
      n: filtradas.reduce((a, s) => a + s.creditos.length, 0),
      total: rep.totalCreditos,
      grupos: grupos(
        "creditos",
        (s) => colsCredito(productoOpts(s), precioSesFn(s), sugClientes) as unknown as Col<RowAny>[]
      ),
      nuevo: nuevoRowAny((s) => nuevoCredito(productoOpts(s)[0]?.value ?? "bio")),
      validar: validarRowAny(validarCredito),
      resumen: () =>
        resumenPorProducto(
          filtradas.flatMap((s) =>
            s.creditos.map((c) => ({
              producto: c.producto,
              galones: c.galones,
              precio: preciosSes(s)[c.producto] ?? 0,
            }))
          )
        ),
    },
    {
      tipo: "promociones" as Tipo,
      icon: "🎁",
      titulo: "Promos",
      n: filtradas.reduce((a, s) => a + s.promociones.length, 0),
      total: rep.totalPromociones,
      grupos: grupos(
        "promociones",
        (s) => colsPromo(productoOpts(s), precioSesFn(s)) as unknown as Col<RowAny>[]
      ),
      nuevo: nuevoRowAny((s) => nuevoPromo(productoOpts(s)[0]?.value ?? "bio")),
      validar: validarRowAny(validarPromo),
      resumen: () =>
        resumenPorProducto(
          filtradas.flatMap((s) =>
            s.promociones.map((p) => ({
              producto: p.producto,
              galones: p.galones,
              precio: preciosSes(s)[p.producto] ?? 0,
            }))
          )
        ),
    },
    {
      tipo: "descuentos" as Tipo,
      icon: "🏷️",
      titulo: "Descuentos",
      n: filtradas.reduce((a, s) => a + s.descuentos.length, 0),
      total: rep.totalDescuentos,
      grupos: grupos(
        "descuentos",
        (s) => colsDescuento(productoOpts(s), precioSesFn(s), sugClientes) as unknown as Col<RowAny>[]
      ),
      nuevo: nuevoRowAny((s) => nuevoDescuento(productoOpts(s)[0]?.value ?? "bio")),
      validar: validarRowAny(validarDescuento),
    },
    {
      tipo: "gastos" as Tipo,
      icon: "💸",
      titulo: "Gastos",
      n: filtradas.reduce((a, s) => a + s.gastos.length, 0),
      total: rep.totalGastos,
      grupos: grupos("gastos", () => colsGasto() as unknown as Col<RowAny>[]),
      nuevo: nuevoRowAny(() => nuevoGasto()),
      validar: validarRowAny(validarGasto),
    },
    {
      tipo: "adelantos" as Tipo,
      icon: "💰",
      titulo: "Adelantos",
      n: filtradas.reduce((a, s) => a + s.adelantos.length, 0),
      total: rep.totalAdelantos,
      grupos: grupos("adelantos", () => colsAdelanto() as unknown as Col<RowAny>[]),
      nuevo: nuevoRowAny(() => nuevoAdelanto()),
      validar: validarRowAny(validarAdelanto),
    },
    {
      tipo: "entregas" as Tipo,
      icon: "📤",
      titulo: "Entregas",
      n: filtradas.reduce((a, s) => a + (s.entregas?.length ?? 0), 0),
      total: rep.totalEntregado,
      grupos: grupos("entregas", () => colsEntrega() as unknown as Col<RowAny>[]),
      nuevo: nuevoRowAny(() => nuevoEntrega()),
      validar: validarRowAny(validarEntrega),
    },
    {
      tipo: "conteos" as Tipo,
      icon: "🧮",
      titulo: "Efectivo contado",
      n: filtradas.reduce((a, s) => a + (s.conteos?.length ?? 0), 0),
      total: totalContado,
      grupos: grupos("conteos", () => colsConteo() as unknown as Col<RowAny>[]),
      nuevo: nuevoRowAny(() => nuevoConteo()),
      validar: validarRowAny(validarConteo),
    },
    ...(hayGlp
      ? [
          {
            tipo: "balones" as Tipo,
            icon: "🛢️",
            titulo: "Balones",
            n: filtradas.reduce((a, s) => a + (s.balones?.length ?? 0), 0),
            total: rep.totalBalones,
            grupos: grupos("balones", (s) => colsBalon(preciosSes(s)) as unknown as Col<RowAny>[]),
            nuevo: nuevoRowAny(() => nuevoBalon()),
            validar: validarRowAny(validarBalon),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3 text-xs">
      {/* Filtros: turno (siempre) + isla (opcional para reporte individual) */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-sm">
        <span className="text-[11px] font-bold text-muted-foreground">TURNO:</span>
        <Select
          value={filtroTurno}
          onValueChange={(v) => setFiltroTurno(v ?? "manana")}
        >
          <SelectTrigger className="h-8 w-48 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="general">Reporte general (todo el día)</SelectItem>
            {TURNOS.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[11px] font-bold text-muted-foreground">ISLA:</span>
        <Select value={filtroIsla} onValueChange={(v) => setFiltroIsla(v ?? "todas")}>
          <SelectTrigger className="h-8 w-44 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas (reporte por turno)</SelectItem>
            {ISLAS.map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.nombre} (individual)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-[11px] text-muted-foreground">{dia}</span>
      </div>

      {/* Encargados del turno (y faltas) */}
      {!esGeneral && (
      <div className="flex flex-wrap gap-2">
        {encargados.map(({ isla, sesion }) => (
          <span
            key={isla.id}
            className={cn(
              "rounded-md border px-2 py-1 text-[11px]",
              sesion
                ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30"
                : "border-red-300 bg-red-50 text-red-600 dark:bg-red-950/30"
            )}
          >
            {isla.nombre}:{" "}
            <b>{sesion ? sesion.trabajador : "FALTA este turno"}</b>
          </span>
        ))}
      </div>
      )}

      {/* Precio por turno (editable): por defecto hereda el global; el admin lo
          ajusta para el cambio de las 2pm o para corregir un tipeo. */}
      {!esGeneral && sesionesTurno.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-2 shadow-sm">
          <span className="text-[11px] font-bold text-muted-foreground">
            PRECIO DE ESTE TURNO:
          </span>
          {productosTurno.map((p) => (
            <label key={p} className="flex items-center gap-1.5 text-[11px]">
              <span className="font-semibold">{PRODUCTOS[p]}</span>
              <Input
                className="h-7 w-20 text-right text-sm tabular-nums"
                type="number"
                step="0.01"
                value={precioTurno(p) || ""}
                onWheel={(e) => e.currentTarget.blur()}
                onChange={(e) => setPrecioTurno(p, Number(e.target.value))}
              />
            </label>
          ))}
        </div>
      )}

      {/* Odómetros */}
      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
        <div className="border-b bg-muted/60 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {esGeneral
            ? "ODÓMETROS DEL DÍA · inicio (mañana) → final (noche)"
            : `ODÓMETROS · ${TURNOS.find((t) => t.id === filtroTurno)?.label} (editable)`}
        </div>
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
              {odoFilas.map((f) => {
                const oInicio = f.sesionInicio?.odometros[f.m.id];
                const oFinal = f.sesionFinal?.odometros[f.m.id];
                return (
                  <TableRow key={f.m.id}>
                    <TableCell className={cn("font-semibold", PRODUCTO_COLOR[f.m.producto])}>
                      {f.m.label}
                    </TableCell>
                    {/* INICIO */}
                    {f.sesionInicio ? (
                      <TableCell className="text-right">
                        <Input
                          className="h-7 w-40 text-right text-sm font-semibold tabular-nums"
                          type="number"
                          value={oInicio?.entrada || ""}
                          onWheel={(e) => e.currentTarget.blur()}
                          onChange={(e) =>
                            onUpdateOdometro(f.sesionInicio!.id, f.m.id, {
                              entrada: Number(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                    ) : (
                      <TableCell className="text-center text-red-500">—</TableCell>
                    )}
                    {/* FINAL */}
                    {f.sesionFinal ? (
                      <TableCell className="text-right">  
                        <Input
                          className="h-7 w-40 text-right text-sm font-semibold tabular-nums"
                          type="number"
                          value={oFinal?.salida || ""}
                          onWheel={(e) => e.currentTarget.blur()}
                          onChange={(e) =>
                            onUpdateOdometro(f.sesionFinal!.id, f.m.id, {
                              salida: Number(e.target.value),
                            })
                          }
                        />
                      </TableCell>
                    ) : (
                      <TableCell className="text-center text-red-500">—</TableCell>
                    )}
                    <TableCell className="text-right font-medium">
                      {f.galones.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right">{soles(f.precio)}</TableCell>
                    <TableCell className="text-right font-semibold">{soles(f.soles)}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted font-bold">
                <TableCell colSpan={5} className="text-right">
                  SUMA EN SOLES
                </TableCell>
                <TableCell className="text-right text-sm">{soles(rep.ventaTotal)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Galones vendidos por producto (bio, regular, premium, glp) */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-2 shadow-sm">
        <span className="text-[11px] font-bold text-muted-foreground">
          GALONES VENDIDOS:
        </span>
        {rep.porProducto.map((f) => (
          <span key={f.producto} className="flex items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 font-semibold",
                PRODUCTO_COLOR[f.producto]
              )}
            >
              {PRODUCTOS[f.producto]}
            </span>
            <b className="tabular-nums">{f.galones.toFixed(3)}</b>
          </span>
        ))}
      </div>

      {/* Tarjetas */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cards.map((c) => (
          <ReporteRegistroModal
            key={c.tipo}
            titulo={c.titulo}
            grupos={c.grupos}
            onUpdate={(sid, rid, patch) =>
              onUpdateRegistro(sid, c.tipo, rid, patch as Record<string, unknown>)
            }
            onRemove={(sid, rid) => onRemoveRegistro(sid, c.tipo, rid)}
            nuevo={c.nuevo}
            validar={c.validar}
            resumen={(c as { resumen?: (r: RowAny[]) => string }).resumen}
            onAdd={(sid, row) => onAddRegistro(sid, c.tipo, row as Record<string, unknown>)}
            trigger={
              <button className="rounded-lg border bg-card p-3 text-left transition-colors hover:bg-accent">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {c.icon} {c.titulo}
                  </span>
                  <span className="text-muted-foreground">{c.n}</span>
                </div>
                <div className="mt-1 text-right font-semibold">{soles(c.total)}</div>
              </button>
            }
          />
        ))}
      </div>

      {/* Cuadre en dos mitades: ambas parten del mismo "Efectivo a entregar"
          (lo que el sistema dice que debe haber en caja). La izquierda lo
          verifica contra lo que declararon los TRABAJADORES; la derecha contra
          lo que el ADMIN contó físicamente. */}
      <div className="grid gap-2 md:grid-cols-2">
        {/* Mitad izquierda: venta, deducciones y cuadre según trabajadores */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Venta y deducciones
          </div>
          <div className="space-y-0.5">
            <Fila label="Venta total" valor={soles(rep.ventaTotal)} bold />
            <Fila label="− Créditos" valor={soles(rep.totalCreditos)} neg />
            <Fila label="− Promociones" valor={soles(rep.totalPromociones)} neg />
            <Fila label="− Descuentos" valor={soles(rep.totalDescuentos)} neg />
            <Fila label="− Pagos electrónicos" valor={soles(rep.totalElectronico)} neg />
            <Fila label="− Gastos" valor={soles(rep.totalGastos)} neg />
            <Fila label="+ Pago adelantado" valor={soles(rep.totalAdelantos)} pos />
            {hayGlp && (
              <Fila label="+ Balones de gas" valor={soles(rep.totalBalones)} pos />
            )}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2">
            <span className="text-sm font-semibold">Efectivo a entregar</span>
            <span className="text-lg font-bold text-primary">
              {soles(rep.efectivoAEntregar)}
            </span>
          </div>
          <div className="mt-1">
            <Fila
              label="− Entregado por trabajadores"
              valor={soles(rep.totalEntregado)}
              neg
            />
          </div>
          <CuadreBloque diferencia={cuadreTrabajadores} />
        </div>

        {/* Mitad derecha: cuadre según el conteo físico del admin */}
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Efectivo contado por el admin
          </div>
          <div className="flex items-center justify-between rounded-lg bg-primary/10 px-3 py-2">
            <span className="text-sm font-semibold">Efectivo a entregar</span>
            <span className="text-lg font-bold text-primary">
              {soles(rep.efectivoAEntregar)}
            </span>
          </div>
          <div className="mt-1">
            <Fila
              label="− Contado por el admin"
              valor={soles(totalContado)}
              neg
            />
          </div>
          <CuadreBloque diferencia={cuadreAdmin} />
        </div>
      </div>

      {/* Venta a precio normal por producto */}
      {mostrarVentaNormal && rep.porProducto.length > 0 && (
        <div className="rounded-xl border bg-card p-4 shadow-sm">
          <div className="mb-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Venta a precio normal
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-[10px] text-muted-foreground">
                  <th className="pb-1 text-left font-semibold">Producto</th>
                  <th className="pb-1 text-right font-semibold">Total gal.</th>
                  <th className="pb-1 text-right font-semibold text-red-400">− Créditos</th>
                  <th className="pb-1 text-right font-semibold text-red-400">− Descuentos</th>
                  <th className="pb-1 text-right font-semibold text-red-400">− Promos</th>
                  <th className="pb-1 text-right font-semibold text-sky-400">= Precio normal</th>
                </tr>
              </thead>
              <tbody>
                {rep.porProducto
                  .filter((f) => f.producto !== "glp")
                  .map((f) => {
                    const cred = creditosGal.get(f.producto) ?? 0;
                    const desc = descuentosGal.get(f.producto) ?? 0;
                    const promo = promoGal.get(f.producto) ?? 0;
                    const normal = Math.max(0, f.galones - cred - desc - promo);
                    return (
                      <tr key={f.producto} className="border-b last:border-0">
                        <td className="py-1">
                          <span className={cn("rounded px-1.5 py-0.5 font-semibold", PRODUCTO_COLOR[f.producto])}>
                            {PRODUCTOS[f.producto]}
                          </span>
                        </td>
                        <td className="py-1 text-right tabular-nums">{f.galones.toFixed(3)}</td>
                        <td className="py-1 text-right tabular-nums text-red-400">
                          {cred > 0 ? `−${cred.toFixed(3)}` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums text-red-400">
                          {desc > 0 ? `−${desc.toFixed(3)}` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums text-red-400">
                          {promo > 0 ? `−${promo.toFixed(3)}` : "—"}
                        </td>
                        <td className="py-1 text-right tabular-nums font-bold text-sky-400">
                          {normal.toFixed(3)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// Bloque de veredicto del cuadre: Falta (naranja) si la diferencia > 0,
// Sobra (celeste) si < 0, Cuadra (verde) si es ~0.
function CuadreBloque({ diferencia }: { diferencia: number }) {
  const cuadra = Math.abs(diferencia) < 0.005;
  const falta = diferencia > 0.005;
  return (
    <div
      className={cn(
        "mt-1 flex items-center justify-between rounded-lg px-3 py-2",
        falta ? "bg-amber-500/15" : "bg-green-500/15"
      )}
    >
      <span className="text-sm font-semibold">
        {cuadra ? "Cuadra ✓" : falta ? "Falta" : "Sobra"}
      </span>
      <span
        className={cn(
          "text-lg font-bold",
          falta ? "text-amber-600" : "text-sky-600"
        )}
      >
        {soles(Math.abs(diferencia))}
      </span>
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
