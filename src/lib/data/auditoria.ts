// Servicio de auditoría: registra acciones importantes en `audit_log`.
// Nunca lanza hacia la UI (la auditoría no debe tumbar una operación válida):
// si falla, lo deja en consola.
import { getSupabase } from "../supabase";

export type AccionAudit =
  | "login"
  | "apertura_turno"
  | "cierre_turno"
  | "cambio_precio"
  | "edicion_sesion"
  | "reset"
  | "restauracion_backup"
  | "mover_trabajador"
  | "exportacion"
  | "credito_creado"
  | "credito_corregido"
  | "credito_anulado"
  | "pago_registrado"
  | "pago_corregido"
  | "pago_anulado"
  | "cliente_fusionado"
  | "alias_agregado"
  | "usuario_creado"
  | "usuario_editado"
  | "usuario_password"
  | "dueno_inicial";

export interface RegistroAudit {
  accion: AccionAudit;
  entidad?: string;
  entidadId?: string;
  actorId?: string;
  actorNombre?: string;
  detalle?: Record<string, unknown>;
}

export async function registrarAuditoria(r: RegistroAudit): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb.from("audit_log").insert({
      accion: r.accion,
      entidad: r.entidad ?? null,
      entidad_id: r.entidadId ?? null,
      actor_id: r.actorId ?? null,
      actor_nombre: r.actorNombre ?? null,
      detalle: r.detalle ?? {},
    });
  } catch (e) {
    console.error("auditoría:", e);
  }
}

export interface FilaAudit {
  id: string;
  accion: string;
  entidad: string | null;
  entidadId: string | null;
  actorNombre: string | null;
  detalle: Record<string, unknown>;
  createdAt: number;
}

// Bitácora consultable para el admin (más reciente primero).
export async function fetchAuditoria(opts: {
  accion?: AccionAudit;
  limite?: number;
} = {}): Promise<FilaAudit[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("audit_log")
    .select("id, accion, entidad, entidad_id, actor_nombre, detalle, created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limite ?? 200);
  if (opts.accion) q = q.eq("accion", opts.accion);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: r.id as string,
    accion: r.accion as string,
    entidad: (r.entidad as string | null) ?? null,
    entidadId: (r.entidad_id as string | null) ?? null,
    actorNombre: (r.actor_nombre as string | null) ?? null,
    detalle: (r.detalle as Record<string, unknown>) ?? {},
    createdAt: Number(r.created_at),
  }));
}
