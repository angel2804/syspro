// Servicio de "Inventario de Tanques" (SOLO REFERENCIA VISUAL). Guarda el
// nivel real que el medidor registra semanalmente por producto, en una tabla
// aislada (`tanque_registros`) que no participa en ningún cálculo de ventas
// ni cierre de turno.
import { getSupabase } from "../supabase";
import type { ProductoId } from "../types";

export interface TanqueRegistro {
  id: string;
  producto: ProductoId;
  capacidadMax: number;
  nivelMedido: number;
  fechaMedicion: string; // YYYY-MM-DD
  medidoPor: string | null;
  createdAt: number;
}

interface FilaTanqueRegistro {
  id: string;
  producto: string;
  capacidad_max: number;
  nivel_medido: number;
  fecha_medicion: string;
  medido_por: string | null;
  created_at: number;
}

function registroDeFila(r: FilaTanqueRegistro): TanqueRegistro {
  return {
    id: r.id,
    producto: r.producto as ProductoId,
    capacidadMax: Number(r.capacidad_max),
    nivelMedido: Number(r.nivel_medido),
    fechaMedicion: r.fecha_medicion,
    medidoPor: r.medido_por ?? null,
    createdAt: Number(r.created_at),
  };
}

export interface NuevoRegistroTanque {
  producto: ProductoId;
  capacidadMax: number;
  nivelMedido: number;
  fechaMedicion: string;
  medidoPor?: string;
}

// Guarda el registro semanal (una fila nueva por medición; el historial queda
// completo). No lanza a la UI: si falla, lo deja en consola.
export async function registrarNivelTanque(r: NuevoRegistroTanque): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb.from("tanque_registros").insert({
    producto: r.producto,
    capacidad_max: r.capacidadMax,
    nivel_medido: r.nivelMedido,
    fecha_medicion: r.fechaMedicion,
    medido_por: r.medidoPor?.trim() || null,
  });
  if (error) throw error;
}

// Último registro por producto (para pintar los tanques y el formulario).
export async function fetchUltimosRegistrosTanques(): Promise<TanqueRegistro[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("tanque_registros")
    .select("id, producto, capacidad_max, nivel_medido, fecha_medicion, medido_por, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  const filas = (data ?? []).map((r) => registroDeFila(r as FilaTanqueRegistro));
  // Un solo registro (el más reciente) por producto.
  const porProducto = new Map<ProductoId, TanqueRegistro>();
  for (const f of filas) if (!porProducto.has(f.producto)) porProducto.set(f.producto, f);
  return Array.from(porProducto.values());
}

// Historial completo (más reciente primero), opcionalmente filtrado.
export async function fetchHistorialTanques(opts: {
  producto?: ProductoId;
  limite?: number;
} = {}): Promise<TanqueRegistro[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("tanque_registros")
    .select("id, producto, capacidad_max, nivel_medido, fecha_medicion, medido_por, created_at")
    .order("created_at", { ascending: false })
    .limit(opts.limite ?? 100);
  if (opts.producto) q = q.eq("producto", opts.producto);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => registroDeFila(r as FilaTanqueRegistro));
}
