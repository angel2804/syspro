// Servicio de datos: CRÉDITOS y PAGOS de crédito (cuenta corriente).
// Encapsula Supabase y delega el cálculo de deuda/estado de cuenta al dominio
// puro (src/lib/domain/cuenta-corriente).
import { getSupabase } from "../supabase";
import {
  construirEstadoCuenta,
  redondear,
  resumenCliente,
  type CreditoCC,
  type FilaEstadoCuenta,
  type PagoCC,
  type ResumenCliente,
} from "../domain/cuenta-corriente";
import type { Precios, ProductoId, Sesion } from "../types";
import { preciosDe } from "../calc";
import { PRECIOS_DEFAULT } from "../config";
import { normalizar } from "../domain/clientes";
import { registrarAuditoria } from "./auditoria";
import { aClienteRef, fetchAlias, fetchClientes, resolverOCrearCliente } from "./clientes";

// ----- Mapeos fila <-> dominio ---------------------------------------------

type FilaCredito = {
  id: string;
  cliente_id: string;
  sesion_id: string | null;
  dia_operativo: string | null;
  fecha: number;
  turno: string | null;
  isla_id: string | null;
  trabajador_nombre: string | null;
  producto: string;
  galones: number;
  vale: string;
  factura: string | null;
  precio_unitario: number;
  total: number;
  estado: CreditoCC["estado"];
  reemplaza_a: string | null;
  motivo: string | null;
  created_at: number;
  updated_at: number;
};

