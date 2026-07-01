import { describe, expect, it } from "vitest";
import { ISLAS, PRECIOS_DEFAULT } from "../config";
import type { Sesion } from "../types";
import { contarPorSeveridad, puedeCerrar, validarCierre } from "./cierre";

function sesionBase(overrides: Partial<Sesion> = {}): Sesion {
  const isla = ISLAS[0]; // isla1: bio, regular, premium
  const odometros: Sesion["odometros"] = {};
  isla.mangueras.forEach((m) => {
    odometros[m.id] = { entrada: 0, salida: 0 };
  });
  return {
    id: "2026-01-01_isla1_manana",
    fecha: "2026-01-01",
    trabajador: "Angel",
    islaId: "isla1",
    turno: "manana",
    precios: { ...PRECIOS_DEFAULT },
    odometros,
    pagos: [],
    creditos: [],
    promociones: [],
    descuentos: [],
    gastos: [],
    adelantos: [],
    entregas: [],
    conteos: [],
    balones: [],
    cerrada: false,
    createdAt: Date.now(),
    diaOperativo: "2026-01-01",
    updatedAt: Date.now(),
    schemaVersion: 5,
    ...overrides,
  };
}

describe("validarCierre — odómetros", () => {
  it("marca error cuando la salida es menor que la entrada", () => {
    const s = sesionBase({
      odometros: { i1_bio1a: { entrada: 200, salida: 150 } },
    });
    const problemas = validarCierre(s);
    expect(problemas.some((p) => p.severidad === "error")).toBe(true);
    expect(puedeCerrar(problemas)).toBe(false);
  });

  it("avisa (no bloquea) cuando ningún odómetro tiene salida", () => {
    const s = sesionBase();
    const problemas = validarCierre(s);
    expect(problemas.every((p) => p.severidad === "aviso")).toBe(true);
    expect(puedeCerrar(problemas)).toBe(true);
  });

  it("no reporta problemas con un turno con ventas normales", () => {
    const s = sesionBase({
      odometros: { i1_bio1a: { entrada: 100, salida: 200 } },
    });
    expect(validarCierre(s)).toEqual([]);
    expect(puedeCerrar(validarCierre(s))).toBe(true);
  });
});

describe("validarCierre — registros", () => {
  const conVenta = { odometros: { i1_bio1a: { entrada: 100, salida: 200 } } };

  it("bloquea crédito sin cliente ni vale", () => {
    const s = sesionBase({
      ...conVenta,
      creditos: [{ id: "c1", producto: "bio", cliente: "", vale: "", galones: 5 }],
    });
    const problemas = validarCierre(s);
    expect(contarPorSeveridad(problemas).errores).toBeGreaterThanOrEqual(2);
    expect(puedeCerrar(problemas)).toBe(false);
  });

  it("bloquea vales duplicados para el mismo cliente en el turno", () => {
    const s = sesionBase({
      ...conVenta,
      creditos: [
        { id: "c1", producto: "bio", cliente: "Belquer", vale: "003", galones: 5 },
        { id: "c2", producto: "regular", cliente: "belquer", vale: "003", galones: 3 },
      ],
    });
    const problemas = validarCierre(s);
    expect(problemas.some((p) => p.mensaje.includes("vale ya fue registrado"))).toBe(true);
    expect(puedeCerrar(problemas)).toBe(false);
  });

  it("bloquea pago visa/transferencia sin referencia", () => {
    const s = sesionBase({
      ...conVenta,
      pagos: [{ id: "p1", metodo: "visa", monto: 50 }],
    });
    expect(puedeCerrar(validarCierre(s))).toBe(false);
  });

  it("permite pago yape sin referencia", () => {
    const s = sesionBase({
      ...conVenta,
      pagos: [{ id: "p1", metodo: "yape", monto: 50 }],
    });
    expect(validarCierre(s)).toEqual([]);
  });

  it("bloquea monto no positivo en pagos/gastos/entregas", () => {
    const s = sesionBase({
      ...conVenta,
      pagos: [{ id: "p1", metodo: "yape", monto: 0 }],
      gastos: [{ id: "g1", descripcion: "algo", monto: -5 }],
      entregas: [{ id: "e1", monto: 0 }],
    });
    expect(contarPorSeveridad(validarCierre(s)).errores).toBe(3);
  });
});
