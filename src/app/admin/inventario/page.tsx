"use client";

// Inventario de Tanques — SOLO REFERENCIA VISUAL. No modifica ventas, cierres
// ni cálculos financieros: lee los galones vendidos (odómetros ya existentes)
// para restar del último nivel medido por el medidor, y muestra estadísticas
// de consumo. Es un panel de lectura + un formulario de registro semanal que
// escribe únicamente en la tabla aislada `tanque_registros`.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Droplet, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermisoGuard } from "@/lib/use-permiso-guard";
import { PRODUCTOS } from "@/lib/config";
import type { ProductoId, Sesion } from "@/lib/types";
import { fetchSesionesDesde } from "@/lib/db";
import { calcularReporteDia, diaMenos, diaOperativo, diaOperativoActual } from "@/lib/calc";
import { useStore } from "@/lib/store";
import {
  fetchHistorialTanques,
  fetchUltimosRegistrosTanques,
  registrarNivelTanque,
  type TanqueRegistro,
} from "@/lib/data/tanques";

const PRODUCTO_IDS: ProductoId[] = ["bio", "regular", "premium", "glp"];

// Capacidad máxima sugerida por defecto (editable por el medidor la primera
// vez; luego el sistema recuerda la última capacidad registrada).
const CAPACIDAD_DEFAULT: Record<ProductoId, number> = {
  bio: 2000,
  regular: 5000,
  premium: 5000,
  glp: 10000,
};

const COLOR_TANQUE: Record<ProductoId, { barra: string; texto: string }> = {
  bio: { barra: "bg-emerald-500", texto: "text-emerald-600" },
  regular: { barra: "bg-sky-500", texto: "text-sky-600" },
  premium: { barra: "bg-amber-500", texto: "text-amber-600" },
  glp: { barra: "bg-violet-500", texto: "text-violet-600" },
};

const gal = (n: number) => `${n.toLocaleString("es-PE", { maximumFractionDigits: 0 })} gal`;

