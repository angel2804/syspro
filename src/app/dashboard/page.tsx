"use client";

import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BALONES,
  getIsla,
  PRODUCTOS,
  PRODUCTO_COLOR,
  turnoLabel,
} from "@/lib/config";
import { toast } from "sonner";
import { backupSiTurnoCompleto, upsertSesion } from "@/lib/db";
import { sincronizarCreditosSesion } from "@/lib/data/creditos";
import { subscribeNuevosPrecios } from "@/lib/data/precios";
import { useStore } from "@/lib/store";
import { useHydrated } from "@/lib/use-hydrated";
import { logoutSupabase } from "@/lib/data/auth";
import { guardarSesionPendiente, limpiarSesionPendiente } from "@/lib/offline-sesion";
import { calcularCuadre, preciosDe, soles } from "@/lib/calc";
import { contarPorSeveridad, puedeCerrar, validarCierre } from "@/lib/domain/cierre";
import { clientesOrdenados } from "@/lib/clientes-autocompletado";
import type {
  Adelanto,
  Balon,
  Credito,
  Descuento,
  Entrega,
  Gasto,
  PagoElectronico,
  Promocion,
  ProductoId,
} from "@/lib/types";
import { SyncBadge } from "@/components/sync-badge";
import { RegistroModal } from "@/components/grifo/registro-modal";
import { RegistroAddForm } from "@/components/grifo/registro-fields";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabaseHabilitado } from "@/lib/supabase";
import {
  LogOut,
  Fuel,
  CreditCard,
  NotebookPen,
  Gift,
  Tag,
  Banknote,
  HandCoins,
  Send,
  Cylinder,
  Calculator,
  CheckCircle2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  colsAdelanto,
  colsBalon,
  colsCredito,
  colsDescuento,
  colsEntrega,
  colsGasto,
  colsPago,
  resumenPagos,
  resumenPorProducto,
  colsPromo,
  nuevoAdelanto,
  nuevoBalon,
  nuevoCredito,
  nuevoDescuento,
  nuevoEntrega,
  nuevoGasto,
  nuevoPago,
  nuevoPromo,
  totalBalonesSoles,
  totalMonto,
  validarAdelanto,
  validarBalon,
  validarCredito,
  validarDescuento,
  validarEntrega,
  validarGasto,
  validarPago,
  validarPromo,
} from "@/lib/registro-columns";

