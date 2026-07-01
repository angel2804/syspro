import { describe, expect, it } from "vitest";
import {
  calcularCuadre,
  calcularReporteDia,
  diaActivoParaNuevosTurnos,
  diaMenos,
  diaOperativoActual,
  diaOperativoDe,
  diasConAlgunaSesionCerrada,
  galonesPorProducto,
  islasCerradasDeTurno,
  turnoCompleto,
  turnoHabilitado,
  turnosConAlgunaIslaCerrada,
} from "./calc";
import { ISLAS, PRECIOS_DEFAULT } from "./config";
import type { Sesion } from "./types";

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
    schemaVersion: 4,
    ...overrides,
  };
}

describe("galonesPorProducto", () => {
  it("suma galones de todas las mangueras del mismo producto", () => {
    const s = sesionBase({
      odometros: {
        i1_bio1a: { entrada: 100, salida: 150 },
        i1_bio1b: { entrada: 0, salida: 0 },
        i1_reg1: { entrada: 0, salida: 0 },
        i1_prem1: { entrada: 0, salida: 0 },
        i1_bio2a: { entrada: 0, salida: 0 },
        i1_bio2b: { entrada: 0, salida: 0 },
        i1_reg2: { entrada: 0, salida: 0 },
        i1_prem2: { entrada: 0, salida: 0 },
      },
    });
    expect(galonesPorProducto(s).bio).toBe(50);
  });

  it("nunca devuelve galones negativos si salida < entrada (odómetro mal tecleado)", () => {
    const s = sesionBase({
      odometros: {
        ...sesionBase().odometros,
        i1_bio1a: { entrada: 500, salida: 100 },
      },
    });
    expect(galonesPorProducto(s).bio).toBe(0);
  });
});

describe("calcularCuadre", () => {
  it("calcula venta total = galones * precio por producto", () => {
    const s = sesionBase({
      odometros: {
        ...sesionBase().odometros,
        i1_reg1: { entrada: 0, salida: 10 },
      },
    });
    const c = calcularCuadre(s, PRECIOS_DEFAULT);
    expect(c.ventaTotal).toBeCloseTo(10 * PRECIOS_DEFAULT.regular);
  });

  it("resta créditos, promociones, descuentos, electrónico y gastos del efectivo a entregar", () => {
    const s = sesionBase({
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 0, salida: 100 } },
      creditos: [{ id: "1", producto: "regular", cliente: "X", vale: "1", galones: 10 }],
      promociones: [{ id: "1", producto: "regular", galones: 5 }],
      descuentos: [{ id: "1", producto: "regular", galones: 5, precioDescuento: 10 }],
      pagos: [{ id: "1", metodo: "yape", monto: 50 }],
      gastos: [{ id: "1", descripcion: "x", monto: 20 }],
      adelantos: [{ id: "1", monto: 15 }],
    });
    const precios = PRECIOS_DEFAULT;
    const c = calcularCuadre(s, precios);
    const ventaTotal = 100 * precios.regular;
    const totalCreditos = 10 * precios.regular;
    const totalPromociones = 5 * precios.regular;
    const totalDescuentos = 5 * (precios.regular - 10);
    const esperado =
      ventaTotal - totalCreditos - totalPromociones - totalDescuentos - 50 - 20 + 15;
    expect(c.efectivoAEntregar).toBeCloseTo(esperado);
  });

  it("descuento nunca es negativo si precioDescuento > precio normal", () => {
    const s = sesionBase({
      descuentos: [{ id: "1", producto: "regular", galones: 5, precioDescuento: 9999 }],
    });
    const c = calcularCuadre(s, PRECIOS_DEFAULT);
    expect(c.totalDescuentos).toBe(0);
  });

  it("suma balones de gas al efectivo a entregar", () => {
    const s = sesionBase({
      balones: [{ id: "1", tipo: "gasfull", cantidad: 2 }],
    });
    const c = calcularCuadre(s, PRECIOS_DEFAULT);
    expect(c.totalBalones).toBeCloseTo(2 * PRECIOS_DEFAULT.gasfull);
  });

  it("saldoPendiente = efectivoAEntregar - totalEntregado", () => {
    const s = sesionBase({
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 0, salida: 10 } },
      entregas: [{ id: "1", monto: 5 }],
    });
    const c = calcularCuadre(s, PRECIOS_DEFAULT);
    expect(c.saldoPendiente).toBeCloseTo(c.efectivoAEntregar - 5);
  });
});

