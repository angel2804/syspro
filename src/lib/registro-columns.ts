// Definiciones de columnas (RegistroAddForm / tablas) compartidas entre
// dashboard/page.tsx (turno activo) y reporte-dia-vista.tsx (reporte del
// día). Antes estaban duplicadas casi línea por línea en ambos archivos.
import type { Col } from "@/components/grifo/registro-fields";
import { soles } from "./calc";
import { PRODUCTOS } from "./config";
import type {
  Adelanto,
  Balon,
  Conteo,
  Credito,
  Descuento,
  Entrega,
  Gasto,
  PagoElectronico,
  Precios,
  Promocion,
  ProductoId,
} from "./types";

export type ProductoOption = { value: ProductoId; label: string };
type PrecioFn = (p: ProductoId) => number;

export const METODO_PAGO_OPTIONS = [
  { value: "yape", label: "Yape" },
  { value: "transferencia", label: "Transferencia" },
  { value: "visa", label: "Visa" },
  { value: "culqui", label: "VISA YQ" },
] as const;

export const BALON_TIPO_OPTIONS = [
  { value: "gasfull", label: "Gas Full" },
  { value: "zetagas", label: "Zeta Gas" },
] as const;

export function colsPago(): Col<PagoElectronico>[] {
  return [
    { key: "metodo", label: "Tipo", tipo: "select", options: [...METODO_PAGO_OPTIONS] },
    { key: "referencia", label: "Referencia", tipo: "text", opcional: true },
    { key: "factura", label: "Factura", tipo: "text", opcional: true },
    { key: "monto", label: "Monto", tipo: "number" },
  ];
}
export const nuevoPago = (): Omit<PagoElectronico, "id"> => ({
  metodo: "yape",
  referencia: "",
  factura: "",
  monto: 0,
});
// Resumen de pagos desglosado por tipo (Yape, Transferencia, Visa, VISA YQ)
// más el total. Solo muestra los tipos con monto. Usado en el pie del modal de
// pagos (turno del trabajador y reporte del admin).
export function resumenPagos(rows: PagoElectronico[]): string {
  const partes = METODO_PAGO_OPTIONS.map((m) => {
    const t = rows
      .filter((r) => r.metodo === m.value)
      .reduce((a, r) => a + r.monto, 0);
    return t > 0 ? `${m.label}: ${soles(t)}` : null;
  }).filter(Boolean) as string[];
  const total = rows.reduce((a, r) => a + r.monto, 0);
  return [...partes, `Total: ${soles(total)}`].join("   ·   ");
}

export function validarPago(r: Omit<PagoElectronico, "id">): string | null {
  if (!r.metodo) return "Elige un tipo";
  if (!r.monto || r.monto <= 0) return "El monto es obligatorio";
  if ((r.metodo === "visa" || r.metodo === "transferencia") && !r.referencia)
    return "La referencia es obligatoria para Visa/Transferencia";
  return null;
}

// Resumen por producto (créditos / promos): galones, precio y total por cada
// producto (bio, regular, premium, glp). El precio mostrado es el efectivo
// (soles ÷ galones), que con un solo precio en el día equivale al precio normal.
export function resumenPorProducto(
  items: { producto: ProductoId; galones: number; precio: number }[]
): string {
  const map = new Map<ProductoId, { galones: number; soles: number }>();
  for (const it of items) {
    const e = map.get(it.producto) ?? { galones: 0, soles: 0 };
    e.galones += it.galones;
    e.soles += it.galones * it.precio;
    map.set(it.producto, e);
  }
  const partes = Array.from(map.entries())
    .filter(([, e]) => e.galones > 0)
    .map(([p, e]) => {
      const pu = e.galones > 0 ? e.soles / e.galones : 0;
      return `${PRODUCTOS[p]}: ${e.galones.toFixed(3)} gal × ${soles(pu)} = ${soles(e.soles)}`;
    });
  const total = Array.from(map.values()).reduce((a, e) => a + e.soles, 0);
  if (partes.length === 0) return `Total: ${soles(0)}`;
  return [...partes, `Total: ${soles(total)}`].join("   ·   ");
}

export function colsCredito(
  productoOptions: ProductoOption[],
  precio: PrecioFn,
  clientes: string[] = []
): Col<Credito>[] {
  return [
    { key: "producto", label: "Producto", tipo: "select", options: productoOptions },
    {
      key: "cliente",
      label: "Cliente",
      tipo: "text",
      sugerencias: clientes,
      requiereSeleccion: true,
      permiteNuevo: true,
    },
    { key: "vale", label: "Vale N°", tipo: "text" },
    { key: "factura", label: "Factura", tipo: "text", opcional: true },
    { key: "galones", label: "Galones", tipo: "number" },
    {
      key: "id",
      label: "Total",
      tipo: "text",
      computar: (r) => soles(r.galones * precio(r.producto)),
    },
  ];
}
export const nuevoCredito = (producto: ProductoId): Omit<Credito, "id"> => ({
  producto,
  cliente: "",
  vale: "",
  factura: "",
  galones: 0,
});
export function validarCredito(r: Omit<Credito, "id">): string | null {
  if (!r.cliente) return "El cliente es obligatorio";
  if (!r.vale) return "El vale es obligatorio";
  if (!r.galones || r.galones <= 0) return "Los galones son obligatorios";
  return null;
}