export default function DashboardPage() {
  const router = useRouter();
  const auth = useStore((s) => s.auth);
  const currentSesionId = useStore((s) => s.currentSesionId);
  const syncEstado = useStore((s) => s.sync.estado);
  const sesion = useStore((s) =>
    s.sesiones.find((x) => x.id === s.currentSesionId)
  );
  const setOdometro = useStore((s) => s.setOdometro);
  const cerrarSesion = useStore((s) => s.cerrarSesion);
  const setCurrentSesion = useStore((s) => s.setCurrentSesion);
  const logout = useStore((s) => s.logout);
  const precios = useStore((s) => s.precios);
  const clientes = useStore((s) => s.clientes);
  const clientesDescuento = useStore((s) => s.clientesDescuento);
  // Las acciones del store (addPago, updateCredito, …) son referencias estables,
  // así que se toman una sola vez sin SUSCRIBIR el componente a todo el store.
  // Antes `useStore()` re-renderizaba la pantalla entera con cada tecla.
  const store = useStore.getState();

  const hydrated = useHydrated();
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [finalizandoCierre, setFinalizandoCierre] = useState(false);
  useEffect(() => {
    if (hydrated && !auth) router.replace("/");
    else if (hydrated && auth && !sesion) {
      const esperandoSesionRemota =
        supabaseHabilitado && !!currentSesionId && syncEstado === "conectando";
      if (!esperandoSesionRemota) router.replace("/setup");
    }
  }, [hydrated, auth, sesion, currentSesionId, syncEstado, router]);

  // Banner en vivo (Fase 5): si el admin cambia el precio de un producto de
  // ESTA isla mientras el turno está abierto, se avisa con un toast que se
  // autooculta. El turno NO se recalcula (conserva su precio congelado); el
  // aviso es informativo para el próximo turno.
  useEffect(() => {
    if (!auth) return;
    return subscribeNuevosPrecios((ev) => {
      const s = useStore.getState().sesiones.find(
        (x) => x.id === useStore.getState().currentSesionId
      );
      const isla = s ? getIsla(s.islaId) : undefined;
      if (!isla) return;
      const relevantes: string[] = [
        ...isla.productos,
        ...(isla.tipo === "glp" ? ["gasfull", "zetagas"] : []),
      ];
      if (!relevantes.includes(ev.producto)) return;
      if (ev.aplica === "activo") {
        const actual = useStore.getState();
        if (actual.currentSesionId) {
          useStore.setState((st) => ({
            sesiones: st.sesiones.map((ses) =>
              ses.id === actual.currentSesionId
                ? {
                    ...ses,
                    precios: { ...ses.precios, [ev.producto]: ev.precioNuevo },
                    updatedAt: Date.now(),
                  }
                : ses
            ),
          }));
        }
      }
      const nombre =
        (PRODUCTOS as Record<string, string>)[ev.producto] ??
        (BALONES as Record<string, string>)[ev.producto] ??
        ev.producto;
      toast.info(`Nuevo precio de ${nombre}: ${soles(ev.precioNuevo)}`, {
        description:
          ev.aplica === "activo"
            ? "Aplica desde ahora en este turno."
            : "Regirá desde el próximo turno.",
        duration: 8000,
      });
    });
  }, [auth]);

  const isla = sesion ? getIsla(sesion.islaId) : undefined;

  const productoOptions = useMemo(
    () => (isla?.productos ?? []).map((p) => ({ value: p, label: PRODUCTOS[p] })),
    [isla]
  );

  if (!hydrated || !auth || !sesion || !isla) return null;

  // Precio EFECTIVO del turno: usa el snapshot congelado al abrir la sesión
  // (cae al global). Así, si el admin cambia el precio global a las 2pm, este
  // turno conserva el suyo y no se descuadra en vivo.
  const precio = (p: ProductoId) => preciosDe(sesion, precios)[p] ?? 0;
  // Encoge la fuente del odómetro según los dígitos para que el número
  // completo siempre quepa dentro del input (ej. 987654.321).
  const odoText = (v: number | undefined) => {
    const len = v ? String(v).length : 0;
    if (len >= 13) return "text-[10px]";
    if (len >= 11) return "text-xs";
    return "text-sm";
  };
  const cuadre = calcularCuadre(sesion, precios);
  const esGlp = isla.tipo === "glp";

  // Validación previa al cierre (Fase 5): los errores bloquean, los avisos solo
  // advierten. El resumen del cuadre y esta lista se muestran en el modal.
  const problemas = validarCierre(sesion);
  const cierreBloqueado = !puedeCerrar(problemas);
  const { errores, avisos } = contarPorSeveridad(problemas);

  async function finalizarTurno() {
    // Belt-and-suspenders: nunca cerrar con errores aunque se fuerce el click.
    if (!puedeCerrar(validarCierre(sesion!))) return;
    setFinalizandoCierre(true);
    cerrarSesion(sesion!.id);
    // Escribir el cierre a Firestore EXPLÍCITAMENTE aquí: el guardado
    // automático solo escribe el turno activo, y al limpiar currentSesionId
    // ese guardado ya no dispararía — así que el cerrada:true se perdería.
    const cerrada = useStore
      .getState()
      .sesiones.find((s) => s.id === sesion!.id);
    if (cerrada) {
      try {
        useStore.getState().setSync({ estado: "guardando" });
        await upsertSesion(cerrada);
        limpiarSesionPendiente(cerrada.id);
        // Volcar los créditos del turno (ya definitivos) a la cuenta corriente
        // por cliente, con el precio del turno congelado. No afecta el cuadre.
        await sincronizarCreditosSesion(cerrada);
        // Si con este cierre el turno quedó completo (las 3 islas cerradas),
        // se crea una copia de seguridad automática de ese turno.
        await backupSiTurnoCompleto(cerrada.diaOperativo, cerrada.turno);
        useStore
          .getState()
          .setSync({ estado: "guardado", ultimoGuardado: Date.now() });
      } catch (e) {
        console.error("No se pudo guardar el cierre del turno:", e);
        guardarSesionPendiente(cerrada);
        useStore.getState().setSync({ estado: "sinConexion" });
        toast.error("No se pudo cerrar el turno", {
          description:
            "El turno queda en esta pantalla. Revisa internet y vuelve a intentar.",
          duration: 8000,
        });
        setFinalizandoCierre(false);
        return;
      }
    }
    setFinalizandoCierre(false);
    setConfirmandoCierre(false);
    setCurrentSesion(null);
    router.push("/setup");
  }

  // ---- Columnas compartidas (formulario inline + modal tabla) ----
  const sugClientesCredito = clientesOrdenados(clientes);
  const sugClientesDescuento = clientesOrdenados(clientesDescuento);
  const cCredito = colsCredito(productoOptions, precio, sugClientesCredito);
  const cPromo = colsPromo(productoOptions, precio);
  const cDescuento = colsDescuento(productoOptions, precio, sugClientesDescuento);
  const cAdelanto = colsAdelanto();
  const cBalon = colsBalon(precios);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/40">
      {/* Encabezado */}
      <header className="gs-topbar sticky top-0 z-20 border-b border-white/10 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-green-700 shadow-md shadow-orange-900/40 ring-1 ring-white/20">
              <Fuel className="h-4 w-4 text-white" />
            </span>
            <span className="text-base font-bold tracking-tight">{isla.nombre}</span>
            <Badge className="bg-primary text-primary-foreground hover:bg-primary">
              {turnoLabel(sesion.turno)}
            </Badge>
            <Badge variant="secondary" className="bg-white/10 text-white hover:bg-white/15">
              {auth.rol !== "trabajador" ? auth.nombre : auth.trabajador}
            </Badge>
          </div>
          {/* Precios */}
          <div className="flex flex-wrap items-center gap-1.5">
            {isla.productos.map((p) => (
              <div
                key={p}
                className="gs-chip flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-sm"
              >
                <span className="font-medium text-white/80">{PRODUCTOS[p]}</span>
                <span className="font-bold text-amber-300">{soles(precio(p))}</span>
              </div>
            ))}
            {esGlp &&
              (["gasfull", "zetagas"] as const).map((b) => (
                <div
                  key={b}
                  className="gs-chip flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1 text-sm"
                >
                  <span className="font-medium text-white/80">{BALONES[b]}</span>
                  <span className="font-bold text-amber-300">
                    {soles(precios[b] ?? 0)}
                  </span>
                </div>
              ))}
          </div>
          <div className="flex items-center gap-2">
            <SyncBadge />
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
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-3 p-3 lg:grid-cols-3">
        {/* ----- Columna izquierda ----- */}
        <div className="space-y-3 lg:col-span-2">
          {/* Odómetros estilo Excel */}
          <section className="gs-card animate-fade-up overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm">
            <div className="border-b bg-muted/60 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Odómetros
            </div>
            <div className="overflow-x-auto text-xs [&_td]:px-2 [&_td]:py-0.5 [&_th]:h-7 [&_th]:px-2">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-bold">N-D-ISLA</TableHead>
                    <TableHead className="font-bold text-green-600">INICIO</TableHead>
                    <TableHead className="font-bold text-green-600">FINAL</TableHead>
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
                    // Marca en rojo cuando el FINAL es menor que el INICIO (dato
                    // imposible): así el trabajador lo ve al instante, no al cerrar.
                    const salidaInvalida =
                      (o?.salida ?? 0) > 0 && (o?.salida ?? 0) < (o?.entrada ?? 0);
                    return (
                      <TableRow key={m.id}>
                        <TableCell
                          className={cn("font-semibold", PRODUCTO_COLOR[m.producto])}
                        >
                          {m.label}
                        </TableCell>
                        <TableCell>
                          <Input
                            className={cn(
                              "h-7 w-40 font-semibold tabular-nums",
                              odoText(o?.entrada)
                            )}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            aria-label={`${m.label} — odómetro inicio`}
                            value={o?.entrada || ""}
                            onWheel={(e) => e.currentTarget.blur()}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              // Ignora entradas no numéricas (NaN) para no
                              // corromper el cálculo de galones.
                              if (!Number.isNaN(v))
                                setOdometro(m.id, { entrada: v });
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            className={cn(
                              "h-7 w-40 font-semibold tabular-nums",
                              odoText(o?.salida),
                              salidaInvalida &&
                                "border-green-600 text-green-700 focus-visible:ring-green-600"
                            )}
                            type="number"
                            inputMode="decimal"
                            min={0}
                            step="any"
                            aria-invalid={salidaInvalida}
                            aria-label={`${m.label} — odómetro final`}
                            value={o?.salida || ""}
                            onWheel={(e) => e.currentTarget.blur()}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v))
                                setOdometro(m.id, { salida: v });
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {gl.toFixed(0)}
                        </TableCell>
                        <TableCell className="text-right">{soles(pr)}</TableCell>
                        <TableCell className="text-right font-semibold">
                          {soles(gl * pr)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-slate-100 font-bold dark:bg-slate-800">
                    <TableCell colSpan={5} className="text-right">
                      SUMA EN SOLES
                    </TableCell>
                    <TableCell className="text-right text-base">
                      {soles(cuadre.ventaTotal)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </section>

          {/* Ingresos / registros inline */}
          <section className="gs-card animate-fade-up overflow-hidden rounded-2xl border border-border/60 bg-card shadow-sm" style={{ animationDelay: "80ms" }}>
            <div className="border-b bg-muted/60 px-4 py-2 text-center text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Ingresos y registros
            </div>
            <div className="divide-y">
              <Seccion icon={CreditCard} titulo="Yapes / Transferencias / Visas">
                <RegistroAddForm
                  columns={colsPago()}
                  nuevo={nuevoPago}
                  validar={validarPago}
                  dense
                  onAdd={store.addPago}
                />
              </Seccion>
              <Seccion icon={NotebookPen} titulo="Créditos">
                <RegistroAddForm
                  columns={cCredito}
                  nuevo={() => nuevoCredito(isla.productos[0])}
                  validar={validarCredito}
                  dense
                  onAdd={store.addCredito}
                />
              </Seccion>
              <Seccion icon={Gift} titulo="Promociones">
                <RegistroAddForm
                  columns={cPromo}
                  nuevo={() => nuevoPromo(isla.productos[0])}
                  validar={validarPromo}
                  dense
                  onAdd={store.addPromocion}
                />
              </Seccion>
              <Seccion icon={Tag} titulo="Descuentos">
                <RegistroAddForm
                  columns={cDescuento}
                  nuevo={() => nuevoDescuento(isla.productos[0])}
                  validar={validarDescuento}
                  dense
                  onAdd={store.addDescuento}
                />
              </Seccion>
              <Seccion icon={Banknote} titulo="Gastos">
                <RegistroAddForm
                  columns={colsGasto()}
                  nuevo={nuevoGasto}
                  validar={validarGasto}
                  dense
                  onAdd={store.addGasto}
                />
              </Seccion>
              <Seccion icon={HandCoins} titulo="Pago adelantado">
                <RegistroAddForm
                  columns={cAdelanto}
                  nuevo={nuevoAdelanto}
                  validar={validarAdelanto}
                  dense
                  onAdd={store.addAdelanto}
                />
              </Seccion>
              <Seccion icon={Send} titulo="Entregas al encargado">
                <RegistroAddForm
                  columns={colsEntrega()}
                  nuevo={nuevoEntrega}
                  validar={validarEntrega}
                  dense
                  onAdd={store.addEntrega}
                />
              </Seccion>
              {esGlp && (
                <Seccion icon={Cylinder} titulo="Balones de gas">
                  <RegistroAddForm
                    columns={cBalon}
                    nuevo={nuevoBalon}
                    validar={validarBalon}
                    dense
                    onAdd={store.addBalon}
                  />
                </Seccion>
              )}
            </div>
          </section>
        </div>

        {/* ----- Columna derecha ----- */}
        <div className="space-y-3">
          {/* Botones de tablas */}
          <section className="gs-card animate-fade-up rounded-2xl border border-border/60 bg-card p-2.5 shadow-sm" style={{ animationDelay: "120ms" }}>
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
              Tablas
            </h3>
            <div className="grid grid-cols-2 gap-1.5">
              <RegistroModal<PagoElectronico>
                titulo="Pagos electrónicos"
                islaNombre={isla.nombre}
                rows={sesion.pagos}
                columns={colsPago()}
                onUpdate={store.updatePago}
                onRemove={store.removePago}
                resumen={(r) => resumenPagos(r)}
                trigger={<TablaBtn icon={CreditCard} label="Pagos" n={sesion.pagos.length} />}
              />
              <RegistroModal<Credito>
                titulo="Créditos"
                islaNombre={isla.nombre}
                rows={sesion.creditos}
                columns={cCredito}
                onUpdate={store.updateCredito}
                onRemove={store.removeCredito}
                resumen={(r) =>
                  resumenPorProducto(
                    r.map((x) => ({
                      producto: x.producto,
                      galones: x.galones,
                      precio: precio(x.producto),
                    }))
                  )
                }
                trigger={
                  <TablaBtn icon={NotebookPen} label="Créditos" n={sesion.creditos.length} />
                }
              />
              <RegistroModal<Promocion>
                titulo="Promociones"
                islaNombre={isla.nombre}
                rows={sesion.promociones}
                columns={cPromo}
                onUpdate={store.updatePromocion}
                onRemove={store.removePromocion}
                resumen={(r) =>
                  resumenPorProducto(
                    r.map((x) => ({
                      producto: x.producto,
                      galones: x.galones,
                      precio: precio(x.producto),
                    }))
                  )
                }
                trigger={
                  <TablaBtn icon={Gift} label="Promos" n={sesion.promociones.length} />
                }
              />
              <RegistroModal<Descuento>
                titulo="Descuentos"
                islaNombre={isla.nombre}
                rows={sesion.descuentos}
                columns={cDescuento}
                onUpdate={store.updateDescuento}
                onRemove={store.removeDescuento}
                resumen={(r) =>
                  `Descuento total: ${soles(
                    r.reduce(
                      (a, x) =>
                        a +
                        x.galones * Math.max(0, precio(x.producto) - x.precioDescuento),
                      0
                    )
                  )}`
                }
                trigger={
                  <TablaBtn
                    icon={Tag}
                    label="Descuentos"
                    n={sesion.descuentos.length}
                  />
                }
              />
              <RegistroModal<Gasto>
                titulo="Gastos"
                islaNombre={isla.nombre}
                rows={sesion.gastos}
                columns={colsGasto()}
                onUpdate={store.updateGasto}
                onRemove={store.removeGasto}
                resumen={(r) => `Total: ${soles(totalMonto(r))}`}
                trigger={<TablaBtn icon={Banknote} label="Gastos" n={sesion.gastos.length} />}
              />
              <RegistroModal<Adelanto>
                titulo="Pago adelantado"
                islaNombre={isla.nombre}
                rows={sesion.adelantos}
                columns={cAdelanto}
                onUpdate={store.updateAdelanto}
                onRemove={store.removeAdelanto}
                resumen={(r) => `Total: ${soles(totalMonto(r))}`}
                trigger={
                  <TablaBtn icon={HandCoins} label="Adelantos" n={sesion.adelantos.length} />
                }
              />
              <RegistroModal<Entrega>
                titulo="Entregas al encargado"
                islaNombre={isla.nombre}
                rows={sesion.entregas}
                columns={colsEntrega()}
                onUpdate={store.updateEntrega}
                onRemove={store.removeEntrega}
                resumen={(r) => `Total: ${soles(totalMonto(r))}`}
                trigger={
                  <TablaBtn icon={Send} label="Entregas" n={sesion.entregas.length} />
                }
              />
              {esGlp && (
                <RegistroModal<Balon>
                  titulo="Balones de gas"
                  islaNombre={isla.nombre}
                  rows={sesion.balones ?? []}
                  columns={cBalon}
                  onUpdate={store.updateBalon}
                  onRemove={store.removeBalon}
                  resumen={(r) => `Total: ${soles(totalBalonesSoles(r, precios))}`}
                  trigger={
                    <TablaBtn
                      icon={Cylinder}
                      label="Balones"
                      n={(sesion.balones ?? []).length}
                    />
                  }
                />
              )}
            </div>
          </section>

          {/* Cuadre */}
          <section className="gs-card animate-fade-up rounded-2xl border border-border/60 bg-card p-3.5 shadow-sm" style={{ animationDelay: "160ms" }}>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-bold">
              <Calculator className="h-4 w-4 text-primary" /> Cuadre de caja
            </h3>

            {/* Protagonista: el efectivo que el trabajador debe entregar, en
                número grande y legible a un metro (base del turno). */}
            <div className="mb-2 rounded-xl bg-primary/10 px-4 py-3 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Efectivo a entregar
              </p>
              <p className="mt-0.5 text-3xl font-extrabold tabular-nums text-primary">
                {soles(cuadre.efectivoAEntregar)}
              </p>
            </div>

            <div className="space-y-0.5 text-sm">
              <Linea label="Venta total" valor={soles(cuadre.ventaTotal)} bold />
              <Linea label="− Créditos" valor={soles(cuadre.totalCreditos)} neg />
              <Linea label="− Promociones" valor={soles(cuadre.totalPromociones)} neg />
              <Linea label="− Descuentos" valor={soles(cuadre.totalDescuentos)} neg />
              <Linea
                label="− Pagos electrónicos"
                valor={soles(cuadre.totalElectronico)}
                neg
              />
              <Linea label="− Gastos" valor={soles(cuadre.totalGastos)} neg />
              <Linea
                label="+ Pago adelantado"
                valor={soles(cuadre.totalAdelantos)}
                pos
              />
              {esGlp && (
                <Linea
                  label="+ Balones de gas"
                  valor={soles(cuadre.totalBalones)}
                  pos
                />
              )}
              <Linea label="Entregado al encargado" valor={soles(cuadre.totalEntregado)} />
            </div>

            {/* Estado en vivo del cuadre: verde si ya no falta entregar nada. */}
            <div
              className={cn(
                "mt-2 flex items-center justify-between gap-2 rounded-lg px-3 py-2",
                cuadre.saldoPendiente > 0.001
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : "bg-green-500/15 text-green-700 dark:text-green-300"
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold">
                {cuadre.saldoPendiente > 0.001 ? (
                  <>
                    <AlertTriangle className="h-4 w-4 shrink-0" /> Falta entregar
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> Todo entregado
                  </>
                )}
              </span>
              <span className="text-lg font-bold tabular-nums">
                {soles(cuadre.saldoPendiente)}
              </span>
            </div>
          </section>

          <Button
            className="h-12 w-full bg-primary text-base font-bold tracking-wide text-primary-foreground transition-all hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/30 active:scale-[0.98]"
            onClick={() => setConfirmandoCierre(true)}
          >
            FINALIZAR TURNO
          </Button>
        </div>
      </main>

      <Dialog open={confirmandoCierre} onOpenChange={setConfirmandoCierre}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {cierreBloqueado
                ? "Corrige antes de cerrar el turno"
                : "¿Finalizar y cerrar este turno?"}
            </DialogTitle>
          </DialogHeader>

          {/* Problemas detectados (errores bloquean; avisos solo advierten) */}
          {problemas.length > 0 && (
            <div className="space-y-1.5">
              {cierreBloqueado && (
                <p className="text-sm font-semibold text-green-700">
                  {errores} {errores === 1 ? "problema impide" : "problemas impiden"}{" "}
                  cerrar el turno:
                </p>
              )}
              <ul className="space-y-1 text-xs">
                {problemas.map((p, i) => (
                  <li
                    key={i}
                    className={cn(
                      "flex items-start gap-1.5 rounded-md px-2 py-1",
                      p.severidad === "error"
                        ? "bg-green-600/10 text-red-700 dark:text-red-300"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    )}
                  >
                    <span>{p.severidad === "error" ? "⛔" : "⚠️"}</span>
                    <span>{p.mensaje}</span>
                  </li>
                ))}
              </ul>
              {!cierreBloqueado && avisos > 0 && (
                <p className="text-xs text-muted-foreground">
                  Los avisos no impiden cerrar; revísalos por si acaso.
                </p>
              )}
            </div>
          )}

          {/* Resumen del cuadre */}
          <div className="space-y-0.5 rounded-lg border bg-muted/40 p-3 text-xs">
            <Linea label="Venta total" valor={soles(cuadre.ventaTotal)} bold />
            <Linea label="− Créditos" valor={soles(cuadre.totalCreditos)} neg />
            <Linea label="− Pagos electrónicos" valor={soles(cuadre.totalElectronico)} neg />
            <div className="mt-1 flex items-center justify-between border-t pt-1">
              <span className="font-semibold">Efectivo a entregar</span>
              <span className="font-bold text-primary">
                {soles(cuadre.efectivoAEntregar)}
              </span>
            </div>
            <Linea label="Entregado al encargado" valor={soles(cuadre.totalEntregado)} />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Saldo pendiente</span>
              <span
                className={cn(
                  "font-bold",
                  cuadre.saldoPendiente > 0.001 ? "text-amber-600" : "text-green-600"
                )}
              >
                {soles(cuadre.saldoPendiente)}
              </span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            No podrás seguir editando este turno desde este dispositivo después
            de cerrarlo.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmandoCierre(false)}
              disabled={finalizandoCierre}
            >
              Cancelar
            </Button>
            <Button
              onClick={finalizarTurno}
              disabled={cierreBloqueado || finalizandoCierre}
            >
              {finalizandoCierre ? "Guardando..." : "Finalizar turno"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Seccion({
  icon: Icon,
  titulo,
  children,
}: {
  icon: LucideIcon;
  titulo: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-2 transition-colors hover:bg-accent/40">
      <h4 className="flex w-28 shrink-0 items-center gap-1.5 border-l-2 border-primary/60 pl-2 text-xs font-bold leading-tight">
        <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span>{titulo}</span>
      </h4>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function TablaBtn({
  icon: Icon,
  label,
  n,
  className,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  n: number;
} & ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      className={cn("relative h-12 flex-col gap-0.5 text-[11px] card-lift", className)}
      {...props}
    >
      <Icon className="h-4 w-4" />
      {label}
      {n > 0 && (
        <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
          {n}
        </span>
      )}
    </Button>
  );
}

function Linea({
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
      <span
        className={cn(
          bold && "font-semibold",
          neg && "text-green-600",
          pos && "text-green-600"
        )}
      >
        {valor}
      </span>
    </div>
  );
}