describe("precio por turno (tramos)", () => {
  it("calcularCuadre usa el precio snapshot de la sesión, no el global", () => {
    const s = sesionBase({
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 0, salida: 10 } },
      precios: { ...PRECIOS_DEFAULT, regular: 20 },
    });
    // Global regular = 16, pero la sesión congeló 20: manda el de la sesión.
    const c = calcularCuadre(s, PRECIOS_DEFAULT);
    expect(c.ventaTotal).toBeCloseTo(10 * 20);
  });

  it("el reporte del día parte el odómetro en tramos cuando cambia el precio a las 2pm", () => {
    const base = sesionBase();
    const manana = sesionBase({
      id: "2026-01-01_isla1_manana",
      turno: "manana",
      cerrada: true,
      odometros: { ...base.odometros, i1_reg1: { entrada: 0, salida: 100 } },
      precios: { ...PRECIOS_DEFAULT, regular: 16 },
    });
    const tarde = sesionBase({
      id: "2026-01-01_isla1_tarde",
      turno: "tarde",
      cerrada: true,
      odometros: { ...base.odometros, i1_reg1: { entrada: 100, salida: 250 } },
      precios: { ...PRECIOS_DEFAULT, regular: 20 },
    });
    const rep = calcularReporteDia([manana, tarde], "2026-01-01", PRECIOS_DEFAULT);
    const regular = rep.porProducto.find((f) => f.producto === "regular")!;
    // Galones del día siguen siendo continuos (100 + 150).
    expect(regular.galones).toBeCloseTo(250);
    // Pero la venta se parte: 100 gal a 16 + 150 gal a 20.
    expect(regular.venta).toBeCloseTo(100 * 16 + 150 * 20);
  });
});

describe("diaOperativoDe — cruce de medianoche en turno noche", () => {
  it("turno noche creado después de las 6am pertenece al día actual", () => {
    const d = new Date(2026, 0, 15, 22, 0, 0); // 15 ene 22:00
    expect(diaOperativoDe(d.getTime(), "noche")).toBe("2026-01-15");
  });

  it("turno noche creado antes de las 6am (madrugada) pertenece al día anterior", () => {
    const d = new Date(2026, 0, 16, 2, 0, 0); // 16 ene 02:00 (mismo turno, ya pasó medianoche)
    expect(diaOperativoDe(d.getTime(), "noche")).toBe("2026-01-15");
  });

  it("turno noche exactamente a las 6:00am cuenta como el día actual (límite)", () => {
    const d = new Date(2026, 0, 16, 6, 0, 0);
    expect(diaOperativoDe(d.getTime(), "noche")).toBe("2026-01-16");
  });

  it("turno mañana/tarde nunca retrocede de día aunque sea de madrugada", () => {
    const d = new Date(2026, 0, 16, 2, 0, 0);
    expect(diaOperativoDe(d.getTime(), "manana")).toBe("2026-01-16");
  });
});

describe("diaMenos", () => {
  it("resta días cruzando límite de mes", () => {
    expect(diaMenos("2026-03-01", 1)).toBe("2026-02-28");
  });

  it("resta 0 días devuelve la misma fecha", () => {
    expect(diaMenos("2026-01-15", 0)).toBe("2026-01-15");
  });
});

describe("turnoCompleto", () => {
  it("es falso si falta una isla", () => {
    const sesiones = [sesionBase({ islaId: "isla1", cerrada: true })];
    expect(turnoCompleto(sesiones, "manana")).toBe(false);
  });

  it("es falso si una isla tiene sesión pero no está cerrada", () => {
    const sesiones = ISLAS.map((i) =>
      sesionBase({ islaId: i.id, turno: "manana", cerrada: i.id !== "isla2" })
    );
    expect(turnoCompleto(sesiones, "manana")).toBe(false);
  });

  it("es verdadero cuando las 3 islas tienen el turno cerrado", () => {
    const sesiones = ISLAS.map((i) =>
      sesionBase({ islaId: i.id, turno: "manana", cerrada: true })
    );
    expect(turnoCompleto(sesiones, "manana")).toBe(true);
  });
});

describe("turnoHabilitado — bloqueo en cascada mañana→tarde→noche", () => {
  it("mañana siempre está habilitado, incluso sin ninguna sesión", () => {
    expect(turnoHabilitado([], "manana")).toBe(true);
  });

  it("tarde está bloqueado si mañana no tiene las 3 islas cerradas", () => {
    const sesiones = [
      sesionBase({ islaId: "isla1", turno: "manana", cerrada: true }),
      sesionBase({ id: "b", islaId: "isla2", turno: "manana", cerrada: false }),
    ];
    expect(turnoHabilitado(sesiones, "tarde")).toBe(false);
  });

  it("tarde se habilita cuando las 3 islas de mañana ya cerraron", () => {
    const sesiones = ISLAS.map((i) =>
      sesionBase({ id: i.id, islaId: i.id, turno: "manana", cerrada: true })
    );
    expect(turnoHabilitado(sesiones, "tarde")).toBe(true);
  });

  it("noche permanece bloqueado aunque mañana esté completo si tarde no lo está", () => {
    const sesiones = [
      ...ISLAS.map((i) =>
        sesionBase({ id: "m_" + i.id, islaId: i.id, turno: "manana", cerrada: true })
      ),
      sesionBase({ id: "t_isla1", islaId: "isla1", turno: "tarde", cerrada: true }),
    ];
    expect(turnoHabilitado(sesiones, "noche")).toBe(false);
  });
});