export default function InventarioTanquesPage() {
  const { listo, permitido } = usePermisoGuard("config");
  const precios = useStore((s) => s.precios);

  const [registros, setRegistros] = useState<TanqueRegistro[]>([]);
  const [historial, setHistorial] = useState<TanqueRegistro[]>([]);
  const [sesiones, setSesiones] = useState<Sesion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const hoy = useMemo(() => diaOperativoActual(), []);

  // Formulario de registro semanal (uno por producto).
  const [form, setForm] = useState<
    Record<ProductoId, { capacidad: string; nivel: string; fecha: string }>
  >(() => {
    const init = {} as Record<ProductoId, { capacidad: string; nivel: string; fecha: string }>;
    for (const p of PRODUCTO_IDS) {
      init[p] = { capacidad: String(CAPACIDAD_DEFAULT[p]), nivel: "", fecha: hoy };
    }
    return init;
  });

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [ultimos, hist, ses] = await Promise.all([
        fetchUltimosRegistrosTanques(),
        fetchHistorialTanques({ limite: 60 }),
        fetchSesionesDesde(diaMenos(diaOperativoActual(), 8)),
      ]);
      setRegistros(ultimos);
      setHistorial(hist);
      setSesiones(ses);
      setForm((prev) => {
        const next = { ...prev };
        for (const r of ultimos) {
          next[r.producto] = {
            capacidad: String(r.capacidadMax),
            nivel: String(r.nivelMedido),
            fecha: r.fechaMedicion,
          };
        }
        return next;
      });
    } catch (e) {
      toast.error("No se pudo cargar el inventario: " + (e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect --
     Carga desde Supabase (sistema externo); el setState ocurre tras el await. */
  useEffect(() => {
    if (listo && permitido) cargar();
  }, [listo, permitido, cargar]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Galones vendidos HOY por producto, según los odómetros ya registrados por
  // los griferos (mismo cálculo que usa el reporte del día). Solo lectura.
  const galonesHoy = useMemo(() => {
    const delDia = sesiones.filter((s) => diaOperativo(s) === hoy);
    const reporte = calcularReporteDia(delDia, hoy, precios);
    const out: Record<ProductoId, number> = { bio: 0, regular: 0, premium: 0, glp: 0 };
    for (const f of reporte.porProducto) out[f.producto] = f.galones;
    return out;
  }, [sesiones, hoy, precios]);

  const totalGalonesHoy = PRODUCTO_IDS.reduce((a, p) => a + galonesHoy[p], 0);

  // Promedio diario de galones vendidos por producto, últimos 7 días
  // operativos completos (sin contar hoy, que sigue en curso).
  const promedio7d = useMemo(() => {
    const dias = Array.from({ length: 7 }, (_, i) => diaMenos(hoy, i + 1));
    const out: Record<ProductoId, number> = { bio: 0, regular: 0, premium: 0, glp: 0 };
    for (const dia of dias) {
      const delDia = sesiones.filter((s) => diaOperativo(s) === dia);
      const reporte = calcularReporteDia(delDia, dia, precios);
      for (const f of reporte.porProducto) out[f.producto] += f.galones;
    }
    for (const p of PRODUCTO_IDS) out[p] = out[p] / dias.length;
    return out;
  }, [sesiones, hoy, precios]);

  // Nivel actual estimado = último nivel medido − lo vendido hoy (referencia).
  const nivelActual = useCallback(
    (p: ProductoId) => {
      const r = registros.find((x) => x.producto === p);
      if (!r) return null;
      const estimado = Math.max(0, r.nivelMedido - galonesHoy[p]);
      return { ...r, estimado };
    },
    [registros, galonesHoy]
  );

  const onChangeForm = (p: ProductoId, campo: "capacidad" | "nivel" | "fecha", v: string) => {
    setForm((prev) => ({ ...prev, [p]: { ...prev[p], [campo]: v } }));
  };

  const guardarTodo = async () => {
    setGuardando(true);
    try {
      for (const p of PRODUCTO_IDS) {
        const f = form[p];
        const capacidad = Number(f.capacidad);
        const nivel = Number(f.nivel);
        if (!f.fecha || !Number.isFinite(capacidad) || capacidad <= 0) continue;
        if (!Number.isFinite(nivel) || nivel < 0) continue;
        await registrarNivelTanque({
          producto: p,
          capacidadMax: capacidad,
          nivelMedido: nivel,
          fechaMedicion: f.fecha,
        });
      }
      toast.success("Registro semanal guardado");
      await cargar();
    } catch (e) {
      toast.error("No se pudo guardar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  if (!listo || !permitido) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
        Verificando acceso…
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <Droplet className="size-5 text-sky-600" />
        <h1 className="text-lg font-semibold">Inventario de Tanques</h1>
        <span className="text-xs text-muted-foreground">
          Solo referencia — no afecta ventas ni reportes
        </span>
      </header>

      {/* Tarjetas de nivel por tanque */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PRODUCTO_IDS.map((p) => {
          const r = nivelActual(p);
          const pct = r ? Math.min(100, Math.round((r.estimado / r.capacidadMax) * 100)) : null;
          const c = COLOR_TANQUE[p];
          return (
            <div key={p} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${c.texto}`}>{PRODUCTOS[p]}</span>
                {r && <span className="text-xs text-muted-foreground">máx {gal(r.capacidadMax)}</span>}
              </div>
              {r ? (
                <>
                  <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${c.barra} transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-xl font-extrabold tabular-nums">{gal(r.estimado)}</span>
                    <span className="text-xs text-muted-foreground">({pct}%)</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Medido {gal(r.nivelMedido)} el {r.fechaMedicion} · −{gal(galonesHoy[p])} vendido hoy
                  </div>
                </>
              ) : (
                <div className="mt-3 text-xs text-muted-foreground">
                  Sin medición registrada aún
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* Registro semanal / historial */}
        <div className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Inventario de Tanques (Registro Semanal)</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Actualiza el nivel real medido de cada tanque. Es solo una guía; no cambia nada del
            sistema de ventas.
          </p>

          <Tabs defaultValue="registro">
            <TabsList>
              <TabsTrigger value="registro">Registro Semanal</TabsTrigger>
              <TabsTrigger value="historial">Historial de Registros</TabsTrigger>
            </TabsList>

            <TabsContent value="registro">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead>Capacidad Máxima</TableHead>
                      <TableHead>Nivel Actual Medido (gal)</TableHead>
                      <TableHead>Fecha de Medición</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PRODUCTO_IDS.map((p) => (
                      <TableRow key={p}>
                        <TableCell className={`font-medium ${COLOR_TANQUE[p].texto}`}>
                          {PRODUCTOS[p]}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            className="w-28"
                            value={form[p].capacidad}
                            onChange={(e) => onChangeForm(p, "capacidad", e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={0}
                            className="w-28"
                            value={form[p].nivel}
                            onChange={(e) => onChangeForm(p, "nivel", e.target.value)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="date"
                            className="w-40"
                            value={form[p].fecha}
                            onChange={(e) => onChangeForm(p, "fecha", e.target.value)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Button className="mt-3 w-full" onClick={guardarTodo} disabled={guardando}>
                <Save className="mr-1.5 h-4 w-4" />
                {guardando ? "Guardando…" : "Guardar Registro Semanal"}
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                Este registro se realiza semanalmente. El sistema descuenta lo vendido hoy
                (según odómetros) solo para mostrar un estimado; no altera ningún dato real.
              </p>
            </TabsContent>

            <TabsContent value="historial">
              <div className="max-h-96 overflow-x-auto overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Producto</TableHead>
                      <TableHead>Nivel medido</TableHead>
                      <TableHead>Capacidad</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cargando ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          Cargando…
                        </TableCell>
                      </TableRow>
                    ) : historial.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          Sin registros.
                        </TableCell>
                      </TableRow>
                    ) : (
                      historial.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="whitespace-nowrap text-xs">{r.fechaMedicion}</TableCell>
                          <TableCell className={COLOR_TANQUE[r.producto].texto}>
                            {PRODUCTOS[r.producto]}
                          </TableCell>
                          <TableCell>{gal(r.nivelMedido)}</TableCell>
                          <TableCell>{gal(r.capacidadMax)}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </div>

        {/* Resumen de ventas del día (SOLO galones, sin soles) + promedio 7d */}
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Resumen de Ventas del Día</h2>
            <p className="mb-3 text-xs text-muted-foreground">{hoy} · en galones</p>
            <div className="space-y-2">
              {PRODUCTO_IDS.map((p) => (
                <div key={p} className="flex items-center justify-between text-sm">
                  <span className={`font-medium ${COLOR_TANQUE[p].texto}`}>{PRODUCTOS[p]}</span>
                  <span className="tabular-nums">{gal(galonesHoy[p])}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-2 text-sm font-bold">
              <span>Total del día</span>
              <span className="tabular-nums text-emerald-600">{gal(totalGalonesHoy)}</span>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Promedio diario (7 días)</h2>
            <p className="mb-3 text-xs text-muted-foreground">Galones/día vendidos por producto</p>
            <div className="space-y-2">
              {PRODUCTO_IDS.map((p) => (
                <div key={p} className="flex items-center justify-between text-sm">
                  <span className={`font-medium ${COLOR_TANQUE[p].texto}`}>{PRODUCTOS[p]}</span>
                  <span className="tabular-nums">{gal(promedio7d[p])}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
