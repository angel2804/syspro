import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import { calcularCuadre } from "@/lib/calc";
import { ISLAS } from "@/lib/config";
import { llenarHojaIsla } from "@/server/reportes";
import type { Precios, Sesion } from "@/lib/types";

const EPS = 0.01;
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  try {
    const { dia, turno, sesiones, precios } = (await req.json()) as {
      dia: string;
      turno: "manana" | "tarde" | "noche";
      sesiones: Sesion[];
      precios: Precios;
    };

    const templatePath = path.join(
      process.cwd(),
      "src/server/templates/plantilla-isla.xlsx"
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(templatePath);
    const ws = wb.getWorksheet("tablas");
    if (!ws) throw new Error("La plantilla no tiene la hoja 'tablas'");

    const totales = llenarHojaIsla(wb, ws, sesiones, precios);

    // ===== Validación: cada total escrito en la hoja debe coincidir con el
    // cálculo independiente del sistema (calcularCuadre) para las 3 islas
    // combinadas de este turno. Si hay diferencia, no se genera nada.
    const sesionesUnicas = Array.from(
      new Map(sesiones.map((s) => [s.id, s])).values()
    );
    const cuadresIsla = ISLAS.map((isla) =>
      sesionesUnicas.find((s) => s.islaId === isla.id)
    )
      .filter((s): s is Sesion => !!s)
      .map((s) => calcularCuadre(s, precios));
    const sumaSistema = (f: (c: ReturnType<typeof calcularCuadre>) => number) =>
      r2(cuadresIsla.reduce((a, c) => a + f(c), 0));

    const checks: [string, number, number][] = [
      ["Yapes/Transferencias/Visa", totales.totalYapes, sumaSistema((c) => c.totalElectronico)],
      ["Descuentos", totales.totalDescuentos, sumaSistema((c) => c.totalDescuentos)],
      ["Créditos", totales.totalCreditos, sumaSistema((c) => c.totalCreditos)],
      ["Promociones", totales.totalPromociones, sumaSistema((c) => c.totalPromociones)],
      ["Gastos", totales.totalGastos, sumaSistema((c) => c.totalGastos)],
    ];
    const diferencias = checks.filter(([, a, b]) => Math.abs(a - b) > EPS);
    if (diferencias.length > 0) {
      return Response.json(
        {
          error:
            "Los totales no coinciden con los cálculos del sistema. No se generó el archivo.",
          detalle: diferencias.map(([nombre, archivo, sistema]) => ({
            nombre,
            archivo,
            sistema,
          })),
        },
        { status: 422 }
      );
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reporte_${dia}_${turno}.xlsx"`,
      },
    });
  } catch (e) {
    return Response.json(
      { error: "No se pudo generar el reporte por isla.", detalle: String(e) },
      { status: 500 }
    );
  }
}
