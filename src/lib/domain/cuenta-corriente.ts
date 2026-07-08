// ============================================================================
// Dominio puro: CUENTA CORRIENTE por cliente.
//
// Reglas (del requerimiento):
//   * Un CRÉDITO (vale registrado por el trabajador) AUMENTA la deuda.
//   * Un PAGO (registrado por el admin) DISMINUYE la deuda total del cliente.
//     Los pagos NO se asignan a un vale: van contra el saldo general.
//   * deudaPendiente = totalCreditosActivos - totalPagosActivos
//   * Estado de cuenta = créditos y pagos ordenados cronológicamente; cada
//     fila recalcula el saldo acumulado.
//   * Solo cuentan los movimientos en estado "activo" (no anulado/corregido).
//
// Este módulo es PURO: no toca Supabase ni React. Se testea con calc/test.
// ============================================================================

import type { MetodoPago, ProductoId } from "../types";

export type EstadoMovimiento = "activo" | "anulado" | "corregido";

// Crédito de cuenta corriente. El precio queda CONGELADO con el precio
// efectivo del turno donde se registró (precioUnitario), para evitar
// descuadres si el admin cambia el precio después.
export interface CreditoCC {
  id: string;
  clienteId: string;
  sesionId?: string;
  diaOperativo?: string;
  fecha: number; // ms epoch — OBLIGATORIO
  turno?: string;
  islaId?: string;
  trabajadorId?: string;
  trabajadorNombre?: string;
  producto: ProductoId;
  galones: number;
  vale: string; // OBLIGATORIO
  factura?: string;
  precioUnitario: number; // congelado del turno (precio normal del grifo)
  // Precio con descuento aplicado en la cuenta corriente (no afecta el turno):
  //   precioAjustado → sobrescribe este vale puntual (el "lápiz").
  //   precioClienteFijo → precio fijo del cliente para todos sus créditos.
  // Precio efectivo = precioAjustado ?? precioClienteFijo ?? precioUnitario.
  precioAjustado?: number;
  precioClienteFijo?: number;
  total: number; // galones * precioUnitario (original, referencial)
  estado: EstadoMovimiento;
  reemplazaA?: string;
  motivo?: string;
  creadoPor?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PagoCC {
  id: string;
  clienteId: string;
  fecha: number; // ms epoch — OBLIGATORIO
  monto: number;
  metodoPago?: MetodoPago | "efectivo" | string;
  referencia?: string;
  observacion?: string;
  registradoPor?: string;
  registradoPorNombre?: string;
  estado: EstadoMovimiento;
  reemplazaA?: string;
  createdAt: number;
  updatedAt: number;
}

export type EstadoCliente = "sin-deuda" | "con-deuda" | "saldo-favor";

export interface ResumenCliente {
  totalCreditos: number;
  totalPagos: number;
  deudaPendiente: number; // positivo = debe; negativo = saldo a favor
  estado: EstadoCliente;
}

// Una fila del estado de cuenta. Es crédito O pago. Las columnas del crédito
// quedan vacías (undefined) en una fila de pago, y viceversa, replicando el
// formato obligatorio del requerimiento.
export interface FilaEstadoCuenta {
  tipo: "credito" | "pago";
  movimientoId: string;
  // Cliente dueño del movimiento. En un estado de cuenta de GRUPO cada fila
  // puede pertenecer a un sub-cliente distinto (para etiquetar la exportación).
  clienteId?: string;
  fecha: number;
  // Columnas de crédito (vacías en filas de pago):
  galones?: number;
  producto?: ProductoId;
  vale?: string;
  precio?: number;
  totalCredito?: number;
  // Columna de pago (vacía en filas de crédito):
  pago?: number;
  // Saldo acumulado FIRMADO: negativo = deuda, positivo = saldo a favor.
  // Se muestra tal cual en la columna "Deuda pendiente" (p. ej. -192.00).
  saldoAcumulado: number;
}

const EPSILON = 0.005; // tolerancia de centavo para comparar contra cero

function esActivo<T extends { estado: EstadoMovimiento }>(m: T): boolean {
  return m.estado === "activo";
}

// Orden cronológico estable: por fecha y, a igualdad, por createdAt; si aún
// empatan, por id (determinístico para tests y exportaciones).
function ordenCronologico(
  a: { fecha: number; createdAt: number; id: string },
  b: { fecha: number; createdAt: number; id: string }
): number {
  return a.fecha - b.fecha || a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1);
}

// Precio efectivo del crédito: descuento por vale, si no el precio fijo del
// cliente, si no el precio congelado del turno.
export function precioEfectivoCredito(c: CreditoCC): number {
  return c.precioAjustado ?? c.precioClienteFijo ?? c.precioUnitario;
}

// Total de un crédito, SIEMPRE al precio efectivo (con descuento). Si no hay
// descuento y viene `total` guardado, se respeta; si no, galones * precio.
export function totalCredito(c: CreditoCC): number {
  const conDescuento = c.precioAjustado ?? c.precioClienteFijo;
  if (conDescuento != null) return redondear(c.galones * conDescuento);
  if (Number.isFinite(c.total)) return c.total;
  return c.galones * c.precioUnitario;
}

