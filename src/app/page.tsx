"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ADMIN_PASSWORD, getIsla, turnoLabel } from "@/lib/config";
import { loginConPassword, loginTrabajadorCompartido } from "@/lib/data/auth";
import { hoy, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  User,
  Fuel,
  ArrowLeft,
  Lock,
  ChevronRight,
  Clock,
  Users,
  BarChart3,
  Layers,
  Activity,
  TrendingUp,
} from "lucide-react";

type Modo = "inicio" | "admin" | "trabajador";

// Fondo del login. Imagen fija (en /public) → muestra la foto y oculta el
// showcase decorativo de la izquierda. Pon `null` para volver al fondo
// animado anterior (auroras + ilustración SVG).
const FONDO_IMG: string | null = "/fondologin.png";

// Duración de la intro de carga (ms). Solo se muestra una vez por sesión del
// navegador; al volver al login dentro de la misma sesión, aparece directo.
const LOAD_MS = 3200;

// Efecto ripple luminoso al hacer click (se posiciona en el punto del cursor).
function ripple(e: React.PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const span = document.createElement("span");
  span.className = "gs-ripple";
  span.style.width = span.style.height = `${size}px`;
  span.style.left = `${e.clientX - rect.left - size / 2}px`;
  span.style.top = `${e.clientY - rect.top - size / 2}px`;
  el.appendChild(span);
  span.addEventListener("animationend", () => span.remove());
}

