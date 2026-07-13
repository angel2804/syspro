// ============================================================================
// Servicio de datos: AUTENTICACIÓN (Supabase Auth) — Fase 4.
//
//  * Trabajador: `signInAnonymously()` (sin contraseña). Un trigger en la BD
//    le crea su fila en `profiles` con rol 'trabajador'. El nombre operativo
//    elegido se guarda en `profiles.trabajador_nombre` para auditoría.
//  * Dueño/admin/encargado: `signInWithPassword(email, password)`.
//
// El perfil (rol + permisos) SIEMPRE se lee de `profiles`, nunca del cliente.
// ============================================================================
import { getSupabase } from "../supabase";
import { PERMISOS_TODOS } from "../config";
import type { Permiso, Rol } from "../types";

export interface Perfil {
  id: string;
  nombre: string;
  rol: Rol;
  permisos: Permiso[];
  activo: boolean;
  auditoriaActiva: boolean;
  trabajadorNombre?: string;
}

type FilaProfile = {
  id: string;
  nombre: string;
  rol: Rol;
  permisos: string[] | null;
  activo: boolean;
  auditoria_activa?: boolean | null;
  trabajador_nombre: string | null;
};

function perfilDeFila(r: FilaProfile): Perfil {
  return {
    id: r.id,
    nombre: r.nombre,
    rol: r.rol,
    // El dueño siempre tiene todos los permisos, sin depender del arreglo.
    permisos: r.rol === "dueno" ? [...PERMISOS_TODOS] : ((r.permisos ?? []) as Permiso[]),
    activo: r.activo,
    auditoriaActiva: r.auditoria_activa ?? true,
    trabajadorNombre: r.trabajador_nombre ?? undefined,
  };
}

// Perfil del usuario autenticado actual (o null si no hay sesión / sin perfil).
export async function cargarPerfil(): Promise<Perfil | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: sesion } = await sb.auth.getSession();
  const uid = sesion.session?.user.id;
  if (!uid) return null;
  const { data, error } = await sb.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error || !data) return null;
  return perfilDeFila(data as FilaProfile);
}

// Login del staff (dueño/admin/encargado) con email + contraseña.
// Devuelve el perfil; lanza si las credenciales son inválidas o el perfil está
// inactivo / no es de staff.
export async function loginConPassword(email: string, password: string): Promise<Perfil> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error("Correo o contraseña incorrectos");
  const perfil = await cargarPerfil();
  if (!perfil) {
    await sb.auth.signOut();
    throw new Error("Tu usuario no tiene un perfil asignado. Contacta al dueño.");
  }
  if (!perfil.activo) {
    await sb.auth.signOut();
    throw new Error("Tu usuario está desactivado.");
  }
  if (perfil.rol === "trabajador") {
    await sb.auth.signOut();
    throw new Error("Este acceso es solo para dueño, administrador o encargado.");
  }
  return perfil;
}

// Login del trabajador con la CUENTA COMPARTIDA (ej. trabajador@grifo.local).
// Una sola identidad de Supabase Auth (rol 'trabajador') para todos los
// trabajadores — NO se crean usuarios por cada nombre. El nombre operativo real
// se elige después (de la lista que administra el dueño/admin) y se guarda en
// `sesiones.trabajador`; aquí solo se valida el acceso a la cuenta técnica.
export async function loginTrabajadorCompartido(
  email: string,
  password: string
): Promise<Perfil> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error("Correo o contraseña incorrectos");
  const perfil = await cargarPerfil();
  if (!perfil) {
    await sb.auth.signOut();
    throw new Error("La cuenta de trabajador no tiene perfil asignado.");
  }
  if (!perfil.activo) {
    await sb.auth.signOut();
    throw new Error("La cuenta de trabajador está desactivada.");
  }
  if (perfil.rol !== "trabajador") {
    await sb.auth.signOut();
    throw new Error("Esta cuenta no es la cuenta compartida de trabajador.");
  }
  return perfil;
}

// Access token de la sesión actual (para enviar a las Server Actions, que
// validan el rol/permiso en el servidor). null si no hay sesión.
export async function getAccessToken(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

// Cabeceras HTTP con el access token de la sesión actual (para las rutas
// /api/* que validan permiso en el servidor). Fusiona cabeceras extra (p. ej.
// Content-Type). Si no hay sesión, va sin Authorization (el servidor responderá
// 403).
export async function authHeaders(
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    ...(extra ?? {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function logoutSupabase(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.auth.signOut();
}

// ¿El perfil tiene un permiso? El dueño siempre; los demás por su arreglo.
export function perfilTienePermiso(perfil: Perfil | null, permiso: Permiso): boolean {
  if (!perfil || !perfil.activo) return false;
  if (perfil.rol === "dueno") return true;
  return perfil.permisos.includes(permiso);
}
