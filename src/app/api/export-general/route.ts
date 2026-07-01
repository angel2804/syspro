import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import { ORDEN_TURNO } from "@/lib/calc";
import {
  llenarHojaIsla,
  llenarHojaMadre,
  llenarHojaOdometros,
  TURNO_NOMBRE,
} from "@/server/reportes";
import type { Precios, Sesion } from "@/lib/types";

const MADRE_PATH = () =>
  path.join(process.cwd(), "src/server/templates/madre.xlsx");
const ISLA_PATH = () =>
  path.join(process.cwd(), "src/server/templates/plantilla-isla.xlsx");
const ODOMETROS_PATH = () =>
  path.join(process.cwd(), "src/server/templates/odometros.xlsx");

// Copia una hoja ya llena (de otro libro) al libro destino. El setter de
// `model` no reaplica los rangos combinados (mergeCells), así que se reponen.
function copiarHoja(
  destino: ExcelJS.Workbook,
  nombre: string,
  origen: ExcelJS.Worksheet
) {
  const merges: string[] = [...(origen.model.merges ?? [])];
  const model = JSON.parse(JSON.stringify(origen.model));
  model.name = nombre;
  const ws = destino.addWorksheet(nombre);
  ws.model = model;
  for (const rng of merges) {
    try {
      ws.mergeCells(rng);
    } catch {
      /* ya combinado */
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const { dia, sesiones, precios } = (await req.json()) as {
      dia: string;
      sesiones: Sesion[];
      precios: Precios;
    };

    const out = new ExcelJS.Workbook();

    // --- Hoja ODOMETROS (primera hoja) con la plantilla del usuario ---
    const wbOdo = new ExcelJS.Workbook();
    await wbOdo.xlsx.readFile(ODOMETROS_PATH());
    const wsOdo = wbOdo.worksheets[0];
    llenarHojaOdometros(wsOdo, sesiones, dia, precios);
    copiarHoja(out, "ODOMETROS", wsOdo);

    // --- Hojas por turno (MAÑANA, TARDE, NOCHE) con la plantilla por isla ---
    for (const turno of ORDEN_TURNO) {
      const wbIsla = new ExcelJS.Workbook();
      await wbIsla.xlsx.readFile(ISLA_PATH());
      const ws = wbIsla.getWorksheet("tablas");
      if (!ws) throw new Error("La plantilla por isla no tiene la hoja 'tablas'");
      const sesTurno = sesiones.filter((s) => s.turno === turno);
      llenarHojaIsla(wbIsla, ws, sesTurno, precios);
      copiarHoja(out, TURNO_NOMBRE[turno], ws);
    }

    // --- Hoja MADRE (día completo) con la plantilla madre ---
    const wbMadre = new ExcelJS.Workbook();
    await wbMadre.xlsx.readFile(MADRE_PATH());
    const wsMadre = wbMadre.worksheets[0];
    llenarHojaMadre(wsMadre, sesiones, dia, precios);
    copiarHoja(out, "MADRE", wsMadre);

    const buffer = await out.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="reporte_general_${dia}.xlsx"`,
      },
    });
  } catch (e) {
    return Response.json(
      { error: "No se pudo generar el reporte general.", detalle: String(e) },
      { status: 500 }
    );
  }
}
