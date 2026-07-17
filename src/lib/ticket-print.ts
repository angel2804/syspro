"use client";

export function imprimirTicket80mm(ticketHtml: string, titulo = "Resumen de turno") {
  if (typeof document === "undefined" || !ticketHtml.trim()) return;

  const frame = document.createElement("iframe");
  frame.setAttribute("title", titulo);
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return;
  }

  doc.open();
  doc.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(titulo)}</title>
  <style>
    @page { size: 80mm 160mm; margin: 3mm; }
    html, body {
      margin: 0;
      padding: 0;
      width: 74mm;
      min-width: 74mm;
      max-width: 74mm;
      height: auto;
      background: #fff;
      color: #000;
      overflow: hidden;
    }
    body {
      font-family: Arial, "Helvetica Neue", sans-serif;
      font-size: 11px;
      line-height: 1.16;
    }
    .ticket-80mm, .admin-ticket-80mm {
      width: 74mm;
      box-sizing: border-box;
      color: #000;
      background: #fff;
      padding: 0;
    }
    h1, h2, h3, p { margin: 0; }
    h1 {
      text-align: center;
      font-size: 16px;
      font-weight: 900;
      line-height: 1.05;
    }
    h2 {
      margin-top: 3px;
      text-align: center;
      font-size: 12px;
      font-weight: 900;
      line-height: 1.1;
    }
    h3 {
      margin: 5px 0 3px;
      text-align: center;
      font-size: 12px;
      font-weight: 900;
    }
    .ticket-block { margin-top: 6px; }
    .ticket-line, .ticket-money, .ticket-row {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      min-height: 13px;
    }
    .ticket-line span:first-child,
    .ticket-money span:first-child {
      font-weight: 800;
      white-space: nowrap;
    }
    .ticket-line span:last-child,
    .ticket-money span:last-child,
    .ticket-row span:last-child {
      text-align: right;
    }
    .ticket-sep {
      margin: 5px 0;
      border-top: 1px solid #000;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 2px 0;
      text-align: right;
      vertical-align: top;
      border-bottom: 1px solid #000;
    }
    th:first-child, td:first-child {
      width: 48%;
      text-align: left;
      overflow-wrap: anywhere;
    }
    th { font-weight: 900; }
    .ticket-strong { font-weight: 900; }
    .ticket-signatures {
      margin-top: 10px;
      display: grid;
      gap: 8px;
      font-weight: 700;
    }
    .ticket-thanks {
      margin-top: 8px;
      text-align: center;
      font-weight: 900;
    }
  </style>
</head>
<body>${ticketHtml}</body>
</html>`);
  doc.close();

  setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  }, 80);
}

export function abrirTicketPdf80mm(ticketHtml: string, titulo = "ticket-80mm") {
  if (typeof document === "undefined" || !ticketHtml.trim()) return;
  const pdf = crearPdfTicket80mm(ticketHtml, titulo);
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function crearPdfTicket80mm(ticketHtml: string, titulo: string) {
  const root = document.createElement("div");
  root.innerHTML = ticketHtml;
  const ticket = root.querySelector(".ticket-80mm, .admin-ticket-80mm") ?? root;

  const pageW = mm(80);
  const pageH = mm(160);
  const margin = mm(5);
  let y = pageH - margin;
  const ops: string[] = ["0 0 0 rg", "0.7 w"];

  const text = (value: string, x: number, yy: number, size = 8, bold = false) => {
    ops.push(
      `BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td <${pdfHexText(
        value
      )}> Tj ET`
    );
  };
  const center = (value: string, yy: number, size = 10, bold = true) => {
    const approx = value.length * size * 0.48;
    text(value, Math.max(margin, (pageW - approx) / 2), yy, size, bold);
  };
  const right = (value: string, yy: number, size = 7, bold = false) => {
    const approx = value.length * size * 0.48;
    text(value, pageW - margin - approx, yy, size, bold);
  };
  const line = () => {
    y -= 4;
    ops.push(`${margin.toFixed(2)} ${y.toFixed(2)} m ${(pageW - margin).toFixed(2)} ${y.toFixed(2)} l S`);
    y -= 9;
  };

  const h1 = clean(ticket.querySelector("h1")?.textContent);
  const h2 = clean(ticket.querySelector("h2")?.textContent);
  if (h1) {
    center(h1, y, 11, true);
    y -= 12;
  }
  if (h2) {
    center(h2, y, 8.5, true);
    y -= 12;
  }

  ticket.querySelectorAll(".ticket-block .ticket-line, .ticket-block .ticket-row").forEach((row) => {
    const parts = Array.from(row.querySelectorAll("span")).map((s) => clean(s.textContent));
    if (parts.length >= 2) {
      text(parts[0], margin, y, 7.2, true);
      right(parts.slice(1).join(" "), y, 7.2);
      y -= 9;
    }
  });

  const headings = Array.from(ticket.querySelectorAll("h3"));
  const tables = Array.from(ticket.querySelectorAll("table"));
  tables.forEach((table, i) => {
    line();
    const heading = clean(headings[i]?.textContent);
    if (heading) {
      center(heading, y, 8, true);
      y -= 10;
    }
    const rows = Array.from(table.querySelectorAll("tr"));
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.querySelectorAll("th,td")).map((c) => clean(c.textContent));
      if (cells.length === 0) return;
      text(cells[0], margin, y, 7.2, rowIndex === 0);
      right(cells[cells.length - 1], y, 7.2, rowIndex === 0);
      y -= 9;
    });
  });

  line();
  const resumenHeading = headings[tables.length];
  if (resumenHeading) {
    center(clean(resumenHeading.textContent), y, 8, true);
    y -= 10;
  }
  ticket.querySelectorAll(".ticket-money").forEach((row) => {
    const parts = Array.from(row.querySelectorAll("span")).map((s) => clean(s.textContent));
    if (parts.length >= 2) {
      const bold = row.classList.contains("ticket-strong");
      text(parts[0], margin, y, 7.2, bold);
      right(parts[1], y, 7.2, bold);
      y -= 8.5;
    }
  });

  y -= 8;
  ticket.querySelectorAll(".ticket-signatures div").forEach((row) => {
    text(clean(row.textContent), margin, y, 7.2, false);
    y -= 12;
  });
  const thanks = clean(ticket.querySelector(".ticket-thanks")?.textContent);
  if (thanks) center(thanks, y, 8, true);

  const stream = ops.join("\n");
  return pdfDocument([
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    `2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj`,
    `3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(
      2
    )} ${pageH.toFixed(2)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj`,
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj",
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> endobj",
    `6 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`,
  ], titulo);
}

function pdfDocument(objects: string[], titulo: string) {
  const chunks = ["%PDF-1.4\n% ticket\n"];
  const offsets: number[] = [0];
  let cursor = chunks[0].length;
  for (const obj of objects) {
    offsets.push(cursor);
    chunks.push(obj + "\n");
    cursor += obj.length + 1;
  }
  const xref = cursor;
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= objects.length; i++) {
    chunks.push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(
    `trailer << /Size ${objects.length + 1} /Root 1 0 R /Info << /Title (${pdfText(
      titulo
    )}) >> >>\nstartxref\n${xref}\n%%EOF`
  );
  return chunks.join("");
}

function mm(n: number) {
  return (n * 72) / 25.4;
}

function clean(s?: string | null) {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function pdfText(s: string) {
  return s.replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7E]/g, "");
}

function pdfHexText(s: string) {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    bytes.push(code <= 0xff ? code : 0x20);
  }
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
