// Dominio puro de la VALIDACIÓN DE CIERRE de un turno (Fase 5).
//
// Antes de que un trabajador finalice su turno se revisa la sesión y se
// devuelve una lista de problemas: los `error` bloquean el cierre (datos
// inconsistentes que descuadrarían el reporte); los `aviso` solo advierten
// (situaciones raras pero legítimas que conviene confirmar). No toca Supabase
// ni el store: es una función pura sobre la `Sesion`, cubierta por tests.
import { getIsla } from "../config";
import type { Sesion } from "../types";

export type SeveridadCierre = "error" | "aviso";

export interface ProblemaCierre {
  severidad: SeveridadCierre;
  mensaje: string;
}

// Reglas de validación previas al cierre. El orden es el que se muestra al
// trabajador (odómetros primero, luego cada registro).
export function validarCierre(s: Sesion): ProblemaCierre[] {
  const problemas: ProblemaCierre[] = [];
  const err = (mensaje: string) => problemas.push({ severidad: "error", mensaje });
  const aviso = (mensaje: string) => problemas.push({ severidad: "aviso", mensaje });

  const isla = getIsla(s.islaId);
  const mangueras = isla?.mangueras ?? [];

  // --- Odómetros ---
  let galonesTotales = 0;
  let odometrosVacios = 0;
  for (const m of mangueras) {
    const o = s.odometros[m.id];
    const entrada = o?.entrada ?? 0;
    const salida = o?.salida ?? 0;
    if (salida < entrada) {
      err(
        `Odómetro ${m.label}: la salida (${salida}) es menor que la entrada (${entrada}).`
      );
    }
    if (entrada < 0 || salida < 0) {
      err(`Odómetro ${m.label}: no puede tener valores negativos.`);
    }
    const g = Math.max(0, salida - entrada);
    galonesTotales += g;
    if (salida === 0) odometrosVacios++;
  }
  if (mangueras.length > 0 && odometrosVacios === mangueras.length) {
    aviso("Ningún odómetro tiene salida registrada: el turno no registra ventas.");
  }

  // --- Pagos electrónicos ---
  s.pagos.forEach((p, i) => {
    const etq = `Pago electrónico #${i + 1}`;
    if (!p.monto || p.monto <= 0) err(`${etq}: el monto es obligatorio.`);
    if ((p.metodo === "visa" || p.metodo === "transferencia") && !p.referencia)
      err(`${etq}: la referencia es obligatoria para Visa/Transferencia.`);
  });

  // --- Créditos ---
  s.creditos.forEach((c, i) => {
    const etq = `Crédito #${i + 1}`;
    if (!c.cliente?.trim()) err(`${etq}: falta el cliente.`);
    if (!c.vale?.trim()) err(`${etq}: falta el número de vale.`);
    if (!c.galones || c.galones <= 0) err(`${etq}: los galones son obligatorios.`);
  });

  // --- Promociones ---
  s.promociones.forEach((p, i) => {
    if (!p.galones || p.galones <= 0)
      err(`Promoción #${i + 1}: los galones son obligatorios.`);
  });

  // --- Descuentos ---
  s.descuentos.forEach((d, i) => {
    const etq = `Descuento #${i + 1}`;
    if (!d.galones || d.galones <= 0) err(`${etq}: los galones son obligatorios.`);
    if (!d.precioDescuento || d.precioDescuento <= 0)
      err(`${etq}: el precio dado es obligatorio.`);
  });

  // --- Gastos / adelantos / entregas: montos válidos ---
  s.gastos.forEach((g, i) => {
    if (!g.descripcion?.trim()) err(`Gasto #${i + 1}: falta el detalle.`);
    if (!g.monto || g.monto <= 0) err(`Gasto #${i + 1}: el monto es obligatorio.`);
  });
  s.adelantos.forEach((a, i) => {
    if (!a.monto || a.monto <= 0)
      err(`Pago adelantado #${i + 1}: el monto es obligatorio.`);
  });
  s.entregas.forEach((e, i) => {
    if (!e.monto || e.monto <= 0)
      err(`Entrega #${i + 1}: el monto es obligatorio.`);
  });

  // --- Balones (solo isla GLP) ---
  (s.balones ?? []).forEach((b, i) => {
    if (!b.cantidad || b.cantidad <= 0)
      err(`Balón #${i + 1}: la cantidad es obligatoria.`);
  });

  void galonesTotales;
  return problemas;
}

// True si NO hay ningún problema de severidad "error" (los avisos no bloquean).
export function puedeCerrar(problemas: ProblemaCierre[]): boolean {
  return !problemas.some((p) => p.severidad === "error");
}

export function contarPorSeveridad(problemas: ProblemaCierre[]): {
  errores: number;
  avisos: number;
} {
  return {
    errores: problemas.filter((p) => p.severidad === "error").length,
    avisos: problemas.filter((p) => p.severidad === "aviso").length,
  };
}
