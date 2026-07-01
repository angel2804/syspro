"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ISLAS, TURNOS } from "@/lib/config";
import { useStore } from "@/lib/store";
import { logoutSupabase } from "@/lib/data/auth";
import { getSesion } from "@/lib/db";
import {
  diaActivoParaNuevosTurnos,
  diaOperativo,
  sesionSinTrabajador,
  turnoHabilitado,
} from "@/lib/calc";
import type { TurnoId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Fuel, Lock, LogOut, CheckCircle2 } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const auth = useStore((s) => s.auth);
  const sesiones = useStore((s) => s.sesiones);
  const iniciarSesion = useStore((s) => s.iniciarSesion);
  const setCurrentSesion = useStore((s) => s.setCurrentSesion);
  const mergeRemoteSesiones = useStore((s) => s.mergeRemoteSesiones);
  const logout = useStore((s) => s.logout);

  const [sel, setSel] = useState<{ islaId: string; turno: TurnoId } | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [verificando, setVerificando] = useState(false);
  // Cuadro de confirmación: el trabajador debe re-confirmar en qué isla está
  // físicamente antes de arrancar, para no repetir el error de elegir mal.
  const [confirmandoIsla, setConfirmandoIsla] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Día operativo "activo" del sistema: no depende del reloj, depende de
  // qué día más antiguo todavía no completó sus 9 turnos en los reportes.
  const diaActivo = useMemo(
    () => diaActivoParaNuevosTurnos(sesiones),
    [sesiones]
  );
  const delDiaActivo = useMemo(
    () => sesiones.filter((s) => diaOperativo(s) === diaActivo),
    [sesiones, diaActivo]
  );

  // Mapa de slots ocupados en el día activo (activos O finalizados): "islaId|turno" -> info
  const ocupados = useMemo(() => {
    const m = new Map<string, { trabajador: string; cerrada: boolean }>();
    delDiaActivo.forEach((s) => {
      // Un turno activo sin trabajador asignado (p. ej. tras mover al trabajador
      // a otra isla) NO cuenta como ocupado: queda libre para que otro lo tome.
      if (!s.cerrada && sesionSinTrabajador(s)) return;
      m.set(`${s.islaId}|${s.turno}`, {
        trabajador: s.trabajador,
        cerrada: s.cerrada,
      });
    });
    return m;
  }, [delDiaActivo]);

  // Turno del trabajador en el día activo: un trabajador hace 1 turno/día.
  const miSesionHoy = useMemo(() => {
    if (!auth || auth.rol !== "trabajador") return undefined;
    return sesiones.find(
      (s) => s.trabajador === auth.trabajador && diaOperativo(s) === diaActivo
    );
  }, [auth, sesiones, diaActivo]);

  useEffect(() => {
    if (!hydrated) return;
    if (!auth) {
      router.replace("/");
      return;
    }
    // Si el trabajador ya tiene un turno ACTIVO hoy, va directo al panel.
    if (miSesionHoy && !miSesionHoy.cerrada) {
      setCurrentSesion(miSesionHoy.id);
      router.replace("/dashboard");
    }
  }, [hydrated, auth, miSesionHoy, router, setCurrentSesion]);

  if (!hydrated || !auth) return null;

  const esAdmin = auth.rol !== "trabajador";
  // Trabajador que ya finalizó su turno hoy: no puede hacer otro.
  const yaCumplioHoy = !esAdmin && !!miSesionHoy && miSesionHoy.cerrada;

  function seleccionar(islaId: string, turno: TurnoId, ocupadoPor?: string) {
    if (!turnoHabilitado(delDiaActivo, turno)) {
      toast.error("Ese turno aún no se puede abrir: falta finalizar el turno anterior en las 3 islas.");
      return;
    }
    if (ocupadoPor && !esAdmin) {
      toast.error(`Este turno ya se llevó (${ocupadoPor}). Selecciona otro.`);
      return;
    }
    setSel({ islaId, turno });
  }

  async function empezar() {
    if (!sel) return;
    if (!turnoHabilitado(delDiaActivo, sel.turno)) {
      toast.error("Ese turno aún no se puede abrir: falta finalizar el turno anterior en las 3 islas.");
      return;
    }
    const ocupado = ocupados.get(`${sel.islaId}|${sel.turno}`);
    if (ocupado && !esAdmin) {
      toast.error(`Este turno ya se llevó (${ocupado.trabajador}). Selecciona otro.`);
      return;
    }

    // Antes de crear la sesión, se consulta Firestore en vivo (no solo el
    // estado local) por si OTRO dispositivo ya inició/cerró este mismo
    // turno hace un instante — evita duplicados por condición de carrera.
    setVerificando(true);
    try {
      const remota = await getSesion(`${diaActivo}_${sel.islaId}_${sel.turno}`);
      if (remota) {
        mergeRemoteSesiones([remota]);
        if (remota.cerrada && !esAdmin) {
          toast.error(`Este turno ya se llevó (${remota.trabajador}). Selecciona otro.`);
          return;
        }
      }
      iniciarSesion(sel.islaId, sel.turno);
      router.push("/dashboard");
    } finally {
      setVerificando(false);
    }
  }

  // El trabajador confirma en qué isla está físicamente. Si coincide con la que
  // eligió, arranca; si no, se le avisa y vuelve a la selección de isla.
  function confirmarIsla(islaId: string) {
    if (!sel) return;
    if (islaId !== sel.islaId) {
      const elegida = ISLAS.find((i) => i.id === sel.islaId)?.nombre ?? "";
      toast.error(
        `No es tu isla correcta. Habías elegido ${elegida}. Selecciona bien tu isla.`
      );
      setConfirmandoIsla(false);
      setSel(null);
      return;
    }
    setConfirmandoIsla(false);
    empezar();
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 p-4">
      <div className="mx-auto max-w-4xl animate-in fade-in slide-in-from-bottom-4 duration-500">
        {/* Encabezado */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 animate-float items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-600 shadow-lg">
              <Fuel className="h-6 w-6 text-white" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-white">
                Hola, <span className="text-gradient">{esAdmin ? "Administrador" : auth.trabajador}</span>
              </h1>
              <p className="text-sm text-slate-400">
                Elige la isla y el turno para empezar
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="text-slate-300 hover:bg-white/10 hover:text-white"
            onClick={async () => {
              await logoutSupabase();
              logout();
              router.replace("/");
            }}
          >
            <LogOut className="mr-1 h-4 w-4" /> Salir
          </Button>
        </div>

        {/* Trabajador que ya hizo su turno hoy: no puede tomar otro */}
        {yaCumplioHoy ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center backdrop-blur-xl">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
            <h2 className="text-lg font-semibold text-white">
              Ya realizaste tu turno de hoy
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Cada trabajador puede registrar un solo turno por día. Vuelve mañana.
            </p>
          </div>
        ) : (
        /* Matriz isla x turno */
        <div className="grid gap-4">
          {ISLAS.map((isla, i) => (
            <div
              key={isla.id}
              style={{ animationDelay: `${i * 90}ms` }}
              className="animate-fade-up rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl card-lift"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-white">{isla.nombre}</h2>
                <span className="text-xs text-slate-400">
                  {isla.mangueras.length} mangueras
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {TURNOS.map((t) => {
                  const ocupado = ocupados.get(`${isla.id}|${t.id}`);
                  const habilitado = turnoHabilitado(delDiaActivo, t.id);
                  const bloqueado = (!!ocupado && !esAdmin) || !habilitado;
                  const elegido =
                    sel?.islaId === isla.id && sel?.turno === t.id;
                  return (
                    <button
                      key={t.id}
                      disabled={bloqueado}
                      onClick={() => seleccionar(isla.id, t.id, ocupado?.trabajador)}
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-1 rounded-xl border p-4 transition-all",
                        bloqueado
                          ? "cursor-not-allowed border-red-500/30 bg-red-500/10"
                          : "border-white/10 bg-white/5 hover:scale-[1.03] hover:border-amber-400/60 hover:bg-white/10",
                        elegido &&
                          "border-amber-400 bg-amber-500/20 ring-2 ring-amber-400"
                      )}
                    >
                      {elegido && (
                        <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-amber-400" />
                      )}
                      <span
                        className={cn(
                          "text-base font-semibold",
                          bloqueado ? "text-red-300" : "text-white"
                        )}
                      >
                        {t.label}
                      </span>
                      {!habilitado ? (
                        <span className="flex items-center gap-1 text-center text-[11px] text-red-300/90">
                          <Lock className="h-3 w-3 shrink-0" />
                          Falta finalizar el turno anterior
                        </span>
                      ) : ocupado ? (
                        <span className="flex items-center gap-1 text-[11px] text-red-300/90">
                          <Lock className="h-3 w-3" />
                          {ocupado.cerrada ? "Finalizado" : "En curso"} ·{" "}
                          {ocupado.trabajador}
                        </span>
                      ) : (
                        <span className="text-[11px] text-emerald-300/80">
                          Disponible
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        )}

        {/* Acción */}
        {!yaCumplioHoy && (
          <div className="mt-6 flex justify-end">
            <Button
              disabled={!sel || verificando}
              onClick={() => setConfirmandoIsla(true)}
              className="h-12 bg-gradient-to-r from-amber-500 to-orange-600 px-8 text-base font-bold text-white shadow-lg shadow-orange-900/30 hover:from-amber-400 hover:to-orange-500 disabled:opacity-40"
            >
              {verificando ? "Verificando…" : "Empezar turno"}
            </Button>
          </div>
        )}
      </div>

      {/* Confirmación de isla: el trabajador re-confirma dónde está físicamente */}
      <Dialog open={confirmandoIsla} onOpenChange={setConfirmandoIsla}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verifica que estés en la isla correcta</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Toca la isla en la que estás físicamente. Si no coincide con la que
            elegiste, tendrás que seleccionarla de nuevo.
          </p>
          <div className="mt-2 grid gap-2">
            {ISLAS.map((isla) => (
              <Button
                key={isla.id}
                variant="outline"
                className="h-12 justify-center text-base font-semibold"
                onClick={() => confirmarIsla(isla.id)}
              >
                {isla.nombre}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
