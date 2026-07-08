import { getIsla, ISLAS } from "./config";
import type { Precios, ProductoId, Sesion, TurnoId } from "./types";

export const ORDEN_TURNO: TurnoId[] = ["manana", "tarde", "noche"];

export interface FilaProducto {
  producto: ProductoId;
  galones: number;
  precio: number;
  venta: number; // galones * precio
}

export interface Cuadre {
  porProducto: FilaProducto[];
  ventaTotal: number;
  totalCreditos: number;
  totalPromociones: number;
  totalDescuentos: number;
  totalElectronico: number; // yapes + transferencias + visas
  totalGastos: number;
  totalAdelantos: number;
  totalBalones: number; // venta de balones de gas (suma al efectivo)
  efectivoAEntregar: number;
  totalEntregado: number;
  saldoPendiente: number;
}

// Galones vendidos por producto = suma de (salida - entrada) de sus mangueras
export function galonesPorProducto(s: Sesion): Record<string, number> {
  const isla = getIsla(s.islaId);
  const acc: Record<string, number> = {};
  isla?.mangueras.forEach((m) => {
    const o = s.odometros[m.id];
    const vendidos = Math.max(0, (o?.salida ?? 0) - (o?.entrada ?? 0));
    acc[m.producto] = (acc[m.producto] ?? 0) + vendidos;
  });
  return acc;
}

// Precios efectivos de una sesión (turno): se usa el snapshot que el turno
// guardó al abrirse —y que el admin puede corregir en el reporte— y se cae a
// `fallback` (precios globales) para cualquier clave ausente en documentos
// antiguos. Esto permite que cada turno tenga su propio precio (p. ej. el
// cambio de las 2pm) sin tocar los turnos anteriores.
export function preciosDe(s: Sesion, fallback: Precios): Precios {
  return { ...fallback, ...(s.precios ?? {}) };
}

export function calcularCuadre(s: Sesion, preciosGlobal: Precios): Cuadre {
  const isla = getIsla(s.islaId);
  const galones = galonesPorProducto(s);
  // El cuadre del turno se valoriza con el precio propio del turno.
  const precios = preciosDe(s, preciosGlobal);

  const porProducto: FilaProducto[] = (isla?.productos ?? []).map((p) => {
    const g = galones[p] ?? 0;
    const precio = precios[p] ?? 0;
    return { producto: p, galones: g, precio, venta: g * precio };
  });

  const ventaTotal = porProducto.reduce((a, f) => a + f.venta, 0);

  // Créditos: galones * precio del producto
  const totalCreditos = s.creditos.reduce(
    (a, c) => a + c.galones * (precios[c.producto] ?? 0),
    0
  );

  // Promociones: galones * precio del producto
  const totalPromociones = s.promociones.reduce(
    (a, p) => a + p.galones * (precios[p.producto] ?? 0),
    0
  );

  // Descuentos: galones * (precio normal - precio descuento)
  const totalDescuentos = s.descuentos.reduce(
    (a, d) =>
      a + d.galones * Math.max(0, (precios[d.producto] ?? 0) - d.precioDescuento),
    0
  );

  const totalElectronico = s.pagos.reduce((a, p) => a + p.monto, 0);
  const totalGastos = s.gastos.reduce((a, g) => a + g.monto, 0);
  const totalAdelantos = s.adelantos.reduce((a, x) => a + x.monto, 0);
  // Balones de gas: cantidad * precio del balón (suma al efectivo)
  const totalBalones = (s.balones ?? []).reduce(
    (a, b) => a + b.cantidad * (precios[b.tipo] ?? 0),
    0
  );

  const efectivoAEntregar =
    ventaTotal -
    totalCreditos -
    totalPromociones -
    totalDescuentos -
    totalElectronico -
    totalGastos +
    totalAdelantos +
    totalBalones;

  const totalEntregado = (s.entregas ?? []).reduce((a, e) => a + e.monto, 0);
  const saldoPendiente = efectivoAEntregar - totalEntregado;

  return {
    porProducto,
    ventaTotal,
    totalCreditos,
    totalPromociones,
    totalDescuentos,
    totalElectronico,
    totalGastos,
    totalAdelantos,
    totalBalones,
    efectivoAEntregar,
    totalEntregado,
    saldoPendiente,
  };
}

