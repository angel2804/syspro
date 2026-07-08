import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import path from "path";
import { requirePermisoDeRequest } from "@/lib/server/supabase-admin";

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

interface ResumenExport {
  totalCreditos: number;
  totalPagos: number;
  deudaPendiente: number;
}

// Una sección = el estado de cuenta de UN cliente (filas + resumen). El export
// de un solo cliente manda una sección; el de "todos" manda varias.
interface SeccionCliente {
  cliente: string;
  filas: FilaCreditoExport[];
  resumen: ResumenExport;
  rango?: { desde?: string; hasta?: string };
}

interface ExportCreditosBody {
  formato: FormatoExport;
  // Export de un solo cliente (retrocompatible):
  cliente?: string;
  filas?: FilaCreditoExport[];
  resumen?: ResumenExport;
  rango?: { desde?: string; hasta?: string };
  // Export de TODOS los clientes (una hoja/sección por cliente):
  clientes?: SeccionCliente[];
}

const TEMPLATE_PATH = () =>
  path.join(process.cwd(), "src/server/templates/creditos.xlsx");

const soles = (n: number) => `S/ ${(n || 0).toFixed(2)}`;
const fechaNombre = () => new Date().toISOString().slice(0, 10);

// Normaliza el cuerpo a una lista de secciones (unifica ambos modos).
function seccionesDe(data: ExportCreditosBody): SeccionCliente[] {
  if (data.clientes && data.clientes.length) return data.clientes;
  return [
    {
      cliente: data.cliente ?? "cliente",
      filas: data.filas ?? [],
      resumen:
        data.resumen ?? { totalCreditos: 0, totalPagos: 0, deudaPendiente: 0 },
      rango: data.rango,
    },
  ];
}

function nombreArchivo(base: string, ext: string) {
  const limpio = base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `${limpio || "creditos"}-${fechaNombre()}.${ext}`;
}

