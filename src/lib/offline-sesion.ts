import type { Sesion } from "./types";

const PENDING_SESION_KEY = "grifo-sys:pending-sesion";

export function leerSesionPendiente(): Sesion | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PENDING_SESION_KEY);
    return raw ? (JSON.parse(raw) as Sesion) : null;
  } catch {
    return null;
  }
}

export function guardarSesionPendiente(s: Sesion) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PENDING_SESION_KEY, JSON.stringify(s));
}

export function limpiarSesionPendiente(id?: string) {
  if (typeof window === "undefined") return;
  const pendiente = leerSesionPendiente();
  if (!pendiente || (id && pendiente.id !== id)) return;
  localStorage.removeItem(PENDING_SESION_KEY);
}