export function clasificarEstado(deudaPendiente: number): EstadoCliente {
  if (deudaPendiente > EPSILON) return "con-deuda";
  if (deudaPendiente < -EPSILON) return "saldo-favor";
  return "sin-deuda";
}

// Resumen del cliente: totales y deuda. Solo movimientos activos.
export function resumenCliente(
  creditos: CreditoCC[],
  pagos: PagoCC[]
): ResumenCliente {
  const totalCreditos = creditos
    .filter(esActivo)
    .reduce((a, c) => a + totalCredito(c), 0);
  const totalPagos = pagos.filter(esActivo).reduce((a, p) => a + p.monto, 0);
  const deudaPendiente = redondear(totalCreditos - totalPagos);
  return {
    totalCreditos: redondear(totalCreditos),
    totalPagos: redondear(totalPagos),
    deudaPendiente,
    estado: clasificarEstado(deudaPendiente),
  };
}

// Estado de cuenta: créditos + pagos activos en orden cronológico, cada fila
// con su saldo acumulado FIRMADO (negativo = deuda), tal como exige el
// formato obligatorio del requerimiento.
export function construirEstadoCuenta(
  creditos: CreditoCC[],
  pagos: PagoCC[]
): FilaEstadoCuenta[] {
  type Mov =
    | { kind: "credito"; mov: CreditoCC; fecha: number; createdAt: number; id: string }
    | { kind: "pago"; mov: PagoCC; fecha: number; createdAt: number; id: string };

  const movs: Mov[] = [
    ...creditos.filter(esActivo).map((c) => ({
      kind: "credito" as const,
      mov: c,
      fecha: c.fecha,
      createdAt: c.createdAt,
      id: c.id,
    })),
    ...pagos.filter(esActivo).map((p) => ({
      kind: "pago" as const,
      mov: p,
      fecha: p.fecha,
      createdAt: p.createdAt,
      id: p.id,
    })),
  ].sort(ordenCronologico);

  let saldo = 0; // firmado: cada crédito resta, cada pago suma
  const filas: FilaEstadoCuenta[] = [];
  for (const m of movs) {
    if (m.kind === "credito") {
      const t = totalCredito(m.mov);
      saldo = redondear(saldo - t);
      filas.push({
        tipo: "credito",
        movimientoId: m.mov.id,
        clienteId: m.mov.clienteId,
        fecha: m.mov.fecha,
        galones: m.mov.galones,
        producto: m.mov.producto,
        vale: m.mov.vale,
        precio: precioEfectivoCredito(m.mov),
        totalCredito: redondear(t),
        saldoAcumulado: saldo,
      });
    } else {
      saldo = redondear(saldo + m.mov.monto);
      filas.push({
        tipo: "pago",
        movimientoId: m.mov.id,
        clienteId: m.mov.clienteId,
        fecha: m.mov.fecha,
        pago: m.mov.monto,
        saldoAcumulado: saldo,
      });
    }
  }
  return filas;
}

// Redondeo a 2 decimales evitando errores de coma flotante (0.1+0.2…).
export function redondear(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Formato de saldo para la columna "Deuda pendiente": deuda en negativo.
// p. ej. saldoAcumulado -192 → "-192.00"; 0 → "0.00"; 50 (a favor) → "50.00".
export function formatoSaldo(saldoAcumulado: number): string {
  const v = redondear(saldoAcumulado);
  // Evita "-0.00"
  return (Object.is(v, -0) ? 0 : v).toFixed(2);
}

function fechaCorta(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Estado de cuenta de un cliente a CSV, en el MISMO formato de la tabla
// (Fecha + columnas obligatorias). La fecha sí aparece en la exportación.
export function construirCSVEstadoCuenta(
  nombreCliente: string,
  filas: FilaEstadoCuenta[],
  resumen: ResumenCliente
): string {
  const rows: (string | number)[][] = [];
  rows.push(["Estado de cuenta —", nombreCliente]);
  rows.push(["Total créditos", resumen.totalCreditos.toFixed(2)]);
  rows.push(["Total pagos", resumen.totalPagos.toFixed(2)]);
  rows.push(["Deuda pendiente", formatoSaldo(-resumen.deudaPendiente)]);
  rows.push([]);
  rows.push(["Fecha", "Galones", "Producto", "Vale", "Precio", "Total crédito", "Pago", "Deuda pendiente"]);
  for (const f of filas) {
    rows.push([
      fechaCorta(f.fecha),
      f.galones ?? "",
      f.producto ?? "",
      f.vale ?? "",
      f.precio != null ? f.precio.toFixed(2) : "",
      f.totalCredito != null ? f.totalCredito.toFixed(2) : "",
      f.pago != null ? f.pago.toFixed(2) : "",
      formatoSaldo(f.saldoAcumulado),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
