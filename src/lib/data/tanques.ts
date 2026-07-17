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

export interface TanqueCapacidad {
  producto: ProductoId;
  capacidadMax: number;
  updatedAt: number;
}

export interface TanqueRecarga {
  id: string;
  producto: ProductoId;
  galones: number;
  fechaRecarga: string; // YYYY-MM-DD
  proveedor: string | null;
  comprobante: string | null;
  registradoPor: string | null;
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

interface FilaTanqueCapacidad {
  producto: string;
  capacidad_max: number;
  updated_at: number;
}

interface FilaTanqueRecarga {
  id: string;
  producto: string;
  galones: number;
  fecha_recarga: string;
  proveedor: string | null;
  comprobante: string | null;
  registrado_por: string | null;
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

function capacidadDeFila(r: FilaTanqueCapacidad): TanqueCapacidad {
  return {
    producto: r.producto as ProductoId,
    capacidadMax: Number(r.capacidad_max),
    updatedAt: Number(r.updated_at),
  };
}

function recargaDeFila(r: FilaTanqueRecarga): TanqueRecarga {
  return {
    id: r.id,
    producto: r.producto as ProductoId,
    galones: Number(r.galones),
    fechaRecarga: r.fecha_recarga,
    proveedor: r.proveedor ?? null,
    comprobante: r.comprobante ?? null,
    registradoPor: r.registrado_por ?? null,
    createdAt: Number(r.created_at),
  };
}

export interface NuevoRegistroTanque {
  producto: ProductoId;
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
    capacidad_max: 1,
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
  const capacidades = await fetchCapacidadesTanques().catch(() => []);
  // Un solo registro (el más reciente) por producto.
  const porProducto = new Map<ProductoId, TanqueRegistro>();
  for (const f of filas) if (!porProducto.has(f.producto)) porProducto.set(f.producto, f);
  return Array.from(porProducto.values()).map((r) => ({
    ...r,
    capacidadMax:
      capacidades.find((c) => c.producto === r.producto)?.capacidadMax ?? r.capacidadMax,
  }));
}

// Historial completo (más reciente primero), opcionalmente filtrado.
export async function fetchHistorialTanques(opts: {
  producto?: ProductoId;
  desde?: string;
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
  if (opts.desde) q = q.gte("fecha_medicion", opts.desde);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => registroDeFila(r as FilaTanqueRegistro));
}

export async function fetchCapacidadesTanques(): Promise<TanqueCapacidad[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("tanque_capacidades")
    .select("producto, capacidad_max, updated_at");
  if (error) throw error;
  return (data ?? []).map((r) => capacidadDeFila(r as FilaTanqueCapacidad));
}

export async function guardarCapacidadTanque(
  producto: ProductoId,
  capacidadMax: number
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  if (!(capacidadMax > 0)) throw new Error("La capacidad maxima debe ser mayor a 0");
  const { error } = await sb.from("tanque_capacidades").upsert(
    {
      producto,
      capacidad_max: capacidadMax,
      updated_at: Date.now(),
    },
    { onConflict: "producto" }
  );
  if (error) throw error;
}

export interface NuevaRecargaTanque {
  producto: ProductoId;
  galones: number;
  fechaRecarga: string;
  proveedor?: string;
  comprobante?: string;
  registradoPor?: string;
}

export async function registrarRecargaTanque(r: NuevaRecargaTanque): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  if (!(r.galones > 0)) throw new Error("Los galones de recarga deben ser mayores a 0");
  const { error } = await sb.from("tanque_recargas").insert({
    producto: r.producto,
    galones: r.galones,
    fecha_recarga: r.fechaRecarga,
    proveedor: r.proveedor?.trim() || null,
    comprobante: r.comprobante?.trim() || null,
    registrado_por: r.registradoPor?.trim() || null,
  });
  if (error) throw error;
}

export async function fetchRecargasTanques(opts: {
  producto?: ProductoId;
  desde?: string;
  limite?: number;
} = {}): Promise<TanqueRecarga[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("tanque_recargas")
    .select("id, producto, galones, fecha_recarga, proveedor, comprobante, registrado_por, created_at")
    .order("fecha_recarga", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(opts.limite ?? 100);
  if (opts.producto) q = q.eq("producto", opts.producto);
  if (opts.desde) q = q.gte("fecha_recarga", opts.desde);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => recargaDeFila(r as FilaTanqueRecarga));
}
