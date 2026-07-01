"use server";

// ============================================================================
// Server Actions: GESTIÓN DE USUARIOS (dueño). Toda validación de permiso ocurre
// AQUÍ, en el servidor, con el service_role — el cliente solo envía su access
// token. Cubre: listar, crear, editar (rol/permisos/nombre/activo), resetear
// contraseña, y el bootstrap del primer dueño (permitido solo si no hay ninguno).
// ============================================================================
import { getAdmin, requireDueno, existeDueno, auditarServidor } from "./supabase-admin";
import type { Permiso, Rol } from "../types";

export interface UsuarioAdmin {
  id: string;
  email: string | null;
  nombre: string;
  rol: Rol;
  permisos: Permiso[];
  activo: boolean;
}

type RolStaff = Extract<Rol, "dueno" | "admin" | "encargado">;
const ROLES_STAFF: RolStaff[] = ["dueno", "admin", "encargado"];

function esRolStaff(r: string): r is RolStaff {
  return (ROLES_STAFF as string[]).includes(r);
}

// Mapa id → email desde auth.users (paginado).
async function mapaEmails(): Promise<Map<string, string | null>> {
  const sb = getAdmin();
  const m = new Map<string, string | null>();
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
    if (error) break;
    for (const u of data.users) m.set(u.id, u.email ?? null);
    if (data.users.length < 200) break;
    page++;
  }
  return m;
}

// Lista los usuarios de staff (dueño/admin/encargado). El trabajador es anónimo
// y no se administra aquí.
export async function listarUsuarios(token: string): Promise<UsuarioAdmin[]> {
  await requireDueno(token);
  const sb = getAdmin();
  const { data, error } = await sb
    .from("profiles")
    .select("id, nombre, rol, permisos, activo")
    .in("rol", ROLES_STAFF)
    .order("rol");
  if (error) throw new Error(error.message);
  const emails = await mapaEmails();
  return (data ?? []).map((p) => ({
    id: p.id as string,
    email: emails.get(p.id as string) ?? null,
    nombre: p.nombre as string,
    rol: p.rol as Rol,
    permisos: ((p.permisos ?? []) as Permiso[]),
    activo: p.activo as boolean,
  }));
}

export interface NuevoUsuario {
  email: string;
  password: string;
  nombre: string;
  rol: RolStaff;
  permisos: Permiso[];
}

