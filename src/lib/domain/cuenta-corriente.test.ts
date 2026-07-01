import { describe, expect, it } from "vitest";
import {
  construirEstadoCuenta,
  formatoSaldo,
  resumenCliente,
  type CreditoCC,
  type PagoCC,
} from "./cuenta-corriente";

// Helpers para construir movimientos con menos ruido en los tests.
let seq = 0;
function credito(p: Partial<CreditoCC> & { total: number; fecha: number }): CreditoCC {
  seq++;
  return {
    id: `c${seq}`,
    clienteId: "cli",
    producto: p.producto ?? "bio",
    galones: p.galones ?? 0,
    vale: p.vale ?? "0000",
    precioUnitario: p.precioUnitario ?? 0,
    estado: p.estado ?? "activo",
    createdAt: p.createdAt ?? p.fecha,
    updatedAt: p.updatedAt ?? p.fecha,
    ...p,
  };
}
function pago(p: Partial<PagoCC> & { monto: number; fecha: number }): PagoCC {
  seq++;
  return {
    id: `p${seq}`,
    clienteId: "cli",
    estado: p.estado ?? "activo",
    createdAt: p.createdAt ?? p.fecha,
    updatedAt: p.updatedAt ?? p.fecha,
    ...p,
  };
}

describe("resumenCliente — deuda = créditos - pagos", () => {
  it("ejemplo del requerimiento: 850 créditos - 800 pagos = 50 deuda", () => {
    const creditos = [
      credito({ total: 50, fecha: 1 }),
      credito({ total: 100, fecha: 2 }),
      credito({ total: 200, fecha: 3 }),
      credito({ total: 500, fecha: 4 }),
    ];
    const pagos = [pago({ monto: 800, fecha: 5 })];
    const r = resumenCliente(creditos, pagos);
    expect(r.totalCreditos).toBe(850);
    expect(r.totalPagos).toBe(800);
    expect(r.deudaPendiente).toBe(50);
    expect(r.estado).toBe("con-deuda");
  });

  it("sin deuda cuando paga exacto", () => {
    const r = resumenCliente([credito({ total: 100, fecha: 1 })], [pago({ monto: 100, fecha: 2 })]);
    expect(r.deudaPendiente).toBe(0);
    expect(r.estado).toBe("sin-deuda");
  });

  it("saldo a favor cuando paga de más", () => {
    const r = resumenCliente([credito({ total: 100, fecha: 1 })], [pago({ monto: 150, fecha: 2 })]);
    expect(r.deudaPendiente).toBe(-50);
    expect(r.estado).toBe("saldo-favor");
  });

  it("ignora movimientos anulados y corregidos", () => {
    const creditos = [
      credito({ total: 100, fecha: 1, estado: "activo" }),
      credito({ total: 999, fecha: 2, estado: "anulado" }),
      credito({ total: 50, fecha: 3, estado: "corregido" }),
    ];
    const pagos = [
      pago({ monto: 40, fecha: 4, estado: "activo" }),
      pago({ monto: 500, fecha: 5, estado: "anulado" }),
    ];
    const r = resumenCliente(creditos, pagos);
    expect(r.totalCreditos).toBe(100);
    expect(r.totalPagos).toBe(40);
    expect(r.deudaPendiente).toBe(60);
  });
});

describe("construirEstadoCuenta — formato obligatorio (Belquer)", () => {
  it("crédito 192 → -192; pago 100 → -92", () => {
    const creditos = [
      credito({ total: 192, galones: 10, producto: "bio", vale: "0001", precioUnitario: 19.2, fecha: 1 }),
    ];
    const pagos = [pago({ monto: 100, fecha: 2 })];
    const filas = construirEstadoCuenta(creditos, pagos);
    expect(filas).toHaveLength(2);

    expect(filas[0]).toMatchObject({
      tipo: "credito",
      galones: 10,
      producto: "bio",
      vale: "0001",
      precio: 19.2,
      totalCredito: 192,
      saldoAcumulado: -192,
    });
    expect(filas[0].pago).toBeUndefined();
    expect(formatoSaldo(filas[0].saldoAcumulado)).toBe("-192.00");

    expect(filas[1]).toMatchObject({ tipo: "pago", pago: 100, saldoAcumulado: -92 });
    expect(filas[1].galones).toBeUndefined();
    expect(filas[1].vale).toBeUndefined();
    expect(formatoSaldo(filas[1].saldoAcumulado)).toBe("-92.00");
  });

  it("varios créditos y pagos acumulan en orden cronológico", () => {
    // Mismo ejemplo extendido del requerimiento.
    const creditos = [
      credito({ total: 192, galones: 10, producto: "bio", vale: "0001", precioUnitario: 19.2, fecha: 1 }),
      credito({ total: 100, galones: 5, producto: "regular", vale: "0002", precioUnitario: 20, fecha: 2 }),
      credito({ total: 50, galones: 20, producto: "glp", vale: "0003", precioUnitario: 2.5, fecha: 4 }),
    ];
    const pagos = [pago({ monto: 200, fecha: 3 }), pago({ monto: 142, fecha: 5 })];
    const filas = construirEstadoCuenta(creditos, pagos);
    expect(filas.map((f) => f.saldoAcumulado)).toEqual([-192, -292, -92, -142, 0]);
    // La última fila deja la cuenta saldada exactamente en 0.00
    expect(formatoSaldo(filas[filas.length - 1].saldoAcumulado)).toBe("0.00");
  });

  it("excluye anulados del estado de cuenta", () => {
    const creditos = [
      credito({ total: 100, fecha: 1 }),
      credito({ total: 999, fecha: 2, estado: "anulado" }),
    ];
    const filas = construirEstadoCuenta(creditos, []);
    expect(filas).toHaveLength(1);
    expect(filas[0].saldoAcumulado).toBe(-100);
  });

  it("no produce -0.00 al saldar la cuenta", () => {
    const filas = construirEstadoCuenta([credito({ total: 100, fecha: 1 })], [pago({ monto: 100, fecha: 2 })]);
    expect(formatoSaldo(filas[1].saldoAcumulado)).toBe("0.00");
  });
});