// Formato de moneda con separador de miles (es-PE): S/ 1,192.00 en vez de
// S/ 1192.00. Con ventas diarias de 4–5 cifras los miles se leen mucho mejor.
const FORMATO_SOLES = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function soles(n: number): string {
  return "S/ " + FORMATO_SOLES.format(n || 0);
}

// ===== Reporte del día =====
// Horarios: mañana 6–14, tarde 14–22, noche 22–6 (la noche cruza medianoche).
// Un "día operativo" va de las 6am a las 6am del día siguiente.

function fechaLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// Helper puro: día operativo a partir de createdAt + turno (reutilizable al
// crear la sesión para guardarlo como campo, sin depender del objeto Sesion).
export function diaOperativoDe(createdAt: number, turno: TurnoId): string {
  const d = new Date(createdAt);
  // turno noche creado de madrugada (<6h) pertenece al día anterior
  if (turno === "noche" && d.getHours() < 6) d.setDate(d.getDate() - 1);
  return fechaLocal(d);
}

// Día operativo al que pertenece una sesión. Usa el campo guardado si existe
// (docs nuevos), y cae al cálculo desde createdAt para docs antiguos.
export function diaOperativo(s: Sesion): string {
  return s.diaOperativo || diaOperativoDe(s.createdAt, s.turno);
}

// Día operativo "actual" (ahora): antes de las 6am cuenta como el día anterior.
export function diaOperativoActual(ref = Date.now()): string {
  return diaOperativoDe(ref, "noche");
}

// Nombre usado para marcar un turno sin trabajador asignado (p. ej. tras mover
// al trabajador a otra isla). Un turno así debe tratarse como LIBRE.
export const TRABAJADOR_SIN_ASIGNAR = "(sin asignar)";

// ¿Esta sesión no tiene un trabajador real asignado? (nombre vacío o el
// marcador "(sin asignar)"). Se usa para liberar el turno en el login.
export function sesionSinTrabajador(s: Sesion): boolean {
  const t = (s.trabajador ?? "").trim();
  return t === "" || t === TRABAJADOR_SIN_ASIGNAR;
}

// Resta n días a una fecha "YYYY-MM-DD" devolviendo otra "YYYY-MM-DD".
export function diaMenos(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return fechaLocal(new Date(y, m - 1, d - n));
}

export function sesionesPorDia(sesiones: Sesion[]): Map<string, Sesion[]> {
  const m = new Map<string, Sesion[]>();
  for (const s of sesiones) {
    const dia = diaOperativo(s);
    if (!m.has(dia)) m.set(dia, []);
    m.get(dia)!.push(s);
  }
  return m;
}

// Días con TODOS los turnos finalizados: las 9 combinaciones isla×turno
// (mañana/tarde/noche × 3 islas) deben existir y estar cerradas.
export function diasCompletos(sesiones: Sesion[]): string[] {
  const porDia = sesionesPorDia(sesiones);
  const dias: string[] = [];
  porDia.forEach((arr, dia) => {
    const todos = ISLAS.every((i) =>
      ORDEN_TURNO.every((t) => {
        const s = arr.find((x) => x.islaId === i.id && x.turno === t);
        return s && s.cerrada;
      })
    );
    if (todos) dias.push(dia);
  });
  return dias.sort((a, b) => (a < b ? 1 : -1));
}

// Un turno está "completo" cuando las 3 islas tienen su sesión de ese turno
// finalizada (cerrada). Recibe las sesiones YA filtradas de un día.
export function turnoCompleto(sesionesDelDia: Sesion[], turno: TurnoId): boolean {
  return ISLAS.every((i) => {
    const s = sesionesDelDia.find(
      (x) => x.islaId === i.id && x.turno === turno
    );
    return s != null && s.cerrada;
  });
}

