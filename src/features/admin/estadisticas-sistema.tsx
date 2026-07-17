"use client";

// Portada de estadísticas del panel admin (vista "Estadisticas"): KPIs del día
// comparados con el día operativo anterior, venta por combustible y resumen de
// tanques. Extraído de admin/page.tsx sin cambios de comportamiento.
import { useMemo } from "react";
import Link from "next/link";
import {
  Activity,
  Banknote,
  NotebookPen,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  calcularReporteDia,
  diaMenos,
  diaOperativo,
  diaOperativoActual,
  soles,
} from "@/lib/calc";
import { PRODUCTOS } from "@/lib/config";
import type { Precios, ProductoId, Sesion } from "@/lib/types";
import type { TanqueRegistro } from "@/lib/data/tanques";

const PRODUCTOS_IDS_RESUMEN: ProductoId[] = ["bio", "regular", "premium", "glp"];

const PRODUCTO_RESUMEN_COLOR: Record<ProductoId, { text: string; bar: string }> = {
  bio: { text: "text-zinc-600 dark:text-zinc-300", bar: "bg-zinc-500" },
  regular: { text: "text-green-600 dark:text-green-300", bar: "bg-green-500" },
  premium: { text: "text-sky-600 dark:text-sky-300", bar: "bg-sky-500" },
  glp: { text: "text-orange-600 dark:text-orange-300", bar: "bg-orange-500" },
};

export function EstadisticasSistema({
  remote,
  precios,
  activos,
  tanques,
}: {
  remote: Sesion[];
  precios: Precios;
  activos: number;
  tanques: TanqueRegistro[];
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
      hoyOp,
    };
  }, [remote, precios]);

  // Variación % de la venta vs. el día anterior (null si ayer no tuvo venta).
  const delta =
    kpi.ayer.ventaTotal > 0.01
      ? ((kpi.hoy.ventaTotal - kpi.ayer.ventaTotal) / kpi.ayer.ventaTotal) * 100
      : null;
  const galonesHoy = PRODUCTOS_IDS_RESUMEN.map((producto) => ({
    producto,
    galones: kpi.hoy.porProducto.find((f) => f.producto === producto)?.galones ?? 0,
  }));
  const totalGalones = galonesHoy.reduce((a, p) => a + p.galones, 0);

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Estadisticas del sistema</h2>
            <p className="text-xs text-muted-foreground">
              Resumen operativo del dia {kpi.hoyOp}
            </p>
          </div>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            Vista general
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Venta por combustible</h3>
            <span className="text-xs text-muted-foreground">
              {totalGalones.toLocaleString("es-PE", { maximumFractionDigits: 1 })} gal
            </span>
          </div>
          <div className="space-y-3">
            {galonesHoy.map(({ producto, galones }) => {
              const pct = totalGalones > 0 ? Math.round((galones / totalGalones) * 100) : 0;
              return (
                <div key={producto}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className={`font-medium ${PRODUCTO_RESUMEN_COLOR[producto].text}`}>
                      {PRODUCTOS[producto]}
                    </span>
                    <span className="tabular-nums">
                      {galones.toLocaleString("es-PE", { maximumFractionDigits: 1 })} gal
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${PRODUCTO_RESUMEN_COLOR[producto].bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Resumen de tanques</h3>
            <Link
              href="/admin/inventario"
              className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
            >
              Ver inventario
            </Link>
          </div>
          {tanques.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
              Todavia no hay mediciones registradas.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {PRODUCTOS_IDS_RESUMEN.map((producto) => {
                const registro = tanques.find((t) => t.producto === producto);
                if (!registro) return null;
                const vendidos = galonesHoy.find((g) => g.producto === producto)?.galones ?? 0;
                const actual = Math.max(0, registro.nivelMedido - vendidos);
                const capacidad = Math.max(1, registro.capacidadMax);
                const pct = Math.min(100, Math.round((actual / capacidad) * 100));
                const estado =
                  pct <= 20 ? "Bajo" : pct <= 45 ? "Revisar" : pct >= 85 ? "Alto" : "Normal";
                return (
                  <div key={producto} className="rounded-xl border border-border/70 bg-muted/20 p-3.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className={`text-sm font-bold ${PRODUCTO_RESUMEN_COLOR[producto].text}`}>
                        {PRODUCTOS[producto]}
                      </span>
                      <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums">
                        {pct}%
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-background">
                      <div
                        className={`h-full rounded-full ${PRODUCTO_RESUMEN_COLOR[producto].bar}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <div>
                        <div className="text-lg font-extrabold tabular-nums">
                          {actual.toLocaleString("es-PE", { maximumFractionDigits: 0 })} gal
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          max {capacidad.toLocaleString("es-PE")} gal
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {estado}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
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
    <div className="rounded-2xl border border-border/60 bg-muted/15 p-4 shadow-sm">
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