export async function crearUsuario(token: string, u: NuevoUsuario): Promise<void> {
  const actor = await requireDueno(token);
  if (!esRolStaff(u.rol)) throw new Error("Rol inválido.");
  if (!u.email.trim() || !u.password || u.password.length < 6) {
    throw new Error("Correo y contraseña (mínimo 6 caracteres) obligatorios.");
  }
  const sb = getAdmin();
  const { data, error } = await sb.auth.admin.createUser({
    email: u.email.trim(),
    password: u.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "No se pudo crear el usuario.");
  const permisos = u.rol === "dueno" ? [] : u.permisos; // el dueño no usa el arreglo
  const { error: perr } = await sb.from("profiles").upsert({
    id: data.user.id,
    nombre: u.nombre.trim() || u.email.trim(),
    rol: u.rol,
    permisos,
    activo: true,
  });
  if (perr) {
    // Rollback del usuario de Auth si el perfil falla, para no dejar huérfanos.
    await sb.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw new Error(perr.message);
  }
  await auditarServidor({
    accion: "usuario_creado",
    entidad: "profiles",
    entidadId: data.user.id,
    actorNombre: actor.nombre,
    detalle: { email: u.email, rol: u.rol },
  });
}

export interface CambiosUsuario {
  nombre?: string;
  rol?: RolStaff;
  permisos?: Permiso[];
  activo?: boolean;
}

export async function actualizarUsuario(
  token: string,
  id: string,
  cambios: CambiosUsuario
): Promise<void> {
  const actor = await requireDueno(token);
  const sb = getAdmin();
  const { data: destino } = await sb
    .from("profiles")
    .select("rol, activo")
    .eq("id", id)
    .maybeSingle();
  if (!destino) throw new Error("Usuario no encontrado.");

  // Anti-lockout: no permitir dejar el sistema sin ningún dueño activo, ni que
  // el dueño se degrade/desactive a sí mismo si es el último.
  const quitaDueno =
    (destino.rol as Rol) === "dueno" &&
    ((cambios.rol && cambios.rol !== "dueno") || cambios.activo === false);
  if (quitaDueno) {
    const { count } = await sb
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("rol", "dueno")
      .eq("activo", true);
    if ((count ?? 0) <= 1) {
      throw new Error("No puedes dejar el sistema sin un dueño activo.");
    }
  }

  const patch: Record<string, unknown> = {};
  if (cambios.nombre !== undefined) patch.nombre = cambios.nombre.trim();
  if (cambios.rol !== undefined) {
    if (!esRolStaff(cambios.rol)) throw new Error("Rol inválido.");
    patch.rol = cambios.rol;
    if (cambios.rol === "dueno") patch.permisos = [];
  }
  if (cambios.permisos !== undefined && cambios.rol !== "dueno") patch.permisos = cambios.permisos;
  if (cambios.activo !== undefined) patch.activo = cambios.activo;
  if (Object.keys(patch).length === 0) return;

  const { error } = await sb.from("profiles").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
  await auditarServidor({
    accion: "usuario_editado",
    entidad: "profiles",
    entidadId: id,
    actorNombre: actor.nombre,
    detalle: patch,
  });
}

export async function resetearPassword(
  token: string,
  id: string,
  nuevaPassword: string
): Promise<void> {
  const actor = await requireDueno(token);
  if (!nuevaPassword || nuevaPassword.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }
  const sb = getAdmin();
  const { error } = await sb.auth.admin.updateUserById(id, { password: nuevaPassword });
  if (error) throw new Error(error.message);
  await auditarServidor({
    accion: "usuario_password",
    entidad: "profiles",
    entidadId: id,
    actorNombre: actor.nombre,
    detalle: {},
  });
}

// Cambia la contraseña de la CUENTA COMPARTIDA de trabajador (buscada por email).
// Solo dueño. No aparece en la lista de usuarios (es rol trabajador).
export async function resetearPasswordTrabajador(
  token: string,
  email: string,
  nuevaPassword: string
): Promise<void> {
  const actor = await requireDueno(token);
  if (!nuevaPassword || nuevaPassword.length < 6) {
    throw new Error("La contraseña debe tener al menos 6 caracteres.");
  }
  const sb = getAdmin();
  const emails = await mapaEmails();
  let id: string | undefined;
  for (const [uid, mail] of emails) {
    if (mail && mail.toLowerCase() === email.trim().toLowerCase()) {
      id = uid;
      break;
    }
  }
  if (!id) throw new Error("No existe una cuenta con ese correo.");
  const { error } = await sb.auth.admin.updateUserById(id, { password: nuevaPassword });
  if (error) throw new Error(error.message);
  await auditarServidor({
    accion: "usuario_password",
    entidad: "profiles",
    entidadId: id,
    actorNombre: actor.nombre,
    detalle: { cuenta: "trabajador" },
  });
}

export interface DuenoInicial {
  email: string;
  password: string;
  nombre: string;
}

// Bootstrap del PRIMER dueño. Permitido SOLO si aún no hay ningún dueño activo
// (una vez creado, queda bloqueado). Anti-lockout de arranque.
export async function crearDuenoInicial(d: DuenoInicial): Promise<void> {
  if (await existeDueno()) {
    throw new Error("Ya existe un dueño. Pide acceso al dueño actual.");
  }
  if (!d.email.trim() || !d.password || d.password.length < 6) {
    throw new Error("Correo y contraseña (mínimo 6 caracteres) obligatorios.");
  }
  const sb = getAdmin();
  const { data, error } = await sb.auth.admin.createUser({
    email: d.email.trim(),
    password: d.password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(error?.message ?? "No se pudo crear el dueño.");
  const { error: perr } = await sb.from("profiles").upsert({
    id: data.user.id,
    nombre: d.nombre.trim() || "Dueño",
    rol: "dueno",
    permisos: [],
    activo: true,
  });
  if (perr) {
    await sb.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw new Error(perr.message);
  }
  await auditarServidor({
    accion: "dueno_inicial",
    entidad: "profiles",
    entidadId: data.user.id,
    actorNombre: d.nombre,
    detalle: { email: d.email },
  });
}