describe("islasCerradasDeTurno / turnosConAlgunaIslaCerrada", () => {
  it("detecta una isla cerrada sin que el turno completo lo esté", () => {
    const sesiones = [
      sesionBase({ islaId: "isla1", turno: "manana", cerrada: true }),
      sesionBase({ id: "b", islaId: "isla2", turno: "manana", cerrada: false }),
    ];
    expect(islasCerradasDeTurno(sesiones, "manana")).toEqual(["isla1"]);
    expect(turnosConAlgunaIslaCerrada(sesiones)).toEqual(["manana"]);
  });

  it("no reporta nada si ninguna isla cerró ese turno", () => {
    const sesiones = [sesionBase({ islaId: "isla1", turno: "tarde", cerrada: false })];
    expect(islasCerradasDeTurno(sesiones, "tarde")).toEqual([]);
  });
});

describe("diasConAlgunaSesionCerrada", () => {
  it("incluye un día aunque ningún turno completo (3 islas) haya terminado", () => {
    const sesiones = [
      sesionBase({ islaId: "isla1", turno: "manana", cerrada: true, diaOperativo: "2026-01-01" }),
    ];
    expect(diasConAlgunaSesionCerrada(sesiones)).toEqual(["2026-01-01"]);
  });

  it("no incluye días sin ninguna sesión cerrada", () => {
    const sesiones = [
      sesionBase({ islaId: "isla1", turno: "manana", cerrada: false, diaOperativo: "2026-01-01" }),
    ];
    expect(diasConAlgunaSesionCerrada(sesiones)).toEqual([]);
  });
});

describe("diaActivoParaNuevosTurnos — independiente del reloj", () => {
  it("sin sesiones, usa el día operativo real como punto de partida", () => {
    expect(diaActivoParaNuevosTurnos([])).toBe(diaOperativoActual());
  });

  it("si el único día conocido no está completo, ese sigue siendo el activo", () => {
    const sesiones = [
      sesionBase({ islaId: "isla1", turno: "manana", cerrada: true, diaOperativo: "2026-01-01" }),
    ];
    expect(diaActivoParaNuevosTurnos(sesiones)).toBe("2026-01-01");
  });

  it("cuando el día está 100% completo (9 turnos), el activo avanza al día siguiente", () => {
    const dia = "2026-01-01";
    const sesiones = ISLAS.flatMap((i) =>
      (["manana", "tarde", "noche"] as const).map((t) =>
        sesionBase({
          id: `${dia}_${i.id}_${t}`,
          islaId: i.id,
          turno: t,
          cerrada: true,
          diaOperativo: dia,
        })
      )
    );
    expect(diaActivoParaNuevosTurnos(sesiones)).toBe("2026-01-02");
  });

  it("nunca retrocede a un día ya completado aunque sea el más reciente conocido", () => {
    const completo = "2026-01-01";
    const sesionesCompleto = ISLAS.flatMap((i) =>
      (["manana", "tarde", "noche"] as const).map((t) =>
        sesionBase({
          id: `c_${i.id}_${t}`,
          islaId: i.id,
          turno: t,
          cerrada: true,
          diaOperativo: completo,
        })
      )
    );
    expect(diaActivoParaNuevosTurnos(sesionesCompleto)).toBe("2026-01-02");
  });
});

describe("calcularReporteDia", () => {
  it("suma los cuadres de todos los turnos del día", () => {
    const s1 = sesionBase({
      id: "a",
      turno: "manana",
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 0, salida: 10 } },
    });
    const s2 = sesionBase({
      id: "b",
      turno: "tarde",
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 10, salida: 25 } },
    });
    const rep = calcularReporteDia([s1, s2], "2026-01-01", PRECIOS_DEFAULT);
    expect(rep.ventaTotal).toBeCloseTo(25 * PRECIOS_DEFAULT.regular);
  });

  it("usa salida(noche) - entrada(mañana) aunque mañana y tarde no pongan su salida", () => {
    // Mañana arranca en 100 pero olvidan la salida; tarde no la pone tampoco;
    // solo noche cierra en 400. El total del día debe ser 400 - 100 = 300.
    const manana = sesionBase({
      id: "a",
      turno: "manana",
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 100, salida: 0 } },
    });
    const tarde = sesionBase({
      id: "b",
      turno: "tarde",
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 0, salida: 0 } },
    });
    const noche = sesionBase({
      id: "c",
      turno: "noche",
      odometros: { ...sesionBase().odometros, i1_reg1: { entrada: 0, salida: 400 } },
    });
    const rep = calcularReporteDia([manana, tarde, noche], "2026-01-01", PRECIOS_DEFAULT);
    const reg = rep.porProducto.find((p) => p.producto === "regular");
    expect(reg?.galones).toBeCloseTo(300);
    expect(rep.ventaTotal).toBeCloseTo(300 * PRECIOS_DEFAULT.regular);
  });

  it("completo es false si el día no tiene sesiones", () => {
    const rep = calcularReporteDia([], "2026-01-01", PRECIOS_DEFAULT);
    expect(rep.completo).toBe(false);
  });

  it("completo es false si alguna sesión del día sigue abierta", () => {
    const s = sesionBase({ cerrada: false });
    const rep = calcularReporteDia([s], "2026-01-01", PRECIOS_DEFAULT);
    expect(rep.completo).toBe(false);
  });
});