// Turnos completos de un día (para exportar/reportar por turno).
export function turnosCompletosDeDia(
  sesiones: Sesion[],
  dia: string
): TurnoId[] {
  const delDia = sesiones.filter((s) => diaOperativo(s) === dia);
  return ORDEN_TURNO.filter((t) => turnoCompleto(delDia, t));
}

// Días con AL MENOS un turno completo (aparecen en reporte/export a medida que
// los turnos van finalizando), más recientes primero.
export function diasConTurnoCompleto(sesiones: Sesion[]): string[] {
  const porDia = sesionesPorDia(sesiones);
  const dias: string[] = [];
  porDia.forEach((arr, dia) => {
    if (ORDEN_TURNO.some((t) => turnoCompleto(arr, t))) dias.push(dia);
  });
  return dias.sort((a, b) => (a < b ? 1 : -1));
}

// Días con AL MENOS una sesión cerrada (una sola isla de un turno ya
// finalizó). Superset de diasConTurnoCompleto: permite exportar/revisar el
// avance de un día aunque ningún turno completo (3 islas) haya terminado
// todavía. Más recientes primero.
export function diasConAlgunaSesionCerrada(sesiones: Sesion[]): string[] {
  const porDia = sesionesPorDia(sesiones);
  const dias: string[] = [];
  porDia.forEach((arr, dia) => {
    if (arr.some((s) => s.cerrada)) dias.push(dia);
  });
  return dias.sort((a, b) => (a < b ? 1 : -1));
}

// Islas con su sesión de ese turno YA cerrada, dentro de un día específico
// (sin exigir que el turno esté completo en las 3 islas).
export function islasCerradasDeTurno(delDia: Sesion[], turno: TurnoId): string[] {
  return ISLAS.filter((i) => {
    const s = delDia.find((x) => x.islaId === i.id && x.turno === turno);
    return s != null && s.cerrada;
  }).map((i) => i.id);
}

// Turnos con AL MENOS una isla cerrada en ese día (para export individual
// por isla, que no necesita esperar a que las 3 islas del turno terminen).
export function turnosConAlgunaIslaCerrada(delDia: Sesion[]): TurnoId[] {
  return ORDEN_TURNO.filter((t) => islasCerradasDeTurno(delDia, t).length > 0);
}

// Un turno está habilitado para abrirse si es el primero del día (mañana) o
// si el turno inmediatamente anterior ya está completo (las 3 islas
// cerradas). Así se evita, por ejemplo, abrir "tarde" mientras "mañana"
// sigue en curso en cualquiera de las 3 islas.
export function turnoHabilitado(delDia: Sesion[], turno: TurnoId): boolean {
  const idx = ORDEN_TURNO.indexOf(turno);
  if (idx <= 0) return true;
  const anterior = ORDEN_TURNO[idx - 1];
  return turnoCompleto(delDia, anterior);
}

// Día operativo en el que deben crearse los turnos NUEVOS. No depende del
// reloj del sistema: es el día más antiguo entre los conocidos que todavía
// no tiene sus 9 turnos (3 islas × 3 turnos) cerrados. Si todos los días
// conocidos ya están completos, el día activo avanza al siguiente. Si no hay
// ninguna sesión registrada (sistema recién reseteado), se usa la fecha real
// como punto de partida.
export function diaActivoParaNuevosTurnos(sesiones: Sesion[]): string {
  if (sesiones.length === 0) return diaOperativoActual();
  const porDia = sesionesPorDia(sesiones);
  const dias = Array.from(porDia.keys()).sort(); // ascendente: el más antiguo primero
  for (const dia of dias) {
    const arr = porDia.get(dia) ?? [];
    const completo = ISLAS.every((i) =>
      ORDEN_TURNO.every((t) => {
        const s = arr.find((x) => x.islaId === i.id && x.turno === t);
        return s != null && s.cerrada;
      })
    );
    if (!completo) return dia;
  }
  // Todos los días conocidos están completos: el activo es el siguiente.
  return diaMenos(dias[dias.length - 1], -1);
}

export interface OdoDiaFila {
  mangueraId: string;
  label: string;
  producto: ProductoId;
  islaNombre: string;
  inicio: number;
  final: number;
  galones: number;
  precio: number;
  soles: number;
}

