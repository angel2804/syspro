import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import path from "path";

type FormatoExport = "xlsx" | "pdf";

interface FilaCreditoExport {
  fecha: number;
  cliente: string;
  producto?: string;
  vale?: string;
  precio?: number;
  totalCredito?: number;
  pago?: number;
  deudaPendiente: number;
}

interface ExportCreditosBody {
  formato: FormatoExport;
  cliente: string;
  filas: FilaCreditoExport[];
  resumen: {
    totalCreditos: number;
    totalPagos: number;
    deudaPendiente: number;
  };
  rango?: { desde?: string; hasta?: string };
}

const TEMPLATE_PATH = () =>
  path.join(process.cwd(), "src/server/templates/creditos.xlsx");

const soles = (n: number) => `S/ ${(n || 0).toFixed(2)}`;
const fechaNombre = () => new Date().toISOString().slice(0, 10);

function nombreArchivo(cliente: string, ext: string) {
  const limpio = cliente
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `creditos-${limpio || "cliente"}-${fechaNombre()}.${ext}`;
}

function fechaLocal(ms: number) {
  return new Date(ms).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function limpiarPDF(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .slice(0, 120);
}

function pdfText(s: string) {
  return limpiarPDF(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function lineaTexto(x: number, y: number, texto: string, size = 9) {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfText(texto)}) Tj ET\n`;
}

function generarPDF(data: ExportCreditosBody): Buffer {
  const filas = data.filas.length
    ? data.filas
    : [
        {
          fecha: Date.now(),
          cliente: data.cliente,
          deudaPendiente: -data.resumen.deudaPendiente,
        },
      ];
  const rowsPerPage = 28;
  const pages: string[] = [];

  for (let start = 0; start < filas.length; start += rowsPerPage) {
    const parte = filas.slice(start, start + rowsPerPage);
    let y = 790;
    let content = "";
    content += lineaTexto(40, y, "GrifoSys - Creditos por cliente", 16);
    y -= 22;
    content += lineaTexto(40, y, `Cliente: ${data.cliente}`, 11);
    y -= 16;
    if (data.rango?.desde || data.rango?.hasta) {
      content += lineaTexto(40, y, `Periodo: ${data.rango.desde || "inicio"} a ${data.rango.hasta || "hoy"}`, 9);
      y -= 16;
    }
    content += lineaTexto(
      40,
      y,
      `Total creditos: ${soles(data.resumen.totalCreditos)}    Total pagos: ${soles(data.resumen.totalPagos)}    Deuda pendiente: ${soles(data.resumen.deudaPendiente)}`,
      9
    );
    y -= 26;
    content += lineaTexto(40, y, "FECHA", 8);
    content += lineaTexto(95, y, "CLIENTE", 8);
    content += lineaTexto(205, y, "PRODUCTO", 8);
    content += lineaTexto(275, y, "VALE", 8);
    content += lineaTexto(325, y, "PRECIO", 8);
    content += lineaTexto(375, y, "TOTAL CRED.", 8);
    content += lineaTexto(455, y, "PAGOS", 8);
    content += lineaTexto(505, y, "DEUDA", 8);
    y -= 14;

    for (const f of parte) {
      content += lineaTexto(40, y, fechaLocal(f.fecha), 8);
      content += lineaTexto(95, y, f.cliente, 8);
      content += lineaTexto(205, y, f.producto ?? "", 8);
      content += lineaTexto(275, y, f.vale ?? "", 8);
      content += lineaTexto(325, y, f.precio != null ? f.precio.toFixed(2) : "", 8);
      content += lineaTexto(375, y, f.totalCredito != null ? f.totalCredito.toFixed(2) : "", 8);
      content += lineaTexto(455, y, f.pago != null ? f.pago.toFixed(2) : "", 8);
      content += lineaTexto(505, y, f.deudaPendiente.toFixed(2), 8);
      y -= 16;
    }
    pages.push(content);
  }

  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds: number[] = [];
  const contentIds: number[] = [];

  for (const content of pages) {
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`);
    contentIds.push(contentId);
    pageIds.push(0);
  }

  const pagesId = objects.length + pages.length + 1;
  for (let i = 0; i < pages.length; i++) {
    pageIds[i] = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
    );
  }
  addObject(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objects.forEach((obj, index) => {
    offsets[index + 1] = Buffer.byteLength(pdf, "latin1");
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function generarExcel(data: ExportCreditosBody) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("La plantilla de créditos no tiene hojas.");

  const startRow = 3;
  data.filas.forEach((f, i) => {
    const row = ws.getRow(startRow + i);
    row.getCell(2).value = new Date(f.fecha);
    row.getCell(3).value = f.cliente;
    row.getCell(4).value = f.producto ?? "";
    row.getCell(5).value = f.vale ?? "";
    row.getCell(6).value = f.precio ?? null;
    row.getCell(7).value = f.totalCredito ?? null;
    row.getCell(8).value = f.pago ?? null;
    row.getCell(9).value = f.deudaPendiente;
    row.getCell(2).numFmt = "dd/mm/yyyy";
    for (const col of [6, 7, 8, 9]) row.getCell(col).numFmt = "#,##0.00";
    row.commit();
  });

  const totalRow = ws.getRow(startRow + data.filas.length + 1);
  totalRow.getCell(6).value = "TOTAL";
  totalRow.getCell(7).value = data.resumen.totalCreditos;
  totalRow.getCell(8).value = data.resumen.totalPagos;
  totalRow.getCell(9).value = -data.resumen.deudaPendiente;
  for (const col of [7, 8, 9]) totalRow.getCell(col).numFmt = "#,##0.00";
  totalRow.font = { bold: true };
  totalRow.commit();

  return wb.xlsx.writeBuffer();
}

export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as ExportCreditosBody;
    const ext = data.formato === "pdf" ? "pdf" : "xlsx";
    const filename = nombreArchivo(data.cliente, ext);

    if (data.formato === "pdf") {
      const pdf = generarPDF(data);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buffer = await generarExcel(data);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return Response.json(
      { error: "No se pudo generar el reporte de créditos.", detalle: String(e) },
      { status: 500 }
    );
  }
}