function creditoDeFila(r: FilaCredito): CreditoCC {
  return {
    id: r.id,
    clienteId: r.cliente_id,
    sesionId: r.sesion_id ?? undefined,
    diaOperativo: r.dia_operativo ?? undefined,
    fecha: Number(r.fecha),
    turno: r.turno ?? undefined,
    islaId: r.isla_id ?? undefined,
    trabajadorNombre: r.trabajador_nombre ?? undefined,
    producto: r.producto as ProductoId,
    galones: Number(r.galones),
    vale: r.vale,
    factura: r.factura ?? undefined,
    precioUnitario: Number(r.precio_unitario),
    total: Number(r.total),
    estado: r.estado,
    reemplazaA: r.reemplaza_a ?? undefined,
    motivo: r.motivo ?? undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

type FilaPago = {
  id: string;
  cliente_id: string;
  fecha: number;
  monto: number;
  metodo_pago: string | null;
  referencia: string | null;
  observacion: string | null;
  registrado_por_nombre: string | null;
  estado: PagoCC["estado"];
  reemplaza_a: string | null;
  created_at: number;
  updated_at: number;
};

function pagoDeFila(r: FilaPago): PagoCC {
  return {
    id: r.id,
    clienteId: r.cliente_id,
    fecha: Number(r.fecha),
    monto: Number(r.monto),
    metodoPago: r.metodo_pago ?? undefined,
    referencia: r.referencia ?? undefined,
    observacion: r.observacion ?? undefined,
    registradoPorNombre: r.registrado_por_nombre ?? undefined,
    estado: r.estado,
    reemplazaA: r.reemplaza_a ?? undefined,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

// ----- Lecturas -------------------------------------------------------------

export async function fetchCreditos(clienteId?: string): Promise<CreditoCC[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("creditos").select("*").order("fecha");
  if (clienteId) q = q.eq("cliente_id", clienteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => creditoDeFila(r as FilaCredito));
}

export async function fetchPagos(clienteId?: string): Promise<PagoCC[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb.from("pagos_credito").select("*").order("fecha");
  if (clienteId) q = q.eq("cliente_id", clienteId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => pagoDeFila(r as FilaPago));
}

export interface EstadoCuentaCliente {
  resumen: ResumenCliente;
  filas: FilaEstadoCuenta[];
  creditos: CreditoCC[];
  pagos: PagoCC[];
}

// Estado de cuenta completo de un cliente (resumen + filas cronológicas).
export async function estadoCuentaCliente(clienteId: string): Promise<EstadoCuentaCliente> {
  const [creditos, pagos] = await Promise.all([fetchCreditos(clienteId), fetchPagos(clienteId)]);
  return {
    resumen: resumenCliente(creditos, pagos),
    filas: construirEstadoCuenta(creditos, pagos),
    creditos,
    pagos,
  };
}

export interface SaldoCliente {
  clienteId: string;
  nombre: string;
  totalCreditos: number;
  totalPagos: number;
  deudaPendiente: number;
}

// Saldos de todos los clientes desde la vista `cliente_saldos` (eficiente para
// el listado: deuda = créditos activos - pagos activos, calculada en Postgres).
export async function fetchSaldos(): Promise<SaldoCliente[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.from("cliente_saldos").select("*");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    clienteId: (r as { cliente_id: string }).cliente_id,
    nombre: (r as { nombre: string }).nombre,
    totalCreditos: Number((r as { total_creditos: number }).total_creditos) || 0,
    totalPagos: Number((r as { total_pagos: number }).total_pagos) || 0,
    deudaPendiente: Number((r as { deuda_pendiente: number }).deuda_pendiente) || 0,
  }));
}

// ----- Escrituras (con auditoría) ------------------------------------------

export interface NuevoCredito {
  clienteId: string;
  sesionId?: string;
  diaOperativo?: string;
  turno?: string;
  islaId?: string;
  trabajadorNombre?: string;
  producto: ProductoId;
  galones: number;
  vale: string;
  factura?: string;
  precioUnitario: number; // precio efectivo del turno (CONGELADO)
}

export async function crearCredito(c: NuevoCredito): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  if (!c.vale?.trim()) throw new Error("El vale es obligatorio");
  if (!(c.galones > 0)) throw new Error("Los galones deben ser mayores a 0");
  const total = redondear(c.galones * c.precioUnitario);
  const { error } = await sb.from("creditos").insert({
    cliente_id: c.clienteId,
    sesion_id: c.sesionId ?? null,
    dia_operativo: c.diaOperativo ?? null,
    fecha: Date.now(),
    turno: c.turno ?? null,
    isla_id: c.islaId ?? null,
    trabajador_nombre: c.trabajadorNombre ?? null,
    producto: c.producto,
    galones: c.galones,
    vale: c.vale.trim(),
    factura: c.factura ?? null,
    precio_unitario: c.precioUnitario,
    total,
    estado: "activo",
  });
  if (error) throw error;
  await registrarAuditoria({
    accion: "credito_creado",
    entidad: "creditos",
    entidadId: c.clienteId,
    actorNombre: c.trabajadorNombre,
    detalle: { vale: c.vale, producto: c.producto, galones: c.galones, total },
  });
}

// Anula un crédito (estado='anulado'); deja auditoría. No se borra.
export async function anularCredito(id: string, actorNombre?: string, motivo?: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  const { error } = await sb.from("creditos").update({ estado: "anulado", motivo: motivo ?? null }).eq("id", id);
  if (error) throw error;
  await registrarAuditoria({ accion: "credito_anulado", entidad: "creditos", entidadId: id, actorNombre, detalle: { motivo } });
}

export interface NuevoPago {
  clienteId: string;
  monto: number;
  metodoPago?: string;
  referencia?: string;
  observacion?: string;
  registradoPorNombre?: string;
}

// Registra un pago contra el SALDO del cliente (no contra un vale). Solo admin.
export async function registrarPago(p: NuevoPago): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  if (!(p.monto > 0)) throw new Error("El monto debe ser mayor a 0");
  const { error } = await sb.from("pagos_credito").insert({
    cliente_id: p.clienteId,
    fecha: Date.now(),
    monto: p.monto,
    metodo_pago: p.metodoPago ?? null,
    referencia: p.referencia ?? null,
    observacion: p.observacion ?? null,
    registrado_por_nombre: p.registradoPorNombre ?? null,
    estado: "activo",
  });
  if (error) throw error;
  await registrarAuditoria({
    accion: "pago_registrado",
    entidad: "pagos_credito",
    entidadId: p.clienteId,
    actorNombre: p.registradoPorNombre,
    detalle: { monto: p.monto, metodo: p.metodoPago },
  });
}