export interface ReporteDia extends Cuadre {
  dia: string;
  odometros: OdoDiaFila[];
  completo: boolean;
}

export function calcularReporteDia(
  delDia: Sesion[],
  dia: string,
  precios: Precios
): ReporteDia {
  // Odómetros totales por manguera (inicio = mañana, final = noche)
  const odometros: OdoDiaFila[] = [];
  for (const isla of ISLAS) {
    const sesionesIsla = ORDEN_TURNO.map((t) =>
      delDia.find((s) => s.islaId === isla.id && s.turno === t)
    ).filter(Boolean) as Sesion[];
    for (const m of isla.mangueras) {
      // Tramos de precio: turnos CONSECUTIVOS con el mismo precio para este
      // producto se agrupan, y su galonaje sale del odómetro de corrido
      // (entrada del primer turno → salida del último turno del tramo). Así, si
      // el precio cambia a las 2pm, la mañana queda en un tramo y tarde+noche
      // en otro. Con un único precio en el día queda UN solo tramo, idéntico al
      // comportamiento anterior (y conserva la tolerancia a salidas olvidadas
      // dentro de cada tramo).
      type Tramo = { precio: number; primera: Sesion; ultima: Sesion };
      const tramos: Tramo[] = [];
      for (const s of sesionesIsla) {
        const precio = preciosDe(s, precios)[m.producto] ?? 0;
        const ult = tramos[tramos.length - 1];
        if (ult && ult.precio === precio) ult.ultima = s;
        else tramos.push({ precio, primera: s, ultima: s });
      }
      for (const t of tramos) {
        const inicio = t.primera.odometros[m.id]?.entrada ?? 0;
        const final = t.ultima.odometros[m.id]?.salida ?? 0;
        const galones = Math.max(0, final - inicio);
        odometros.push({
          mangueraId: m.id,
          label: m.label,
          producto: m.producto,
          islaNombre: isla.nombre,
          inicio,
          final,
          galones,
          precio: t.precio,
          soles: galones * t.precio,
        });
      }
    }
  }

  const cuadres = delDia.map((s) => calcularCuadre(s, precios));
  const sum = (f: (c: Cuadre) => number) => cuadres.reduce((a, c) => a + f(c), 0);

  // Galones y venta por producto: se agregan desde el odómetro CONTINUO del día
  // (inicio = entrada del primer turno, final = salida del último turno), NO
  // sumando turno por turno. Así, aunque mañana y tarde olviden poner su salida,
  // el total del día sale de salida(noche) - entrada(mañana) sin duplicarse.
  const porProductoMap = new Map<ProductoId, FilaProducto>();
  for (const o of odometros) {
    const ex = porProductoMap.get(o.producto);
    if (ex) {
      ex.galones += o.galones;
      ex.venta += o.soles;
      ex.precio = o.precio;
    } else {
      porProductoMap.set(o.producto, {
        producto: o.producto,
        galones: o.galones,
        precio: o.precio,
        venta: o.soles,
      });
    }
  }
  const porProducto = Array.from(porProductoMap.values());
  const ventaTotal = porProducto.reduce((a, f) => a + f.venta, 0);

  // Deducciones, electrónico, gastos, etc. SÍ se suman por turno: son
  // transacciones registradas en cada turno, no lecturas de odómetro.
  const totalCreditos = sum((c) => c.totalCreditos);
  const totalPromociones = sum((c) => c.totalPromociones);
  const totalDescuentos = sum((c) => c.totalDescuentos);
  const totalElectronico = sum((c) => c.totalElectronico);
  const totalGastos = sum((c) => c.totalGastos);
  const totalAdelantos = sum((c) => c.totalAdelantos);
  const totalBalones = sum((c) => c.totalBalones);

  // Efectivo a entregar del día, recomputado con la venta del odómetro continuo
  // (mantiene la consistencia con el reporte general).
  const efectivoAEntregar =
    ventaTotal -
    totalCreditos -
    totalPromociones -
    totalDescuentos -
    totalElectronico -
    totalGastos +
    totalAdelantos +
    totalBalones;
  const totalEntregado = sum((c) => c.totalEntregado);

  return {
    dia,
    odometros,
    porProducto,
    ventaTotal,
    totalCreditos,
    totalPromociones,
    totalDescuentos,
    totalElectronico,
    totalGastos,
    totalAdelantos,
    totalBalones,
    efectivoAEntregar,
    totalEntregado,
    saldoPendiente: efectivoAEntregar - totalEntregado,
    completo: delDia.length > 0 && delDia.every((s) => s.cerrada),
  };
}

