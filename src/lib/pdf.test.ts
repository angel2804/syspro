import { describe, expect, it } from "vitest";
import { htmlEstadoCuenta } from "./pdf";
import type { FilaEstadoCuenta, ResumenCliente } from "./domain/cuenta-corriente";

const resumen: ResumenCliente = {
  totalCreditos: 200,
  totalPagos: 50,
  deudaPendiente: 150,
  estado: "con-deuda",
};

const filas: FilaEstadoCuenta[] = [
  {
    tipo: "credito",
    movimientoId: "c1",
    fecha: Date.UTC(2026, 0, 2, 10, 30),
    galones: 10,
    producto: "bio",
    vale: "V-001",
    precio: 20,
    totalCredito: 200,
    saldoAcumulado: -200,
  },
  {
    tipo: "pago",
    movimientoId: "p1",
    fecha: Date.UTC(2026, 0, 3, 9, 0),
    pago: 50,
    saldoAcumulado: -150,
  },
];

describe("htmlEstadoCuenta", () => {
  it("incluye el nombre del cliente, los totales y las filas", () => {
    const html = htmlEstadoCuenta({ nombreCliente: "Belquer", filas, resumen });
    expect(html).toContain("Belquer");
    expect(html).toContain("Estado de cuenta");
    expect(html).toContain("V-001");
    expect(html).toContain("S/ 200.00"); // total crédito
    expect(html).toContain("-150.00"); // deuda pendiente firmada
  });

  it("escapa el HTML del nombre para evitar inyección", () => {
    const html = htmlEstadoCuenta({
      nombreCliente: "<script>x</script>",
      filas: [],
      resumen,
    });
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("muestra un placeholder cuando no hay movimientos", () => {
    const html = htmlEstadoCuenta({ nombreCliente: "Vacío", filas: [], resumen });
    expect(html).toContain("Sin movimientos");
  });
});