export async function anularPago(id: string, actorNombre?: string, motivo?: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error("Sin conexión a la base de datos");
  const { error } = await sb.from("pagos_credito").update({ estado: "anulado" }).eq("id", id);
  if (error) throw error;
  await registrarAuditoria({ accion: "pago_anulado", entidad: "pagos_credito", entidadId: id, actorNombre, detalle: { motivo } });
}

// ----- Sincronización turno → cuenta corriente -----------------------------
// Vuelca los créditos de una sesión (los que el trabajador registró en su
// turno) a la cuenta corriente por cliente, de forma IDEMPOTENTE. Se llama al
// CERRAR el turno (cuando los créditos ya son definitivos) y también puede
// reusarse tras una corrección del admin sobre una sesión cerrada.
//
//  * El precio queda CONGELADO con el precio del turno (snapshot de la sesión).
//  * El cliente se resuelve con anti-duplicados; si es nuevo, se crea como
//    'pendiente' para que el admin lo revise/fusione.
//  * `origen_id` = "${sesion.id}:${credito.id}" evita duplicar al reejecutar.
//  * Los créditos del ledger de esta sesión que ya no existan (el admin los
//    quitó en una corrección) se marcan 'anulado'.
//
// NO toca el cuadre del turno (ese sigue leyendo sesion.creditos): este vuelco
// solo alimenta la deuda por cliente, evitando doble conteo.
export async function sincronizarCreditosSesion(s: Sesion): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const lista = (s.creditos ?? []).filter((c) => (c.cliente ?? "").trim() && (c.vale ?? "").trim());

  const [clientes, alias] = await Promise.all([fetchClientes(), fetchAlias()]);
  const refs = clientes.map(aClienteRef);
  const precios: Precios = preciosDe(s, PRECIOS_DEFAULT);
  const fecha = s.closedAt ?? s.updatedAt ?? Date.now();
  const presentes = new Set<string>();
  let n = 0;

  for (const c of lista) {
    const origenId = `${s.id}:${c.id}`;
    presentes.add(origenId);
    const clienteId = await resolverOCrearCliente(c.cliente, refs, alias, s.trabajador);
    // Registrar el cliente recién creado en `refs` para que otro crédito del
    // mismo nombre en este turno lo reutilice en vez de crear otro.
    if (!refs.some((r) => r.id === clienteId)) {
      refs.push({
        id: clienteId,
        nombre: c.cliente,
        nombreNormalizado: normalizar(c.cliente),
        estado: "pendiente",
      });
    }
    const precioUnitario = precios[c.producto] ?? 0;
    const total = redondear(c.galones * precioUnitario);
    const { error } = await sb.from("creditos").upsert(
      {
        origen_id: origenId,
        cliente_id: clienteId,
        sesion_id: s.id,
        dia_operativo: s.diaOperativo,
        fecha,
        turno: s.turno,
        isla_id: s.islaId,
        trabajador_nombre: s.trabajador,
        producto: c.producto,
        galones: c.galones,
        vale: c.vale,
        factura: c.factura ?? null,
        precio_unitario: precioUnitario,
        total,
        estado: "activo",
      },
      { onConflict: "origen_id" }
    );
    if (error) throw error;
    n++;
  }

  // Anular en el ledger lo que ya no esté en la sesión (correcciones del admin).
  const { data: existentes } = await sb
    .from("creditos")
    .select("id, origen_id")
    .eq("sesion_id", s.id)
    .not("origen_id", "is", null);
  for (const row of (existentes ?? []) as { id: string; origen_id: string }[]) {
    if (row.origen_id && !presentes.has(row.origen_id)) {
      await sb.from("creditos").update({ estado: "anulado" }).eq("id", row.id);
    }
  }
  return n;
}
