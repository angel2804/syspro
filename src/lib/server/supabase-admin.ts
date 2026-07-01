// ============================================================================
// Cliente Supabase de SERVIDOR (service_role). SOLO se importa desde Server
// Actions / route handlers — NUNCA desde código cliente (la key es secreta).
//
// Se usa para operaciones administrativas (crear usuarios de Auth, escribir
// perfiles con rol/permisos) y para VALIDAR EN SERVIDOR el rol del que llama,
// verificando su access token contra Supabase. Así la validación de permisos
// no depende del cliente (requisito de la Fase 4).
// ============================================================================
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Perfil } from "../data/auth";
import type { Permiso, Rol } from "../types";
import { PERMISOS_TODOS } from "../config";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let admin: SupabaseClient | null = null;

export function getAdmin(): SupabaseClient {
  if (admin) return admin;
  if (!url || !serviceKey) {
    throw new Error(
      "Falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL en el servidor."
    );
  }
  admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

type FilaProfile = {
  id: string;
  nombre: string;
  rol: Rol;
  permisos: string[] | null;
  activo: boolean;
  trabajador_nombre: string | null;
};

function perfilDeFila(r: FilaProfile): Perfil {
  return {
    id: r.id,
    nombre: r.nombre,
    rol: r.rol,
    permisos: r.rol === "dueno" ? [...PERMISOS_TODOS] : ((r.permisos ?? []) as Permiso[]),
    activo: r.activo,
    trabajadorNombre: r.trabajador_nombre ?? undefined,
  };
}

// Resuelve el perfil del usuario dueño de un access token (o null si inválido).
export async function perfilDeToken(token: string): Promise<Perfil | null> {
  if (!token) return null;
  const sb = getAdmin();
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: prof } = await sb
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (!prof) return null;
  return perfilDeFila(prof as FilaProfile);
}

// Exige que el llamador sea DUEÑO activo. Lanza si no. Devuelve su perfil.
export async function requireDueno(token: string): Promise<Perfil> {
  const perfil = await perfilDeToken(token);
  if (!perfil || !perfil.activo) throw new Error("Sesión inválida. Vuelve a iniciar sesión.");
  if (perfil.rol !== "dueno") throw new Error("Solo el dueño puede gestionar usuarios.");
  return perfil;
}

// Exige llamador con un permiso concreto (dueño siempre pasa). Devuelve perfil.
export async function requirePermiso(token: string, permiso: Permiso): Promise<Perfil> {
  const perfil = await perfilDeToken(token);
  if (!perfil || !perfil.activo) throw new Error("Sesión inválida. Vuelve a iniciar sesión.");
  if (perfil.rol !== "dueno" && !perfil.permisos.includes(permiso)) {
    throw new Error("No tienes permiso para esta acción.");
  }
  return perfil;
}

// Auditoría desde el servidor (usa el cliente admin, no el de navegador).
export async function auditarServidor(r: {
  accion: string;
  entidad?: string;
  entidadId?: string;
  actorId?: string;
  actorNombre?: string;
  detalle?: Record<string, unknown>;
}): Promise<void> {
  try {
    await getAdmin().from("audit_log").insert({
      accion: r.accion,
      entidad: r.entidad ?? null,
      entidad_id: r.entidadId ?? null,
      actor_id: r.actorId ?? null,
      actor_nombre: r.actorNombre ?? null,
      detalle: r.detalle ?? {},
    });
  } catch (e) {
    console.error("auditoría servidor:", e);
  }
}

// ¿Existe ya un dueño activo? (para el bootstrap del primer dueño).
export async function existeDueno(): Promise<boolean> {
  const sb = getAdmin();
  const { count } = await sb
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("rol", "dueno")
    .eq("activo", true);
  return (count ?? 0) > 0;
}
