// Servicio de PRECIOS con historial (Fase 5). La config `precios` guarda el
// precio VIGENTE (lectura rápida + realtime, ver db.ts); esta tabla
// `precio_eventos` registra CADA cambio con quién / cuándo / por qué, para
// auditoría, historial y para avisar en vivo al trabajador.
//
// Convención `aplica`:
//   'proximo' → el cambio rige desde el próximo turno que se abra.
//   'activo'  → el admin quiere que rija ya; los turnos abiertos NO se
//               recalculan (conservan su precio congelado), solo se avisa al
//               trabajador con un banner. La distinción queda en el historial.
import { getSupabase } from "../supabase";
import type { PrecioKey } from "../types";

export interface PrecioEvento {
  id: string;
  producto: PrecioKey;
  precioAnterior: number | null;
  precioNuevo: number;
  aplica: "proximo" | "activo";
  motivo: string | null;
  cambiadoPorNombre: string | null;
  createdAt: number;
}

interface FilaPrecioEvento {
  id: string;
  producto: string;
  precio_anterior: number | null;
  precio_nuevo: number;
  aplica: string;
  motivo: string | null;
  cambiado_por: string | null;
  cambiado_por_nombre: string | null;
  created_at: number;
}

function eventoDeFila(r: FilaPrecioEvento): PrecioEvento {
  return {
    id: r.id,
    producto: r.producto as PrecioKey,
    precioAnterior: r.precio_anterior != null ? Number(r.precio_anterior) : null,
    precioNuevo: Number(r.precio_nuevo),
    aplica: r.aplica === "activo" ? "activo" : "proximo",
    motivo: r.motivo ?? null,
    cambiadoPorNombre: r.cambiado_por_nombre ?? null,
    createdAt: Number(r.created_at),
  };
}

export interface CambioPrecio {
  producto: PrecioKey;
  precioAnterior: number | null;
  precioNuevo: number;
  aplica: "proximo" | "activo";
  motivo?: string;
  actorId?: string;
  actorNombre?: string;
}

// Registra un cambio de precio en el historial. No lanza a la UI: si falla, lo
// deja en consola (el precio vigente ya se guardó aparte en config/precios).
export async function registrarCambioPrecio(c: CambioPrecio): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("precio_eventos").insert({
      producto: c.producto,
      precio_anterior: c.precioAnterior,
      precio_nuevo: c.precioNuevo,
      aplica: c.aplica,
      motivo: c.motivo?.trim() || null,
      cambiado_por: c.actorId ?? null,
      cambiado_por_nombre: c.actorNombre ?? null,
    });
    if (error) throw error;
  } catch (e) {
    console.error("registrarCambioPrecio:", e);
  }
}

// Historial de cambios (más reciente primero) para la UI del admin.
export async function fetchHistorialPrecios(opts: {
  producto?: PrecioKey;
  limite?: number;
} = {}): Promise<PrecioEvento[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("precio_eventos")
    .select(
      "id, producto, precio_anterior, precio_nuevo, aplica, motivo, cambiado_por, cambiado_por_nombre, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(opts.limite ?? 200);
  if (opts.producto) q = q.eq("producto", opts.producto);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => eventoDeFila(r as FilaPrecioEvento));
}

// Suscripción en vivo a los NUEVOS eventos de precio. Llama a `onNuevo` con
// cada inserción. La usa el dashboard del trabajador para mostrar el banner de
// cambio de precio en tiempo real. Devuelve una función para desuscribir.
export function subscribeNuevosPrecios(
  onNuevo: (evento: PrecioEvento) => void
): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};
  const channel = sb
    .channel(`precio-eventos-${crypto.randomUUID()}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "precio_eventos" },
      (payload) => {
        const fila = payload.new as FilaPrecioEvento | null;
        if (fila) onNuevo(eventoDeFila(fila));
      }
    )
    .subscribe();
  return () => sb.removeChannel(channel);
}