function fechaLocal(ms: number) {
  return new Date(ms).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

// ===========================================================================
// PDF (dibujado a mano). Diseño mejorado: banda de encabezado con color de
// marca, tarjetas de resumen, tabla con cebra + rejilla y numeración de página.
// ===========================================================================

// Colores (RGB 0..1)
const COL = {
  marca: [0.96, 0.62, 0.04], // ámbar (f59e0b)
  marcaOsc: [0.55, 0.31, 0.02],
  tinta: [0.12, 0.16, 0.23], // slate-800 (cabecera de tabla)
  texto: [0.1, 0.12, 0.16],
  suave: [0.42, 0.45, 0.5],
  blanco: [1, 1, 1],
  cebra: [0.965, 0.972, 0.98],
  linea: [0.85, 0.87, 0.9],
  rojo: [0.86, 0.15, 0.15],
  rojoBg: [0.99, 0.93, 0.93],
  verde: [0.09, 0.6, 0.35],
  verdeBg: [0.9, 0.97, 0.93],
  neutroBg: [0.95, 0.96, 0.98],
} as const;

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;

function pdfEscape(s: string) {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

// Ancho aproximado de un texto en Helvetica (para alinear a la derecha).
function anchoTexto(s: string, size: number) {
  return s.length * size * 0.5;
}

interface ColDef {
  key: keyof FilaCreditoExport | "fecha";
  titulo: string;
  x: number; // borde izquierdo
  w: number;
  align: "left" | "right";
}

// Columnas de la tabla (x en puntos desde el borde izquierdo de la página).
const COLS: ColDef[] = [
  { key: "fecha", titulo: "FECHA", x: 40, w: 62, align: "left" },
  { key: "producto", titulo: "PRODUCTO", x: 102, w: 78, align: "left" },
  { key: "vale", titulo: "VALE", x: 180, w: 70, align: "left" },
  { key: "precio", titulo: "PRECIO", x: 250, w: 70, align: "right" },
  { key: "totalCredito", titulo: "TOTAL CRÉDITO", x: 320, w: 90, align: "right" },
  { key: "pago", titulo: "PAGOS", x: 410, w: 60, align: "right" },
  { key: "deudaPendiente", titulo: "DEUDA", x: 470, w: 85, align: "right" },
];
const TABLA_X = MARGIN;
const TABLA_W = PAGE_W - MARGIN * 2;

class PdfDoc {
  private paginas: string[] = [];
  private cur = "";
  y = 0;

  nuevaPagina() {
    if (this.cur) this.paginas.push(this.cur);
    this.cur = "";
    this.y = PAGE_H - MARGIN;
  }

  private op(s: string) {
    this.cur += s + "\n";
  }

  color(rgb: readonly number[], stroke = false) {
    this.op(`${rgb[0]} ${rgb[1]} ${rgb[2]} ${stroke ? "RG" : "rg"}`);
  }

  rect(x: number, y: number, w: number, h: number, fill: readonly number[]) {
    this.color(fill);
    this.op(`${x} ${y} ${w} ${h} re f`);
  }

  linea(x1: number, y1: number, x2: number, y2: number, color = COL.linea, width = 0.6) {
    this.color(color, true);
    this.op(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }

  texto(
    x: number,
    y: number,
    txt: string,
    size = 9,
    color: readonly number[] = COL.texto,
    bold = false
  ) {
    this.color(color);
    this.op(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfEscape(txt)}) Tj ET`);
  }

  textoDer(
    xDer: number,
    y: number,
    txt: string,
    size = 9,
    color: readonly number[] = COL.texto,
    bold = false
  ) {
    this.texto(xDer - anchoTexto(txt, size), y, txt, size, color, bold);
  }

  paginasFinales(): string[] {
    if (this.cur) {
      this.paginas.push(this.cur);
      this.cur = "";
    }
    return this.paginas;
  }
}

function dibujarEncabezadoDoc(d: PdfDoc, titulo: string, subtitulo?: string) {
  // Banda superior de marca
  d.rect(0, PAGE_H - 70, PAGE_W, 70, COL.marca);
  d.rect(0, PAGE_H - 74, PAGE_W, 4, COL.marcaOsc);
  d.texto(MARGIN, PAGE_H - 40, "GrifoSys", 20, COL.blanco, true);
  d.texto(MARGIN, PAGE_H - 58, titulo, 11, COL.blanco);
  const hoy = new Date().toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
  d.textoDer(PAGE_W - MARGIN, PAGE_H - 40, "Generado", 8, COL.blanco);
  d.textoDer(PAGE_W - MARGIN, PAGE_H - 54, hoy, 9, COL.blanco, true);
  d.y = PAGE_H - 92;
  if (subtitulo) {
    d.texto(MARGIN, d.y, subtitulo, 9, COL.suave);
    d.y -= 16;
  }
}

// Tarjetas de resumen (Total créditos / Total pagos / Deuda pendiente).
function dibujarResumen(d: PdfDoc, r: ResumenExport) {
  const gap = 12;
  const w = (TABLA_W - gap * 2) / 3;
  const h = 46;
  const top = d.y;
  const yBox = top - h;
  const deuda = r.deudaPendiente;
  const tarjetas = [
    { label: "TOTAL CRÉDITOS", valor: soles(r.totalCreditos), bg: COL.neutroBg, fg: COL.texto },
    { label: "TOTAL PAGOS", valor: soles(r.totalPagos), bg: COL.verdeBg, fg: COL.verde },
    {
      label: deuda >= 0 ? "DEUDA PENDIENTE" : "SALDO A FAVOR",
      valor: soles(Math.abs(deuda)),
      bg: deuda > 0.005 ? COL.rojoBg : COL.verdeBg,
      fg: deuda > 0.005 ? COL.rojo : COL.verde,
    },
  ];
  tarjetas.forEach((t, i) => {
    const x = TABLA_X + i * (w + gap);
    d.rect(x, yBox, w, h, t.bg);
    d.linea(x, yBox, x + w, yBox, COL.linea, 0.5);
    d.texto(x + 10, yBox + h - 16, t.label, 7.5, COL.suave, true);
    d.texto(x + 10, yBox + 12, t.valor, 15, t.fg, true);
  });
  d.y = yBox - 22;
}

function dibujarCabeceraTabla(d: PdfDoc) {
  const h = 20;
  const top = d.y;
  d.rect(TABLA_X, top - h, TABLA_W, h, COL.tinta);
  for (const c of COLS) {
    if (c.align === "right") d.textoDer(c.x + c.w - 4, top - 14, c.titulo, 7.5, COL.blanco, true);
    else d.texto(c.x + 2, top - 14, c.titulo, 7.5, COL.blanco, true);
  }
  d.y = top - h;
}

function celdaTexto(f: FilaCreditoExport, c: ColDef): string {
  switch (c.key) {
    case "fecha":
      return fechaLocal(f.fecha);
    case "producto":
      return f.producto ?? "";
    case "vale":
      return f.vale ?? "";
    case "precio":
      return f.precio != null ? f.precio.toFixed(2) : "";
    case "totalCredito":
      return f.totalCredito != null ? f.totalCredito.toFixed(2) : "";
    case "pago":
      return f.pago != null ? f.pago.toFixed(2) : "";
    case "deudaPendiente":
      return f.deudaPendiente.toFixed(2);
    default:
      return "";
  }
}

const FILA_H = 16;

function dibujarSeccion(d: PdfDoc, sec: SeccionCliente, indiceGlobal: { paginas: number }) {
  d.nuevaPagina();
  indiceGlobal.paginas++;
  dibujarEncabezadoDoc(
    d,
    "Estado de cuenta por cliente",
    sec.rango?.desde || sec.rango?.hasta
      ? `Periodo: ${sec.rango?.desde || "inicio"} a ${sec.rango?.hasta || "hoy"}`
      : undefined
  );
  // Nombre del cliente destacado
  d.texto(MARGIN, d.y, sec.cliente, 16, COL.texto, true);
  d.y -= 24;
  dibujarResumen(d, sec.resumen);
  dibujarCabeceraTabla(d);

  const filas = sec.filas.length
    ? sec.filas
    : [
        {
          fecha: Date.now(),
          cliente: sec.cliente,
          deudaPendiente: sec.resumen.deudaPendiente,
        } as FilaCreditoExport,
      ];

  filas.forEach((f, i) => {
    if (d.y - FILA_H < MARGIN + 30) {
      d.nuevaPagina();
      indiceGlobal.paginas++;
      d.y = PAGE_H - MARGIN;
      d.texto(MARGIN, d.y, `${sec.cliente} (continuación)`, 11, COL.suave, true);
      d.y -= 20;
      dibujarCabeceraTabla(d);
    }
    const top = d.y;
    if (i % 2 === 1) d.rect(TABLA_X, top - FILA_H, TABLA_W, FILA_H, COL.cebra);
    for (const c of COLS) {
      const txt = celdaTexto(f, c);
      if (!txt) continue;
      let color: readonly number[] = COL.texto;
      if (c.key === "pago") color = COL.verde;
      if (c.key === "deudaPendiente")
        color = f.deudaPendiente < -0.005 ? COL.rojo : f.deudaPendiente > 0.005 ? COL.marcaOsc : COL.texto;
      const bold = c.key === "deudaPendiente";
      const yTxt = top - 11;
      if (c.align === "right") d.textoDer(c.x + c.w - 4, yTxt, txt, 8, color, bold);
      else d.texto(c.x + 2, yTxt, txt, 8, color, bold);
    }
    d.linea(TABLA_X, top - FILA_H, TABLA_X + TABLA_W, top - FILA_H, COL.linea, 0.4);
    d.y = top - FILA_H;
  });

  // Fila de totales
  const top = d.y;
  const h = 20;
  d.rect(TABLA_X, top - h, TABLA_W, h, COL.neutroBg);
  d.texto(COLS[0].x + 2, top - 14, "TOTAL", 8, COL.texto, true);
  const colTotalCred = COLS.find((c) => c.key === "totalCredito")!;
  const colPagos = COLS.find((c) => c.key === "pago")!;
  const colDeuda = COLS.find((c) => c.key === "deudaPendiente")!;
  d.textoDer(colTotalCred.x + colTotalCred.w - 4, top - 14, sec.resumen.totalCreditos.toFixed(2), 8, COL.texto, true);
  d.textoDer(colPagos.x + colPagos.w - 4, top - 14, sec.resumen.totalPagos.toFixed(2), 8, COL.verde, true);
  d.textoDer(
    colDeuda.x + colDeuda.w - 4,
    top - 14,
    (-sec.resumen.deudaPendiente).toFixed(2),
    8,
    sec.resumen.deudaPendiente > 0.005 ? COL.rojo : COL.texto,
    true
  );
  d.y = top - h;
}

function generarPDF(secciones: SeccionCliente[]): Buffer {
  const d = new PdfDoc();
  const idx = { paginas: 0 };
  for (const sec of secciones) dibujarSeccion(d, sec, idx);

  const contenidos = d.paginasFinales();

  // Pie de página con numeración (se añade a cada página ya generada).
  const total = contenidos.length;
  const conPie = contenidos.map((c, i) => {
    let pie = "";
    pie += `${COL.suave[0]} ${COL.suave[1]} ${COL.suave[2]} rg\n`;
    pie += `BT /F1 8 Tf ${MARGIN} 26 Td (${pdfEscape(`GrifoSys · Créditos por cliente`)}) Tj ET\n`;
    const num = `Página ${i + 1} de ${total}`;
    pie += `BT /F1 8 Tf ${PAGE_W - MARGIN - anchoTexto(num, 8)} 26 Td (${pdfEscape(num)}) Tj ET\n`;
    pie += `${COL.linea[0]} ${COL.linea[1]} ${COL.linea[2]} RG\n0.6 w ${MARGIN} 38 m ${PAGE_W - MARGIN} 38 l S\n`;
    return c + pie;
  });

  // ---- Ensamblado del PDF ----
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const f1 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const f2 = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const contentIds: number[] = [];
  const pageIds: number[] = [];
  for (const content of conPie) {
    contentIds.push(
      addObject(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`)
    );
    pageIds.push(0);
  }
  const pagesId = objects.length + conPie.length + 1;
  for (let i = 0; i < conPie.length; i++) {
    pageIds[i] = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentIds[i]} 0 R >>`
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

// ===========================================================================
// Excel
// ===========================================================================

// Estilo de cabecera capturado de la plantilla (para que las hojas nuevas del
// export "todos" luzcan igual que la plantilla original).
interface EstiloCabecera {
  fill?: ExcelJS.Fill;
  font?: Partial<ExcelJS.Font>;
  border?: Partial<ExcelJS.Borders>;
  anchos: (number | undefined)[];
}

async function cargarPlantilla(): Promise<{ wb: ExcelJS.Workbook; estilo: EstiloCabecera }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH());
  const ws = wb.worksheets[0];
  const hdr = ws.getRow(2).getCell(2);
  const estilo: EstiloCabecera = {
    fill: hdr.fill as ExcelJS.Fill,
    font: hdr.font as Partial<ExcelJS.Font>,
    border: hdr.border as Partial<ExcelJS.Borders>,
    anchos: ws.columns.map((c) => c.width),
  };
  return { wb, estilo };
}

// Export de UN cliente: usa la plantilla tal cual (comportamiento original).
async function generarExcelUnCliente(sec: SeccionCliente) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("La plantilla de créditos no tiene hojas.");
  llenarHojaCliente(ws, sec, 3);
  return wb.xlsx.writeBuffer();
}

// Nombres de hoja únicos y válidos para Excel (máx 31, sin \ / ? * [ ] :).
function nombreHojaUnico(nombre: string, usados: Set<string>): string {
  const base = (nombre || "Cliente").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Cliente";
  let n = base;
  let i = 2;
  while (usados.has(n.toLowerCase())) {
    const suf = ` (${i})`;
    n = base.slice(0, 31 - suf.length) + suf;
    i++;
  }
  usados.add(n.toLowerCase());
  return n;
}

// Escribe la tabla de un cliente en una hoja a partir de `startRow` (fila de la
// primera fila de datos; se asume que la cabecera está en startRow-1).
function llenarHojaCliente(ws: ExcelJS.Worksheet, sec: SeccionCliente, startRow: number) {
  sec.filas.forEach((f, i) => {
    const row = ws.getRow(startRow + i);
    row.getCell(2).value = new Date(f.fecha);
    row.getCell(3).value = f.cliente ?? sec.cliente;
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
  const totalRow = ws.getRow(startRow + sec.filas.length + 1);
  totalRow.getCell(6).value = "TOTAL";
  totalRow.getCell(7).value = sec.resumen.totalCreditos;
  totalRow.getCell(8).value = sec.resumen.totalPagos;
  totalRow.getCell(9).value = -sec.resumen.deudaPendiente;
  for (const col of [7, 8, 9]) totalRow.getCell(col).numFmt = "#,##0.00";
  totalRow.font = { bold: true };
  totalRow.commit();
}

// Export de TODOS los clientes: una hoja por cliente, con el nombre del cliente
// como nombre de pestaña, replicando el estilo de la plantilla.
async function generarExcelTodos(secciones: SeccionCliente[]) {
  const { estilo } = await cargarPlantilla();
  const out = new ExcelJS.Workbook();
  out.creator = "GrifoSys";
  const usados = new Set<string>();
  const CABECERAS = ["FECHA", "CLIENTE", "PRODUCTO", "VALE", "PRECIO", "TOTAL CREDITO", "PAGOS", "DEUDA PENDIENTE"];

  for (const sec of secciones) {
    const ws = out.addWorksheet(nombreHojaUnico(sec.cliente, usados), {
      views: [{ state: "frozen", ySplit: 2 }],
    });
    // Anchos de columna como la plantilla (B..I).
    estilo.anchos.forEach((w, idx) => {
      if (w) ws.getColumn(idx + 1).width = w;
    });
    // Fila 1: título con el cliente.
    ws.mergeCells(1, 2, 1, 9);
    const titulo = ws.getCell(1, 2);
    titulo.value = `Estado de cuenta — ${sec.cliente}`;
    titulo.font = { bold: true, size: 13 };
    // Fila 2: cabecera con el estilo de la plantilla.
    const hdr = ws.getRow(2);
    CABECERAS.forEach((txt, i) => {
      const cell = hdr.getCell(i + 2);
      cell.value = txt;
      if (estilo.fill) cell.fill = estilo.fill;
      if (estilo.font) cell.font = estilo.font;
      if (estilo.border) cell.border = estilo.border;
    });
    hdr.commit();
    // Datos desde la fila 3.
    llenarHojaCliente(ws, sec, 3);
  }
  return out.xlsx.writeBuffer();
}

export async function POST(req: NextRequest) {
  try {
    try {
      await requirePermisoDeRequest(req, "exportar");
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 403 });
    }
    const data = (await req.json()) as ExportCreditosBody;
    const secciones = seccionesDe(data);
    const esTodos = !!(data.clientes && data.clientes.length);
    const ext = data.formato === "pdf" ? "pdf" : "xlsx";
    const base = esTodos ? "creditos-todos-los-clientes" : `creditos-${secciones[0]?.cliente ?? "cliente"}`;
    const filename = nombreArchivo(base, ext);

    if (data.formato === "pdf") {
      const pdf = generarPDF(secciones);
      return new Response(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const buffer = esTodos
      ? await generarExcelTodos(secciones)
      : await generarExcelUnCliente(secciones[0]);
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