export function colsPromo(
  productoOptions: ProductoOption[],
  precio: PrecioFn
): Col<Promocion>[] {
  return [
    { key: "producto", label: "Producto", tipo: "select", options: productoOptions },
    { key: "dniPlaca", label: "DNI / Placa", tipo: "text", opcional: true },
    { key: "galones", label: "Galones", tipo: "number" },
    {
      key: "id",
      label: "Total",
      tipo: "text",
      computar: (r) => soles(r.galones * precio(r.producto)),
    },
  ];
}
export const nuevoPromo = (producto: ProductoId): Omit<Promocion, "id"> => ({
  producto,
  dniPlaca: "",
  galones: 0,
});
export const validarPromo = (r: Omit<Promocion, "id">): string | null =>
  !r.galones || r.galones <= 0 ? "Los galones son obligatorios" : null;

export function colsDescuento(
  productoOptions: ProductoOption[],
  precio: PrecioFn,
  clientes: string[] = []
): Col<Descuento>[] {
  return [
    { key: "producto", label: "Producto", tipo: "select", options: productoOptions },
    { key: "cliente", label: "Cliente", tipo: "text", opcional: true, sugerencias: clientes },
    { key: "galones", label: "Galones", tipo: "number" },
    { key: "precioDescuento", label: "Precio dado", tipo: "number" },
    {
      key: "id",
      label: "Descuento",
      tipo: "text",
      computar: (r) =>
        soles(r.galones * Math.max(0, precio(r.producto) - r.precioDescuento)),
    },
  ];
}
export const nuevoDescuento = (producto: ProductoId): Omit<Descuento, "id"> => ({
  producto,
  cliente: "",
  galones: 0,
  precioDescuento: 0,
});
export function validarDescuento(r: Omit<Descuento, "id">): string | null {
  if (!r.galones || r.galones <= 0) return "Los galones son obligatorios";
  if (!r.precioDescuento || r.precioDescuento <= 0)
    return "El precio dado es obligatorio";
  return null;
}

export function colsGasto(): Col<Gasto>[] {
  return [
    { key: "descripcion", label: "Detalle", tipo: "text" },
    { key: "monto", label: "Monto", tipo: "number" },
  ];
}
export const nuevoGasto = (): Omit<Gasto, "id"> => ({ descripcion: "", monto: 0 });
export function validarGasto(r: Omit<Gasto, "id">): string | null {
  if (!r.descripcion) return "El detalle es obligatorio";
  if (!r.monto || r.monto <= 0) return "El monto es obligatorio";
  return null;
}

export function colsAdelanto(): Col<Adelanto>[] {
  return [
    { key: "descripcion", label: "Descripción", tipo: "text", opcional: true },
    { key: "monto", label: "Monto", tipo: "number" },
  ];
}
export const nuevoAdelanto = (): Omit<Adelanto, "id"> => ({ descripcion: "", monto: 0 });
export const validarAdelanto = (r: Omit<Adelanto, "id">): string | null =>
  !r.monto || r.monto <= 0 ? "El monto es obligatorio" : null;

export function colsEntrega(): Col<Entrega>[] {
  return [
    { key: "hora", label: "Hora", tipo: "text", opcional: true },
    { key: "monto", label: "Monto entregado", tipo: "number" },
  ];
}
export const nuevoEntrega = (): Omit<Entrega, "id"> => ({ hora: "", monto: 0 });
export const validarEntrega = (r: Omit<Entrega, "id">): string | null =>
  !r.monto || r.monto <= 0 ? "El monto es obligatorio" : null;

// Conteo físico del admin: el trabajador se elige con el selector de
// "Encargado" del modal (la sesión), aquí solo se ingresa el monto contado.
export function colsConteo(): Col<Conteo>[] {
  return [{ key: "monto", label: "Monto contado", tipo: "number" }];
}
export const nuevoConteo = (): Omit<Conteo, "id"> => ({ monto: 0 });
export const validarConteo = (r: Omit<Conteo, "id">): string | null =>
  !r.monto || r.monto <= 0 ? "El monto es obligatorio" : null;

export function colsBalon(precios: Precios): Col<Balon>[] {
  return [
    { key: "tipo", label: "Balón", tipo: "select", options: [...BALON_TIPO_OPTIONS] },
    { key: "cantidad", label: "Cantidad", tipo: "number" },
    {
      key: "id",
      label: "Total",
      tipo: "text",
      computar: (r) => soles(r.cantidad * (precios[r.tipo] ?? 0)),
    },
  ];
}
export const nuevoBalon = (): Omit<Balon, "id"> => ({ tipo: "gasfull", cantidad: 0 });
export const validarBalon = (r: Omit<Balon, "id">): string | null =>
  !r.cantidad || r.cantidad <= 0 ? "La cantidad es obligatoria" : null;
export const totalBalonesSoles = (rows: Balon[], precios: Precios): number =>
  rows.reduce((a, r) => a + r.cantidad * (precios[r.tipo] ?? 0), 0);

export const totalMonto = <T extends { monto: number }>(rows: T[]): number =>
  rows.reduce((a, r) => a + r.monto, 0);