export default function LoginPage() {
  const router = useRouter();
  const loginAdmin = useStore((s) => s.loginAdmin);
  const setAuth = useStore((s) => s.setAuth);
  const setCurrentSesion = useStore((s) => s.setCurrentSesion);
  const sesiones = useStore((s) => s.sesiones);
  const trabajadores = useStore((s) => s.trabajadores);
  const logo = useStore((s) => s.logo);

  const [modo, setModo] = useState<Modo>("inicio");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [cargando, setCargando] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // Flujo trabajador: primero login de la cuenta COMPARTIDA, luego elegir nombre.
  const [temail, setTemail] = useState("");
  const [tpass, setTpass] = useState("");
  const [trabListo, setTrabListo] = useState(false);
  const [trabUserId, setTrabUserId] = useState<string | undefined>(undefined);

  // Fases de la pantalla: carga inicial → destello → login listo.
  const [fase, setFase] = useState<"loading" | "ready">("loading");
  const [flash, setFlash] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    setHydrated(true);
    // La intro completa se ve una sola vez por sesión del navegador.
    const yaVista =
      typeof window !== "undefined" &&
      sessionStorage.getItem("gs-intro-seen") === "1";
    if (yaVista) {
      setFase("ready");
      return;
    }
    const t = timers.current;
    t.push(setTimeout(() => terminarCarga(), LOAD_MS));
    return () => t.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pasa de la pantalla de carga al login con un destello + zoom.
  function terminarCarga() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (typeof window !== "undefined")
      sessionStorage.setItem("gs-intro-seen", "1");
    setFlash(true);
    timers.current.push(setTimeout(() => setFase("ready"), 160));
    timers.current.push(setTimeout(() => setFlash(false), 700));
  }

  async function entrarAdmin() {
    if (cargando) return;
    // Respaldo anti-lockout: sin correo + contraseña maestra → acceso total
    // legacy (útil hasta crear los usuarios de Supabase Auth del dueño/admin).
    if (!email.trim() && pass === ADMIN_PASSWORD) {
      loginAdmin(null);
      router.push("/admin");
      return;
    }
    setCargando(true);
    try {
      // Staff (dueño/admin/encargado) con email + contraseña vía Supabase Auth.
      const perfil = await loginConPassword(email, pass);
      setAuth({
        rol: perfil.rol,
        trabajador: "",
        nombre: perfil.nombre,
        permisos: perfil.permisos,
        userId: perfil.id,
      });
      toast.success(`Bienvenido, ${perfil.nombre}`);
      router.push("/admin");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  // Paso 1 del trabajador: validar la CUENTA COMPARTIDA (email + contraseña).
  async function entrarCuentaTrabajador() {
    if (cargando) return;
    setCargando(true);
    try {
      const perfil = await loginTrabajadorCompartido(temail, tpass);
      setTrabUserId(perfil.id);
      setTrabListo(true); // pasa a elegir nombre real
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCargando(false);
    }
  }

  // Paso 2 del trabajador: elegir el nombre real (administrado por dueño/admin).
  // No crea usuarios: la identidad de Supabase es la cuenta compartida; el
  // nombre elegido se guarda en `sesiones.trabajador` al abrir turno.
  function elegirTrabajador(nombre: string) {
    setAuth({
      rol: "trabajador",
      trabajador: nombre,
      nombre,
      permisos: [],
      userId: trabUserId,
    });
    const activa = sesiones.find((s) => s.trabajador === nombre && !s.cerrada);
    if (activa) {
      setCurrentSesion(activa.id);
      const isla = getIsla(activa.islaId);
      toast.info(
        `Continuando turno: ${isla?.nombre} · ${turnoLabel(activa.turno)}`
      );
      router.push("/dashboard");
    } else {
      router.push("/setup");
    }
  }

  const logoNode = (
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit] bg-gradient-to-br from-emerald-400 via-emerald-500 to-teal-700">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="Logo" className="h-full w-full object-contain" />
      ) : (
        <Fuel className="h-1/2 w-1/2 text-white" strokeWidth={2.2} />
      )}
    </div>
  );

  return (
    <div className="relative h-screen overflow-hidden bg-[#04100c] text-white">
      {/* Fondo: imagen fija o efectos animados (según FONDO_IMG) */}
      {FONDO_IMG ? <FondoImagen src={FONDO_IMG} /> : <Fondo />}

      {/* Pantalla de carga */}
      {fase === "loading" && (
        <PantallaCarga logoNode={logoNode} onSkip={terminarCarga} />
      )}

      {/* Destello de transición */}
      {flash && (
        <div className="dl-flash pointer-events-none fixed inset-0 z-50" />
      )}

      {/* Login */}
      {fase === "ready" && (
        <div className="animate-zoom-in relative z-10 grid h-screen overflow-hidden lg:grid-cols-[1.05fr_1fr]">
          {/* ===================== Panel izquierdo: showcase ===================== */}
          <aside
            className={cn(
              "relative hidden h-screen flex-col overflow-hidden p-8 xl:p-10 lg:flex",
              FONDO_IMG
                ? "justify-center"
                : "justify-between border-r border-emerald-400/10"
            )}
          >
            {/* Etiquetas de esquina estilo HUD (la foto ya las trae) */}
            <div className={cn("flex items-start justify-between", FONDO_IMG && "hidden")}>
              <div className="flex items-center gap-3">
                <div className="dl-logo-glow animate-float h-12 w-12 overflow-hidden rounded-2xl ring-1 ring-emerald-300/30">
                  {logoNode}
                </div>
                <div className="leading-tight">
                  <p className="text-lg font-bold tracking-tight">
                    <span className="dl-text-gradient">DevLens</span>
                  </p>
                  <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-emerald-300/60">
                    System
                  </p>
                </div>
              </div>
              <div className="text-right text-[10px] font-medium uppercase tracking-[0.25em] text-emerald-300/50">
                <p>Sistema inteligente</p>
                <p>en tiempo real</p>
              </div>
            </div>

            {/* Ilustración + frase principal */}
            <div
              className={cn(
                "flex min-h-0 flex-col justify-center gap-5 py-4",
                !FONDO_IMG && "flex-1"
              )}
            >
              {/* La ilustración SVG se oculta con imagen (la foto ya la trae) */}
              <div className={cn("relative", FONDO_IMG && "hidden")}>
                <span className="dl-breathe absolute left-1/2 top-1/2 -z-10 h-60 w-60 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
                <div className="flex justify-center">
                  <EstacionIlustracion />
                </div>
              </div>

              <div className="max-w-md opacity-0 [animation:gs-fade-up_0.7s_ease-out_0.6s_forwards]">
                <h2 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
                  Control total de tu
                  <br />
                  <span className="dl-text-gradient">estación de servicio</span>
                </h2>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-emerald-100/50">
                  Monitorea ventas, turnos e islas en tiempo real. Una
                  plataforma rápida, confiable y diseñada para operar a nivel
                  profesional.
                </p>
              </div>

              {/* Tarjetas informativas con iconos */}
              <div className="grid max-w-lg grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  { icon: Clock, label: "Tiempo Real" },
                  { icon: Layers, label: "3 Islas" },
                  { icon: Users, label: "Multiusuario" },
                  { icon: BarChart3, label: "Reportes" },
                ].map(({ icon: Icon, label }, i) => (
                  <div
                    key={label}
                    style={{ animationDelay: `${0.75 + i * 0.08}s` }}
                    className="group flex flex-col items-center gap-1.5 rounded-xl border border-emerald-400/15 bg-black/30 p-2.5 text-center opacity-0 shadow-lg backdrop-blur-md transition-colors [animation:gs-fade-up_0.6s_ease-out_forwards] hover:border-emerald-400/40 hover:bg-emerald-500/15"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-300 transition-transform duration-200 group-hover:scale-110">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-[11px] font-medium text-emerald-100/70">
                      {label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Estadísticas decorativas */}
              <div className="grid max-w-lg grid-cols-3 gap-2.5">
                {[
                  { icon: Activity, valor: "1,248", label: "Operaciones del día" },
                  { icon: Users, valor: "12", label: "Trabajadores activos" },
                  { icon: TrendingUp, valor: "S/ 38.4k", label: "Ventas del día" },
                ].map(({ icon: Icon, valor, label }, i) => (
                  <div
                    key={label}
                    style={{ animationDelay: `${1.05 + i * 0.08}s` }}
                    className="rounded-xl border border-emerald-400/15 bg-black/30 p-2.5 opacity-0 shadow-lg backdrop-blur-md [animation:gs-fade-up_0.6s_ease-out_forwards]"
                  >
                    <Icon className="h-4 w-4 text-emerald-400/80" />
                    <p className="mt-1.5 text-xl font-bold tabular-nums tracking-tight text-white">
                      {valor}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-emerald-100/40">
                      {label}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Pie estilo HUD (la foto ya lo trae) */}
            <div className={cn("flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.25em] text-emerald-300/45", FONDO_IMG && "hidden")}>
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Control total · Estaciones conectadas
            </div>
          </aside>

          {/* ===================== Panel derecho: login ===================== */}
          <main className="relative flex h-screen items-center justify-center overflow-y-auto p-4 sm:p-8">
            <div className="w-full max-w-md">
              {/* Logo compacto solo en móvil */}
              <div className="mb-6 flex flex-col items-center gap-3 text-center lg:hidden">
                <div className="dl-logo-glow animate-float h-16 w-16 overflow-hidden rounded-2xl ring-1 ring-emerald-300/30">
                  {logoNode}
                </div>
                <h1 className="dl-text-gradient text-2xl font-extrabold tracking-tight">
                  DevLens
                </h1>
              </div>

              <div className="mb-7 opacity-0 [animation:gs-fade-up_0.5s_ease-out_0.2s_forwards]">
                <p className="text-sm font-medium tracking-wide text-emerald-300/70">
                  Bienvenido
                </p>
                <h2 className="mt-1 text-3xl font-semibold tracking-tight">
                  DevLens <span className="text-emerald-400">Management</span>
                </h2>
                <p className="mt-2 text-sm text-emerald-100/45">
                  Selecciona cómo deseas ingresar al sistema.
                </p>
              </div>

              {/* Tarjeta flotante premium con borde iluminado */}
              <div className="dl-glow-border rounded-2xl border border-emerald-400/10 bg-white/[0.04] p-6 opacity-0 shadow-[0_24px_70px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl [animation:gs-fade-up_0.6s_ease-out_0.35s_forwards] sm:p-7">
                {modo === "inicio" && (
                  <div className="grid gap-3">
                    <button
                      onPointerDown={ripple}
                      onClick={() => setModo("admin")}
                      className="gs-ripple-host animate-slide-in-left group flex items-center gap-4 rounded-xl border border-emerald-400/10 bg-white/[0.03] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-emerald-400/40 hover:bg-emerald-400/[0.07] hover:shadow-[0_12px_40px_-16px_rgba(16,185,129,0.6)] active:scale-[0.98]"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 transition-all duration-200 group-hover:scale-105 group-hover:bg-emerald-500/25">
                        <ShieldCheck className="h-7 w-7" />
                      </span>
                      <span className="flex-1">
                        <span className="block font-semibold text-white">
                          Administrador
                        </span>
                        <span className="block text-xs text-emerald-100/50">
                          Acceso con contraseña
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 text-emerald-300/40 transition-all duration-200 group-hover:translate-x-1 group-hover:text-emerald-300" />
                    </button>

                    <button
                      onPointerDown={ripple}
                      onClick={() => setModo("trabajador")}
                      className="gs-ripple-host animate-slide-in-right group flex items-center gap-4 rounded-xl border border-sky-400/10 bg-white/[0.03] p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/40 hover:bg-sky-400/[0.07] hover:shadow-[0_12px_40px_-16px_rgba(56,189,248,0.55)] active:scale-[0.98]"
                    >
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-sky-500/15 text-sky-300 transition-all duration-200 group-hover:scale-105 group-hover:bg-sky-500/25">
                        <User className="h-7 w-7" />
                      </span>
                      <span className="flex-1">
                        <span className="block font-semibold text-white">
                          Trabajador
                        </span>
                        <span className="block text-xs text-sky-100/50">
                          Selecciona tu nombre
                        </span>
                      </span>
                      <ChevronRight className="h-5 w-5 text-sky-300/40 transition-all duration-200 group-hover:translate-x-1 group-hover:text-sky-300" />
                    </button>
                  </div>
                )}

                {modo === "admin" && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <BackBtn
                      onClick={() => {
                        setModo("inicio");
                        setEmail("");
                        setPass("");
                      }}
                    />

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-emerald-100/80">
                        Correo
                      </label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/50" />
                        <Input
                          type="email"
                          value={email}
                          autoFocus
                          autoComplete="username"
                          onChange={(e) => setEmail(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && entrarAdmin()}
                          placeholder="dueno@grifo.com"
                          className="border-emerald-400/15 bg-white/[0.04] pl-9 text-white placeholder:text-emerald-100/30 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-emerald-100/80">
                        Contraseña
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-300/50" />
                        <Input
                          type="password"
                          value={pass}
                          autoComplete="current-password"
                          onChange={(e) => setPass(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && entrarAdmin()}
                          placeholder="••••••••"
                          className="border-emerald-400/15 bg-white/[0.04] pl-9 text-white placeholder:text-emerald-100/30 focus-visible:border-emerald-400/50 focus-visible:ring-emerald-400/30"
                        />
                      </div>
                    </div>

                    <Button
                      onPointerDown={ripple}
                      disabled={cargando}
                      className="gs-ripple-host h-11 w-full bg-gradient-to-r from-emerald-500 to-teal-600 font-semibold text-white transition-all duration-200 hover:from-emerald-400 hover:to-teal-500 hover:shadow-[0_12px_40px_-12px_rgba(16,185,129,0.7)] active:scale-[0.98]"
                      onClick={entrarAdmin}
                    >
                      {cargando ? "Entrando…" : "Entrar"}
                    </Button>
                    <p className="text-center text-[11px] text-emerald-100/35">
                      Dueño, administrador o encargado
                    </p>
                  </div>
                )}

                {modo === "trabajador" && !trabListo && (
                  // Paso 1: acceso con la cuenta COMPARTIDA de trabajador.
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <BackBtn
                      onClick={() => {
                        setModo("inicio");
                        setTemail("");
                        setTpass("");
                      }}
                    />
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-sky-100/80">
                        Correo de trabajador
                      </label>
                      <div className="relative">
                        <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-300/50" />
                        <Input
                          type="email"
                          value={temail}
                          autoFocus
                          autoComplete="username"
                          onChange={(e) => setTemail(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && entrarCuentaTrabajador()}
                          placeholder="trabajador@grifo.local"
                          className="border-sky-400/15 bg-white/[0.04] pl-9 text-white placeholder:text-sky-100/30 focus-visible:border-sky-400/50 focus-visible:ring-sky-400/30"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-sky-100/80">
                        Contraseña
                      </label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sky-300/50" />
                        <Input
                          type="password"
                          value={tpass}
                          autoComplete="current-password"
                          onChange={(e) => setTpass(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && entrarCuentaTrabajador()}
                          placeholder="••••••••"
                          className="border-sky-400/15 bg-white/[0.04] pl-9 text-white placeholder:text-sky-100/30 focus-visible:border-sky-400/50 focus-visible:ring-sky-400/30"
                        />
                      </div>
                    </div>
                    <Button
                      onPointerDown={ripple}
                      disabled={cargando}
                      className="gs-ripple-host h-11 w-full bg-gradient-to-r from-sky-500 to-indigo-600 font-semibold text-white transition-all duration-200 hover:from-sky-400 hover:to-indigo-500 active:scale-[0.98]"
                      onClick={entrarCuentaTrabajador}
                    >
                      {cargando ? "Verificando…" : "Continuar"}
                    </Button>
                    <p className="text-center text-[11px] text-sky-100/35">
                      Cuenta común del grifo · luego eliges tu nombre
                    </p>
                  </div>
                )}

                {modo === "trabajador" && trabListo && (
                  // Paso 2: elegir el nombre real (lista administrada por dueño/admin).
                  <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                    <BackBtn
                      onClick={() => {
                        setTrabListo(false);
                        setTpass("");
                      }}
                    />
                    <label className="text-sm font-medium text-emerald-100/80">
                      Selecciona tu nombre
                    </label>
                    <div className="grid gap-2">
                      {trabajadores.map((nombre, i) => {
                        const activa =
                          hydrated &&
                          sesiones.find(
                            (s) => s.trabajador === nombre && !s.cerrada
                          );
                        return (
                          <button
                            key={nombre}
                            onPointerDown={ripple}
                            onClick={() => elegirTrabajador(nombre)}
                            style={{ animationDelay: `${i * 60}ms` }}
                            className="gs-ripple-host group flex animate-in fade-in items-center justify-between gap-3 rounded-xl border border-sky-400/10 bg-white/[0.03] p-3 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-400/40 hover:bg-sky-400/[0.07] active:scale-[0.98]"
                          >
                            <span className="flex items-center gap-3">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 font-bold text-white">
                                {nombre[0]}
                              </span>
                              <span className="font-medium text-white">
                                {nombre}
                              </span>
                            </span>
                            {activa ? (
                              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                                Turno activo
                              </span>
                            ) : (
                              <ChevronRight className="h-4 w-4 text-sky-300/40 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-sky-300" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <p className="mt-6 text-center text-xs text-emerald-100/30">
                {hoy()} · DevLens · Sistema de estación de servicios
              </p>
              <p className="mt-1 text-center text-[11px] text-emerald-100/25">
                <a href="/bootstrap" className="hover:text-emerald-200/60 hover:underline">
                  Primer arranque: crear usuario dueño
                </a>
              </p>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

// --- Ilustración de estación de servicio (inspirada en la referencia) -------
function EstacionIlustracion() {
  return (
    <svg
      viewBox="0 0 520 300"
      className="h-auto w-full max-w-sm drop-shadow-[0_20px_50px_rgba(16,185,129,0.18)]"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="dl-neon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#34d399" />
          <stop offset="0.5" stopColor="#10b981" />
          <stop offset="1" stopColor="#0ea5a4" />
        </linearGradient>
        <linearGradient id="dl-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#10b981" stopOpacity="0.25" />
          <stop offset="1" stopColor="#10b981" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="dl-build" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0c2a22" />
          <stop offset="1" stopColor="#071a15" />
        </linearGradient>
        <filter id="dl-blur" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.5" />
        </filter>
      </defs>

      {/* Reflejo del suelo */}
      <ellipse cx="250" cy="270" rx="240" ry="26" fill="url(#dl-floor)" />
      <line x1="20" y1="252" x2="500" y2="252" stroke="#10b981" strokeOpacity="0.2" />

      {/* Edificio / tienda al fondo */}
      <rect x="150" y="150" width="150" height="102" rx="4" fill="url(#dl-build)" stroke="#10b981" strokeOpacity="0.25" />
      <rect x="166" y="172" width="40" height="28" rx="2" fill="#10b981" fillOpacity="0.12" />
      <rect x="216" y="172" width="40" height="28" rx="2" fill="#10b981" fillOpacity="0.12" />
      <rect x="266" y="172" width="22" height="28" rx="2" fill="#10b981" fillOpacity="0.12" />
      <text x="225" y="142" textAnchor="middle" fontSize="11" fontWeight="700" fill="#34d399" opacity="0.85">DevLens</text>

      {/* Marquesina (canopy) con borde neón */}
      <polygon points="36,96 360,96 392,120 68,120" fill="#0a241d" stroke="url(#dl-neon)" strokeWidth="2" />
      <polygon points="36,96 360,96 392,120 68,120" fill="none" stroke="#34d399" strokeWidth="1" opacity="0.5" filter="url(#dl-blur)" />
      <text x="150" y="113" fontSize="15" fontWeight="800" fill="#34d399" letterSpacing="1">DevLens</text>

      {/* Pilares */}
      <rect x="74" y="120" width="9" height="132" fill="#0c2a22" stroke="#10b981" strokeOpacity="0.3" />
      <rect x="300" y="120" width="9" height="132" fill="#0c2a22" stroke="#10b981" strokeOpacity="0.3" />

      {/* Surtidores 01 / 02 / 03 */}
      {[
        { x: 96, n: "01" },
        { x: 138, n: "02" },
      ].map(({ x, n }) => (
        <g key={n}>
          <rect x={x} y="178" width="26" height="74" rx="4" fill="#0c2a22" stroke="url(#dl-neon)" strokeWidth="1.5" />
          <rect x={x + 5} y="186" width="16" height="12" rx="2" fill="#10b981" fillOpacity="0.3" />
          <rect x={x + 2} y="250" width="22" height="3" rx="1.5" fill="#34d399" opacity="0.7" />
          <text x={x + 13} y="246" textAnchor="middle" fontSize="8" fill="#6ee7b7">{n}</text>
        </g>
      ))}

      {/* Surtidor 03 (GLP) + tanque */}
      <g>
        <rect x="332" y="190" width="22" height="62" rx="4" fill="#0c2a22" stroke="url(#dl-neon)" strokeWidth="1.5" />
        <rect x="336" y="197" width="14" height="10" rx="2" fill="#10b981" fillOpacity="0.3" />
        <text x="343" y="246" textAnchor="middle" fontSize="8" fill="#6ee7b7">03</text>
      </g>
      <g>
        <rect x="368" y="206" width="96" height="46" rx="23" fill="#0a241d" stroke="url(#dl-neon)" strokeWidth="1.5" />
        <ellipse cx="368" cy="229" rx="9" ry="23" fill="#0c2a22" stroke="#10b981" strokeOpacity="0.4" />
        <text x="420" y="234" textAnchor="middle" fontSize="13" fontWeight="700" fill="#fff" opacity="0.9">GLP</text>
      </g>

      {/* Luces del techo */}
      {[120, 170, 220, 270, 320].map((x) => (
        <rect key={x} x={x} y="100" width="14" height="3" rx="1.5" fill="#eafff7" opacity="0.5" />
      ))}
    </svg>
  );
}

// --- Pantalla de carga inicial ---------------------------------------------
function PantallaCarga({
  logoNode,
  onSkip,
}: {
  logoNode: React.ReactNode;
  onSkip: () => void;
}) {
  return (
    <div
      onClick={onSkip}
      className="fixed inset-0 z-40 flex cursor-pointer flex-col items-center justify-center backdrop-blur-xl"
    >
      <div className="relative">
        <span className="absolute inset-0 -z-10 animate-float rounded-[2rem] bg-emerald-500/20 blur-2xl" />
        <div className="animate-logo-pop dl-logo-glow h-28 w-28 rounded-[2rem] ring-1 ring-emerald-300/25">
          {logoNode}
        </div>
      </div>

      <h1 className="dl-text-gradient mt-7 text-3xl font-bold tracking-tight">
        DevLens
      </h1>

      {/* Barra de carga elegante */}
      <div className="relative mt-6 h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
        <div className="gs-progress-fill h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500" />
        <div className="gs-progress-shine absolute inset-y-0 w-1/3" />
      </div>

      <p className="mt-4 text-sm text-emerald-100/50">
        Iniciando sistema
        <span className="gs-dot ml-0.5">.</span>
        <span className="gs-dot" style={{ animationDelay: "0.2s" }}>
          .
        </span>
        <span className="gs-dot" style={{ animationDelay: "0.4s" }}>
          .
        </span>
      </p>
    </div>
  );
}

// --- Capa de decoraciones animadas (auroras + partículas + motas) ----------
// Reutilizada por el fondo animado y por el fondo con imagen, para que las
// animaciones se mantengan en ambos casos.
function Decoraciones() {
  // Las partículas usan Math.random(), que daría valores distintos en el
  // servidor (SSR) y en el cliente y rompería la hidratación. Por eso se
  // generan SOLO en el cliente, después del montaje.
  const [particulas, setParticulas] = useState<
    { left: number; bottom: number; size: number; dur: number; delay: number; op: number }[]
  >([]);
  // Motas que flotan lentamente en su sitio, con opacidad baja (más sutiles
  // que las partículas que ascienden).
  const [motas, setMotas] = useState<
    { left: number; top: number; size: number; dur: number; delay: number; op: number }[]
  >([]);
  useEffect(() => {
    setParticulas(
      Array.from({ length: 22 }, () => ({
        left: Math.random() * 100,
        bottom: -10 - Math.random() * 10,
        size: 2 + Math.random() * 6,
        dur: 10 + Math.random() * 11,
        delay: Math.random() * 9,
        op: 0.2 + Math.random() * 0.4,
      }))
    );
    setMotas(
      Array.from({ length: 16 }, () => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        size: 1.5 + Math.random() * 3,
        dur: 12 + Math.random() * 10,
        delay: Math.random() * 8,
        op: 0.08 + Math.random() * 0.18,
      }))
    );
  }, []);
  return (
    <>
      {/* Auroras verdes: ondas luminosas lentas */}
      <div className="dl-aurora">
        <span className="dl-aurora-1" />
        <span className="dl-aurora-2" />
        <span className="dl-aurora-3" />
      </div>

      {/* Partículas que ascienden */}
      {particulas.map((p, i) => (
        <span
          key={i}
          className="dl-particle"
          style={
            {
              left: `${p.left}%`,
              bottom: `${p.bottom}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDuration: `${p.dur}s`,
              animationDelay: `${p.delay}s`,
              "--p-op": p.op,
            } as React.CSSProperties
          }
        />
      ))}

      {/* Motas flotando lentamente (muy sutiles) */}
      {motas.map((m, i) => (
        <span
          key={`m${i}`}
          className="dl-drift-soft absolute rounded-full bg-emerald-300"
          style={{
            left: `${m.left}%`,
            top: `${m.top}%`,
            width: `${m.size}px`,
            height: `${m.size}px`,
            opacity: m.op,
            animationDuration: `${m.dur}s`,
            animationDelay: `${m.delay}s`,
            boxShadow: "0 0 6px rgb(52 211 153 / 0.6)",
          }}
        />
      ))}
    </>
  );
}

// --- Fondo con imagen fija (referencia del escritorio) + animaciones --------
function FondoImagen({ src }: { src: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="h-full w-full object-cover" />
      {/* Oscurecido general + más oscuro a la derecha para que el panel de
          login resalte sobre la imagen. */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/35 via-black/25 to-black/70" />
      {/* Animaciones por encima de la foto (auroras + partículas) */}
      <Decoraciones />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_50%,rgba(2,8,6,0.6)_100%)]" />
    </div>
  );
}

// --- Fondo decorativo continuo (sin imagen) --------------------------------
function Fondo() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Cuadrícula tenue */}
      <div className="dl-grid absolute inset-0" />

      {/* Blobs en deriva: verde dominante + azul tenue */}
      <div className="animate-drift absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-emerald-500/20 blur-[120px]" />
      <div
        className="animate-drift absolute -bottom-44 right-1/4 h-96 w-96 rounded-full bg-teal-500/15 blur-[120px]"
        style={{ animationDelay: "5s" }}
      />
      <div
        className="animate-drift absolute -right-24 top-1/4 h-80 w-80 rounded-full bg-sky-500/10 blur-[120px]"
        style={{ animationDelay: "9s" }}
      />

      {/* Líneas tecnológicas curvas y luminosas */}
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 1440 900"
      >
        <defs>
          <linearGradient id="dl-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#10b981" stopOpacity="0" />
            <stop offset="0.5" stopColor="#34d399" stopOpacity="0.55" />
            <stop offset="1" stopColor="#10b981" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 26, 52, 78, 104].map((dy, i) => (
          <path
            key={dy}
            d={`M 1480 ${300 + dy} C 1180 ${360 + dy}, 1120 ${600 + dy}, 760 ${640 + dy} S 320 ${560 + dy}, -40 ${720 + dy}`}
            fill="none"
            stroke="url(#dl-line)"
            strokeWidth="1.1"
            className="dl-flow"
            style={{ animationDelay: `${i * 1.4}s`, animationDuration: `${16 + i * 2}s` }}
          />
        ))}
      </svg>

      <Decoraciones />

      {/* Viñeta para dar profundidad */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(2,8,6,0.85)_100%)]" />
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 text-sm text-emerald-100/50 transition-colors hover:text-emerald-200"
    >
      <ArrowLeft className="h-4 w-4" /> Volver
    </button>
  );
}