// ===== Exportar CSV =====
// Igual lógica de filtrado que la vista del reporte: turno "general" agrega
// inicio(mañana)→final(noche); un turno específico usa esa sesión por isla.
function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function construirCSVReporte(
  delDia: Sesion[],
  dia: string,
  turno: "general" | TurnoId,
  islaId: string, // "todas" o id de isla
  precios: Precios
): string {
  const islas = islaId === "todas" ? ISLAS : ISLAS.filter((i) => i.id === islaId);
  const filtradas = delDia.filter(
    (s) =>
      (turno === "general" || s.turno === turno) &&
      (islaId === "todas" || s.islaId === islaId)
  );
  const rep = calcularReporteDia(filtradas, dia, precios);
  const rows: (string | number)[][] = [];

  rows.push(["Reporte GrifoSys"]);
  rows.push(["Día", dia]);
  rows.push(["Turno", turno === "general" ? "General (todo el día)" : turno]);
  rows.push(["Isla", islaId === "todas" ? "Todas" : (getIsla(islaId)?.nombre ?? islaId)]);
  rows.push([]);

  rows.push(["ODÓMETROS"]);
  rows.push(["Manguera", "Producto", "Isla", "Encargado", "Inicio", "Final", "Galones", "Precio", "En soles"]);
  if (turno === "general") {
    for (const f of rep.odometros) {
      if (islaId !== "todas" && !getIsla(islaId)?.mangueras.some((m) => m.id === f.mangueraId))
        continue;
      rows.push([
        f.label,
        f.producto,
        f.islaNombre,
        "—",
        f.inicio,
        f.final,
        f.galones.toFixed(3),
        f.precio.toFixed(2),
        f.soles.toFixed(2),
      ]);
    }
  } else {
    for (const isla of islas) {
      const s = filtradas.find((x) => x.islaId === isla.id);
      for (const m of isla.mangueras) {
        const o = s?.odometros[m.id];
        const inicio = o?.entrada ?? 0;
        const final = o?.salida ?? 0;
        const galones = Math.max(0, final - inicio);
        const pr = precios[m.producto] ?? 0;
        rows.push([
          m.label,
          m.producto,
          isla.nombre,
          s?.trabajador ?? "FALTA",
          s ? inicio : "",
          s ? final : "",
          galones.toFixed(3),
          pr.toFixed(2),
          (galones * pr).toFixed(2),
        ]);
      }
    }
  }

  rows.push([]);
  rows.push(["RESUMEN"]);
  rows.push(["Venta total", rep.ventaTotal.toFixed(2)]);
  rows.push(["Créditos", rep.totalCreditos.toFixed(2)]);
  rows.push(["Promociones", rep.totalPromociones.toFixed(2)]);
  rows.push(["Descuentos", rep.totalDescuentos.toFixed(2)]);
  rows.push(["Pagos electrónicos", rep.totalElectronico.toFixed(2)]);
  rows.push(["Gastos", rep.totalGastos.toFixed(2)]);
  rows.push(["Pago adelantado", rep.totalAdelantos.toFixed(2)]);
  rows.push(["Balones de gas", rep.totalBalones.toFixed(2)]);
  rows.push(["Efectivo a entregar", rep.efectivoAEntregar.toFixed(2)]);
  rows.push(["Entregado al encargado", rep.totalEntregado.toFixed(2)]);
  rows.push(["Saldo pendiente", rep.saldoPendiente.toFixed(2)]);

  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}
