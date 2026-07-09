// Generación de PDF del ESTADO DE CUENTA por impresión nativa del navegador
// (sin dependencias externas): se abre una ventana con el documento maquetado y
// se dispara `print()`, donde el usuario elige "Guardar como PDF" o imprime.
// Mantiene el Excel/CSV existentes; esto es el formato imprimible de Fase 6.
import { PRODUCTOS } from "./config";
import { formatoSaldo, type FilaEstadoCuenta, type ResumenCliente } from "./domain/cuenta-corriente";

const soles = (n: number) => "S/ " + (n || 0).toFixed(2);

function fechaCorta(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface OpcionesPDF {
  nombreCliente: string;
  filas: FilaEstadoCuenta[];
  resumen: ResumenCliente;
  empresa?: string;
  rango?: { desde?: string; hasta?: string };
}

// Construye el HTML del estado de cuenta (exportado aparte para poder testear/
// reutilizar la maqueta sin abrir una ventana).
export function htmlEstadoCuenta(o: OpcionesPDF): string {
  const { nombreCliente, filas, resumen, empresa = "Tanko", rango } = o;
  const filasHtml = filas
    .map((f) => {
      const prod = f.producto ? PRODUCTOS[f.producto] : "";
      const deudaNeg = f.saldoAcumulado < 0;
      return `<tr>
        <td>${fechaCorta(f.fecha)}</td>
        <td class="r">${f.galones != null ? f.galones.toFixed(3) : ""}</td>
        <td>${esc(prod)}</td>
        <td>${f.vale ? esc(f.vale) : ""}</td>
        <td class="r">${f.precio != null ? soles(f.precio) : ""}</td>
        <td class="r">${f.totalCredito != null ? soles(f.totalCredito) : ""}</td>
        <td class="r">${f.pago != null ? soles(f.pago) : ""}</td>
        <td class="r ${deudaNeg ? "neg" : "pos"}">${formatoSaldo(f.saldoAcumulado)}</td>
      </tr>`;
    })
    .join("");

  const periodo =
    rango && (rango.desde || rango.hasta)
      ? `<p class="sub">Periodo: ${esc(rango.desde || "inicio")} – ${esc(rango.hasta || "hoy")}</p>`
      : "";

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>Estado de cuenta — ${esc(nombreCliente)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, Arial, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 12px 0 2px; }
  .sub { color: #555; font-size: 12px; margin: 0 0 2px; }
  .resumen { display: flex; gap: 24px; margin: 12px 0 16px; }
  .resumen div { font-size: 13px; }
  .resumen b { display: block; font-size: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 5px 7px; text-align: left; }
  th { background: #f2f2f2; }
  td.r, th.r { text-align: right; }
  .neg { color: #b00020; font-weight: 600; }
  .pos { color: #067d3a; font-weight: 600; }
  .foot { margin-top: 16px; color: #888; font-size: 11px; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>${esc(empresa)}</h1>
  <h2>Estado de cuenta — ${esc(nombreCliente)}</h2>
  ${periodo}
  <div class="resumen">
    <div>Total créditos <b>${soles(resumen.totalCreditos)}</b></div>
    <div>Total pagos <b>${soles(resumen.totalPagos)}</b></div>
    <div>Deuda pendiente <b class="${resumen.deudaPendiente > 0 ? "neg" : "pos"}">${formatoSaldo(-resumen.deudaPendiente)}</b></div>
  </div>
  <table>
    <thead><tr>
      <th>Fecha</th><th class="r">Galones</th><th>Producto</th><th>Vale</th>
      <th class="r">Precio</th><th class="r">Total crédito</th><th class="r">Pago</th><th class="r">Deuda</th>
    </tr></thead>
    <tbody>${filasHtml || `<tr><td colspan="8" style="text-align:center;color:#888">Sin movimientos</td></tr>`}</tbody>
  </table>
  <p class="foot">Generado el ${fechaCorta(Date.now())}</p>
</body></html>`;
}

// Abre una ventana con el documento y lanza la impresión (Guardar como PDF).
// Devuelve false si el navegador bloqueó el popup (para avisar al usuario).
export function imprimirEstadoCuenta(o: OpcionesPDF): boolean {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return false; // el navegador bloqueó el popup
  win.document.open();
  win.document.write(htmlEstadoCuenta(o));
  win.document.close();
  win.focus();
  // `document.write` no dispara `onload` de forma fiable en todos los
  // navegadores; se imprime tras un pequeño margen para que el contenido pinte.
  setTimeout(() => {
    try {
      win.print();
    } catch {
      /* la ventana pudo cerrarse antes de imprimir */
    }
  }, 300);
  return true;
}
