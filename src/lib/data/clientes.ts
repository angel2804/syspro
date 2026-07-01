// Servicio de datos: CLIENTES y ALIAS (cuenta corriente / anti-duplicados).
// Encapsula Supabase. Las páginas/Components NO tocan Supabase directamente.
import { getSupabase } from "../supabase";
import {
  limpiar,
  normalizar,
  planificarFusion,
  resolverCliente,
  type ClienteRef,
  type AliasRef,
} from "../domain/clientes";
import { registrarAuditoria } from "./auditoria";

export interface Cliente {
  id: string;
  nombre: string;
  nombreNormalizado: string;
  documento?: string;
  telefono?: string;
  estado: "activo" | "pendiente" | "fusionado" | "inactivo";
  fusionadoEn?: string;
  creadoPorNombre?: string;
  createdAt: number;
  updatedAt: number;
}

type FilaCliente = {
  id: string;
  nombre: string;
  nombre_normalizado: string;
  documento: string | null;
  telefono: string | null;
  estado: Cliente["estado"];
  fusionado_en: string | null;
  creado_por_nombre: string | null;
  created_at: number;
  updated_at: number;
};

function deFila(r: FilaCliente): Cliente {
  return {
    id: r.id,
    nombre: r.nombre,
    nombreNormalizado: r.nombre_normalizado,
    documento: r.documento ?? undefined,
    telefono: r.telefono ?? undefined,
    estado: r.estado,
    fusionadoEn: r.fusionado_en ?? undefined,
    creadoPorNombre: r.creado_por_nombre ?? undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function aClienteRef(c: Cliente): ClienteRef {
  return { id: c.id, nombre: c.nombre, nombreNormalizado: c.nombreNormalizado, estado: c.estado };
}

export async function fetchClientes(): Promise<Cliente[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("clientes").select("*").order("nombre");
  if (error) throw error;
  return (data ?? []).map((r) => deFila(r as FilaCliente));
}

export async function fetchAlias(): Promise<AliasRef[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("cliente_alias")
    .select("cliente_id, alias, alias_normalizado");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    clienteId: (r as { cliente_id: string }).cliente_id,
    alias: (r as { alias: string }).alias,
    aliasNormalizado: (r as { alias_normalizado: string }).alias_normalizado,
  }));
}

// Crea un cliente. `pendiente`=true cuando lo propone un trabajador y debe
// pasar revisión del admin. Lanza si ya existe uno con el mismo normalizado.
export async function crearCliente(input: {
  nombre: string;
  documento?: string;
  telefono?: string;
  pendiente?: boolean;
  creadoPorNombre?: string;
}): Promise<Cliente> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  const nombre = limpiar(input.nombre);
  const nombre_normalizado = normalizar(nombre);
  const { data, error } = await sb
    .from("clientes")
    .insert({
      nombre,
      nombre_normalizado,
      documento: input.documento ?? null,
      telefono: input.telefono ?? null,
      estado: input.pendiente ? "pendiente" : "activo",
      creado_por_nombre: input.creadoPorNombre ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return deFila(data as FilaCliente);
}

// Resuelve un nombre escrito por el trabajador a un cliente_id. Si ya existe
// (match exacto por nombre normalizado o alias) lo reutiliza; si no, crea el
// cliente como 'pendiente' (queda para que el admin lo revise/fusione). Recibe
// las listas ya cargadas para no consultar Supabase por cada crédito.
export async function resolverOCrearCliente(
  nombre: string,
  clientes: ClienteRef[],
  alias: AliasRef[],
  creadoPorNombre?: string
): Promise<string> {
  const r = resolverCliente(nombre, clientes, alias);
  if (r.tipo === "exacto") return r.cliente.id;
  // "confirmar" (parecido fuerte) o "nuevo": el trabajador propone; se crea
  // como pendiente y el admin decide si fusiona. No se auto-fusiona.
  const creado = await crearCliente({ nombre, pendiente: true, creadoPorNombre });
  return creado.id;
}

export async function agregarAlias(
  clienteId: string,
  alias: string,
  actorNombre?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const a = limpiar(alias);
  const { error } = await sb.from("cliente_alias").upsert(
    { cliente_id: clienteId, alias: a, alias_normalizado: normalizar(a) },
    { onConflict: "alias_normalizado" }
  );
  if (error) throw error;
  await registrarAuditoria({
    accion: "alias_agregado",
    entidad: "clientes",
    entidadId: clienteId,
    actorNombre,
    detalle: { alias: a },
  });
}

// Fusiona `origen` dentro de `destino`: reapunta créditos, pagos y alias,
// convierte el nombre del origen en alias del destino, marca el origen como
// 'fusionado' y deja auditoría. No borra datos históricos.
export async function validarCliente(
  clienteId: string,
  actorNombre?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexiÃ³n a la base de datos");
  const { error } = await sb
    .from("clientes")
    .update({ estado: "activo" })
    .eq("id", clienteId)
    .eq("estado", "pendiente");
  if (error) throw error;
  await registrarAuditoria({
    accion: "alias_agregado",
    entidad: "clientes",
    entidadId: clienteId,
    actorNombre,
    detalle: { validacion: "cliente_pendiente_a_activo" },
  });
}

export async function fusionarClientes(
  origen: Cliente,
  destino: Cliente,
  actorNombre?: string
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  const plan = planificarFusion(aClienteRef(origen), aClienteRef(destino));

  // Reapuntar movimientos (en producción esto idealmente es una RPC/transacción;
  // aquí se hace secuencial y es idempotente porque solo cambia cliente_id).
  let e = await sb.from("creditos").update({ cliente_id: plan.destinoId }).eq("cliente_id", plan.origenId);
  if (e.error) throw e.error;
  e = await sb.from("pagos_credito").update({ cliente_id: plan.destinoId }).eq("cliente_id", plan.origenId);
  if (e.error) throw e.error;
  e = await sb.from("cliente_alias").update({ cliente_id: plan.destinoId }).eq("cliente_id", plan.origenId);
  if (e.error) throw e.error;

  // El nombre del origen pasa a ser alias del destino.
  await agregarAlias(plan.destinoId, plan.nuevoAlias, actorNombre).catch(() => {});

  // Marcar origen como fusionado (no se borra).
  e = await sb
    .from("clientes")
    .update({ estado: "fusionado", fusionado_en: plan.destinoId })
    .eq("id", plan.origenId);
  if (e.error) throw e.error;

  await registrarAuditoria({
    accion: "cliente_fusionado",
    entidad: "clientes",
    entidadId: plan.origenId,
    actorNombre,
    detalle: { origen: origen.nombre, destino: destino.nombre, destinoId: plan.destinoId },
  });
}
