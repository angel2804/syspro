// Lógica compartida para llenar las plantillas Excel del sistema. La usan:
//  - /api/export-isla  → una hoja "plantilla-isla" (por turno o por isla)
//  - /api/export-general → un libro con 4 hojas: Mañana, Tarde, Noche (formato
//    plantilla-isla) + Madre (formato madre)
//
// Extraído para que las hojas del reporte general salgan IDÉNTICAS a los
// exports individuales (mismo código, sin duplicar).
import ExcelJS from "exceljs";
import { calcularReporteDia, ORDEN_TURNO, preciosDe } from "@/lib/calc";
import { ISLAS } from "@/lib/config";
import type { MetodoPago, Precios, ProductoId, Sesion, TurnoId } from "@/lib/types";

const r2 = (n: number) => Math.round(n * 100) / 100;

// ===========================================================================
// HOJA ODOMETROS (generada sin plantilla)
// ===========================================================================

// Bloques de la plantilla ODOMETROS (odometros.xlsx). Cada isla física se
// divide en sub-bloques de 4 mangueras (ISLA I..V), tal como la plantilla del
// usuario. Cada bloque ocupa 4 filas a partir de `filaInicio`, en el orden:
// BIO-A, BIO-B, G-REGULAR, G-PREMIUM (la isla GLP: sus 4 mangueras).
const ODO_BLOQUES: { filaInicio: number; mangueras: string[] }[] = [
  { filaInicio: 7, mangueras: ["i1_bio1a", "i1_bio1b", "i1_reg1", "i1_prem1"] },
  { filaInicio: 15, mangueras: ["i1_bio2a", "i1_bio2b", "i1_reg2", "i1_prem2"] },
  { filaInicio: 23, mangueras: ["i2_bio3a", "i2_bio3b", "i2_reg3", "i2_prem3"] },
  { filaInicio: 31, mangueras: ["i2_bio4a", "i2_bio4b", "i2_reg4", "i2_prem4"] },
  { filaInicio: 39, mangueras: ["i3_glp_a1", "i3_glp_a2", "i3_glp_b1", "i3_glp_b2"] },
];

// Llena la hoja "ODOMETROS" sobre la plantilla odometros.xlsx. Por cada
// manguera escribe INGRESO (entrada mañana), SALIDA (salida noche) y GLNS
// (galones del día). Los TOTAL (col F): por bloque líquido = suma de las dos
// mangueras BIO; en el bloque ISLA IV además el total general de G-REGULAR y
// G-PREMIUM; en el bloque GLP = suma de sus 4 mangueras.
export function llenarHojaOdometros(
  ws: ExcelJS.Worksheet,
  sesiones: Sesion[],
  dia: string,
  precios: Precios
): void {
  const rep = calcularReporteDia(sesiones, dia, precios);

  // Odómetro continuo por manguera: entrada del primer tramo, salida del
  // último, galones = suma de tramos (consistente con calcularReporteDia).
  const odoPorManguera = new Map<
    string,
    { inicio: number; final: number; galones: number }
  >();
  for (const o of rep.odometros) {
    const ex = odoPorManguera.get(o.mangueraId);
    if (ex) {
      ex.final = o.final;
      ex.galones += o.galones;
    } else {
      odoPorManguera.set(o.mangueraId, {
        inicio: o.inicio,
        final: o.final,
        galones: o.galones,
      });
    }
  }
  const galDe = (id: string) => odoPorManguera.get(id)?.galones ?? 0;

  ws.getCell("B2").value = `GENERAL — ${dia}`;

  // Anchos que permiten ver los números completos (evita "#####").
  ws.getColumn("B").width = 13;
  ws.getColumn("C").width = 16;
  ws.getColumn("D").width = 16;
  ws.getColumn("E").width = 12;
  ws.getColumn("F").width = 12;

  // BIO en gris claro (solo la celda de producto de las filas BIO).
  const pintarGris = (addr: string) => {
    ws.getCell(addr).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFBFBFBF" },
    };
  };

  let grandRegular = 0;
  let grandPremium = 0;

  for (const bloque of ODO_BLOQUES) {
    bloque.mangueras.forEach((id, i) => {
      const fila = bloque.filaInicio + i;
      const o = odoPorManguera.get(id) ?? { inicio: 0, final: 0, galones: 0 };
      ws.getCell(`C${fila}`).value = o.inicio;
      ws.getCell(`D${fila}`).value = o.final;
      const gal = ws.getCell(`E${fila}`);
      gal.value = r2(o.galones);
      gal.numFmt = "0.000";
    });

    const esGlp = bloque.mangueras[0].startsWith("i3_");
    if (!esGlp) {
      // Las dos primeras filas del bloque líquido son BIO.
      pintarGris(`B${bloque.filaInicio}`);
      pintarGris(`B${bloque.filaInicio + 1}`);
    }
    if (esGlp) {
      // Total GLP = suma de las 4 mangueras (merge F39:F42).
      const total = bloque.mangueras.reduce((a, id) => a + galDe(id), 0);
      const f = ws.getCell(`F${bloque.filaInicio}`);
      f.value = r2(total);
      f.numFmt = "0.00";
    } else {
      // Total del bloque líquido = BIO-A + BIO-B (merge F<inicio>:F<inicio+1>).
      const bioTotal = galDe(bloque.mangueras[0]) + galDe(bloque.mangueras[1]);
      const f = ws.getCell(`F${bloque.filaInicio}`);
      f.value = r2(bioTotal);
      f.numFmt = "0.00";
      pintarGris(`F${bloque.filaInicio}`); // total BIO con el mismo gris
      grandRegular += galDe(bloque.mangueras[2]);
      grandPremium += galDe(bloque.mangueras[3]);
    }
  }

  // Totales generales de G-REGULAR y G-PREMIUM (todas las islas líquidas),
  // ubicados en el bloque ISLA IV: F33 (regular) y F34 (premium).
  const fReg = ws.getCell("F33");
  fReg.value = r2(grandRegular);
  fReg.numFmt = "0.00";
  const fPrem = ws.getCell("F34");
  fPrem.value = r2(grandPremium);
  fPrem.numFmt = "0.00";
}

// Cómo se muestra cada método de pago en el Excel (el método "culqui" se
// rotula "YAPE CULQUI").
const METODO_LABEL: Record<MetodoPago, string> = {
  yape: "YAPE",
  transferencia: "TRANSFERENCIA",
  visa: "VISA",
  culqui: "VISA YQ",
};
const EPS = 0.01;

// ===========================================================================
// HOJA MADRE (plantilla madre.xlsx)
// ===========================================================================

// Orden de las 4 columnas de producto en la plantilla: BIO-DIESEL, G-R, G-P, GLP
const PRODUCTO_COLS: { producto: ProductoId; col: string; puCol: string }[] = [
  { producto: "bio", col: "D", puCol: "E" },
  { producto: "regular", col: "F", puCol: "G" },
  { producto: "premium", col: "H", puCol: "I" },
  { producto: "glp", col: "J", puCol: "K" },
];

const MESES = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE",
];

function fechaTitulo(dia: string): string {
  const [y, m, d] = dia.split("-").map(Number);
  return `VENTA. DEL DIA ${d} ${MESES[m - 1]} ${y}`;
}

// Formato de moneda nativo de Excel: muestra "S/ 1,234.56", "-S/ 1,234.56"
// para negativos y "S/ -" para el cero. Al guardar el valor como NÚMERO con
// este numFmt (en lugar de un string "S/ ..."), Excel ya no marca el aviso de
// "número almacenado como texto".
const SOLES_FMT = '"S/ "#,##0.00;-"S/ "#,##0.00;"S/ -"';

// Llena UNA hoja con el formato "madre" para el conjunto de sesiones dado.
// Exporta siempre con lo que haya, sin validaciones.
export function llenarHojaMadre(
  ws: ExcelJS.Worksheet,
  sesiones: Sesion[],
  dia: string,
  precios: Precios
): void {
  const rep = calcularReporteDia(sesiones, dia, precios);

  // Cada descuento carga el precio normal de SU turno (para el ahorro/galón).
  const descuentos = sesiones.flatMap((s) =>
    s.descuentos.map((d) => ({ ...d, _precio: preciosDe(s, precios)[d.producto] ?? 0 }))
  );
  const creditos = sesiones.flatMap((s) => s.creditos);
  const promociones = sesiones.flatMap((s) => s.promociones);
  const todosPagos = sesiones.flatMap((s) => s.pagos);
  const adelantos = sesiones.flatMap((s) => s.adelantos);

  const galonesPorProducto = (p: ProductoId) =>
    rep.porProducto.find((f) => f.producto === p)?.galones ?? 0;
  // Venta del producto valuada por TRAMOS de precio (correcta aunque el precio
  // haya cambiado a media jornada). La toten = venta odómetro − créditos −
  // promos, cada parte a su precio de turno.
  const ventaOdometro = (p: ProductoId) =>
    rep.porProducto.find((f) => f.producto === p)?.venta ?? 0;
  const ventaCreditoPorProducto = (p: ProductoId) =>
    sesiones.reduce(
      (a, s) =>
        a +
        s.creditos
          .filter((c) => c.producto === p)
          .reduce((x, c) => x + c.galones * (preciosDe(s, precios)[p] ?? 0), 0),
      0
    );
  const ventaPromoPorProducto = (p: ProductoId) =>
    sesiones.reduce(
      (a, s) =>
        a +
        s.promociones
          .filter((x) => x.producto === p)
          .reduce((y, x) => y + x.galones * (preciosDe(s, precios)[p] ?? 0), 0),
      0
    );
  // Precio representativo a mostrar en celdas de PU: el del turno más reciente
  // que vendió ese producto (tras un cambio a las 2pm, el precio nuevo).
  const precioRep = (p: ProductoId): number => {
    for (const t of [...ORDEN_TURNO].reverse()) {
      const s = sesiones.find((x) => x.turno === t);
      if (s) return preciosDe(s, precios)[p] ?? 0;
    }
    return precios[p] ?? 0;
  };
  const galonesCreditoPorProducto = (p: ProductoId) =>
    creditos.filter((c) => c.producto === p).reduce((a, c) => a + c.galones, 0);
  const galonesPromoPorProducto = (p: ProductoId) =>
    promociones.filter((x) => x.producto === p).reduce((a, x) => a + x.galones, 0);
  const sumaPagos = (metodo: string) =>
    todosPagos.filter((p) => p.metodo === metodo).reduce((a, p) => a + p.monto, 0);

  // Escribe un monto como número con formato de moneda (ver SOLES_FMT).
  const setSoles = (addr: string, n: number) => {
    const c = ws.getCell(addr);
    c.value = n;
    c.numFmt = SOLES_FMT;
  };

  // La plantilla original trae datos de muestra (clientes, vales, montos
  // reales de un día anterior) en TODAS las filas de Descuentos (7-18) y
  // Créditos (20-36), no solo en las que tengan datos nuevos. Hay que
  // limpiarlas todas antes de escribir, o se filtran al reporte final.
  const COLS_RANGO = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"];
  function limpiarRango(filaIni: number, filaFin: number) {
    for (let f = filaIni; f <= filaFin; f++) {
      for (const col of COLS_RANGO) ws.getCell(`${col}${f}`).value = null;
    }
  }
  limpiarRango(7, 18);
  limpiarRango(20, 36);

  // --- Filas extra necesarias (huecos fijos: descuentos 12, créditos 17, promos 0) ---
  const extraDescuentos = Math.max(0, descuentos.length - 12);
  const extraCreditos = Math.max(0, creditos.length - 17);
  const extraPromos = promociones.length; // sin huecos reservados

  // Las filas 18 y 36 ya están en blanco (recién limpiadas), así que al
  // duplicarlas para el overflow, las copias también nacen en blanco.
  if (extraDescuentos > 0) ws.duplicateRow(18, extraDescuentos, true);
  if (extraCreditos > 0) ws.duplicateRow(36 + extraDescuentos, extraCreditos, true);

  // Promociones no tiene fila de datos propia para duplicar (el título
  // está justo encima del total). Se duplica el título solo para fijar la
  // posición de inserción, y luego se limpia el contenido y se le copia
  // el estilo de una fila de datos en blanco (créditos) para que no se
  // vea como un título repetido.
  if (extraPromos > 0) {
    const filaTitulo = 37 + extraDescuentos + extraCreditos;
    const filaEstilo = 20 + extraDescuentos; // primera fila de créditos, ya en blanco
    ws.duplicateRow(filaTitulo, extraPromos, true);
    for (let i = 0; i < extraPromos; i++) {
      const f = filaTitulo + 1 + i;
      for (const col of COLS_RANGO) {
        const destino = ws.getCell(`${col}${f}`);
        destino.value = null;
        destino.style = ws.getCell(`${col}${filaEstilo}`).style;
      }
    }
  }

  // Pagos adelantados: ocupan las filas 50..53 (4 huecos, donde antes estaba
  // "SE DEVUELVE ACOPLE"). Si hay más de 4, se insertan filas extra tras la 53.
  const extraAdelantos = Math.max(0, adelantos.length - 4);

  // Mapea un número de fila ORIGINAL de la plantilla a su posición final tras
  // todas las inserciones. Siempre se inserta 1 fila para "YAPE CULQUI" tras
  // YAPE (59); las filas 54+ además se corren por los adelantos extra.
  function mapRow(original: number): number {
    let r = original;
    if (original >= 19) r += extraDescuentos;
    if (original >= 37) r += extraCreditos;
    if (original >= 38) r += extraPromos;
    if (original >= 54) r += extraAdelantos; // filas extra de adelantos (tras 53)
    if (original >= 60) r += 1; // fila YAPE CULQUI insertada tras YAPE (59)
    return r;
  }

  // Inserta físicamente las filas extra de adelantos (clonando la 53, en
  // blanco) y luego la fila YAPE CULQUI (clonando YAPE, hereda su estilo). Las
  // etiquetas y montos se escriben más abajo.
  if (extraAdelantos > 0) ws.duplicateRow(mapRow(53), extraAdelantos, true);
  const filaYapeCulqui = mapRow(59) + 1;
  ws.duplicateRow(mapRow(59), 1, true);

  // --- Encabezado ---
  ws.getCell("B3").value = fechaTitulo(dia);
  for (const { producto, col } of PRODUCTO_COLS) {
    setSoles(`${col}1`, precioRep(producto));
    ws.getCell(`${col}2`).value = galonesPorProducto(producto);
  }
  ws.getCell("M2").value = rep.totalAdelantos || null;

  // --- DESCUENTOS (filas 7..18, o más si hubo overflow) ---
  let r = 7;
  for (const d of descuentos) {
    const grupo = PRODUCTO_COLS.find((g) => g.producto === d.producto);
    if (!grupo) continue;
    const descuentoPorGalon = Math.max(0, d._precio - d.precioDescuento);
    ws.getCell(`B${r}`).value = d.cliente || "";
    ws.getCell(`${grupo.col}${r}`).value = d.galones;
    ws.getCell(`${grupo.puCol}${r}`).value = descuentoPorGalon;
    r++;
  }

  // --- CREDITOS (filas 20..36, o más) ---
  // Se agrupan por cliente para que todos sus créditos salgan juntos, y los
  // grupos se ordenan por cantidad de créditos (de mayor a menor): primero el
  // cliente con más nombres, luego el siguiente, etc. Dentro de cada grupo se
  // conserva el orden original.
  const conteoCliente = new Map<string, number>();
  for (const c of creditos) {
    conteoCliente.set(c.cliente, (conteoCliente.get(c.cliente) ?? 0) + 1);
  }
  const ordenCliente = new Map<string, number>();
  [...conteoCliente.keys()].forEach((cliente, i) => ordenCliente.set(cliente, i));
  const creditosOrdenados = creditos
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ca = conteoCliente.get(a.c.cliente) ?? 0;
      const cb = conteoCliente.get(b.c.cliente) ?? 0;
      if (cb !== ca) return cb - ca; // grupo más grande primero
      const oa = ordenCliente.get(a.c.cliente) ?? 0;
      const ob = ordenCliente.get(b.c.cliente) ?? 0;
      if (oa !== ob) return oa - ob; // mantener grupos contiguos
      return a.i - b.i; // estable dentro del grupo
    })
    .map((x) => x.c);
  r = mapRow(20);
  for (const c of creditosOrdenados) {
    const grupo = PRODUCTO_COLS.find((g) => g.producto === c.producto);
    if (!grupo) continue;
    ws.getCell(`B${r}`).value = c.cliente;
    ws.getCell(`C${r}`).value = c.vale;
    ws.getCell(`${grupo.col}${r}`).value = c.galones;
    r++;
  }

  // --- PROMOCIONES (insertadas tras el título, fila mapRow(37)+1..) ---
  r = mapRow(37) + 1;
  for (const p of promociones) {
    const grupo = PRODUCTO_COLS.find((g) => g.producto === p.producto);
    if (!grupo) continue;
    ws.getCell(`A${r}`).value = p.dniPlaca || "";
    ws.getCell(`${grupo.col}${r}`).value = p.galones;
    r++;
  }

  // --- Totales de créditos por producto (filas 38 y 40 originales) ---
  // El total de galones en crédito incluye además los de promociones.
  for (const { producto, col } of PRODUCTO_COLS) {
    const gl = galonesCreditoPorProducto(producto) + galonesPromoPorProducto(producto);
    ws.getCell(`${col}${mapRow(38)}`).value = gl;
    ws.getCell(`${col}${mapRow(40)}`).value = gl === 0 ? "-" : gl;
  }

  // --- VENTA TOTEN (filas 43-46): galones = total - créditos - promociones ---
  const ventaTotenRows = [43, 44, 45, 46];
  let totalVentaToten = 0;
  PRODUCTO_COLS.forEach(({ producto, col, puCol }, i) => {
    const fila = mapRow(ventaTotenRows[i]);
    const glToten = Math.max(
      0,
      galonesPorProducto(producto) -
        galonesCreditoPorProducto(producto) -
        galonesPromoPorProducto(producto)
    );
    // Venta toten = venta del odómetro − créditos − promos, todo valuado por
    // tramos de precio. El PU mostrado es el efectivo (soles/galón); cuando el
    // precio no cambió en el día equivale al precio normal de siempre.
    const solesToten = Math.max(
      0,
      ventaOdometro(producto) -
        ventaCreditoPorProducto(producto) -
        ventaPromoPorProducto(producto)
    );
    const puEfectivo = glToten > 0 ? solesToten / glToten : precioRep(producto);
    ws.getCell(`${col}${fila}`).value = glToten;
    setSoles(`${puCol}${fila}`, puEfectivo);
    setSoles(`L${fila}`, r2(solesToten));
    totalVentaToten += solesToten;
  });
  totalVentaToten = r2(totalVentaToten);
  setSoles(`L${mapRow(47)}`, totalVentaToten);

  // --- Balones de gas (Full Gas | Zeta Gas) ---
  setSoles(`L${mapRow(49)}`, r2(rep.totalBalones));

  // --- PAGOS ADELANTADOS (filas 50..53, o más) ---
  // Reemplazan a la antigua fila "SE DEVUELVE ACOPLE". Cada adelanto muestra su
  // descripción (col B) y su monto (col L). Los huecos sobrantes se limpian.
  const adelantoInicio = mapRow(50);
  const slotsAdelanto = Math.max(4, adelantos.length);
  for (let i = 0; i < slotsAdelanto; i++) {
    const fila = adelantoInicio + i;
    if (i < adelantos.length) {
      ws.getCell(`B${fila}`).value = adelantos[i].descripcion || "";
      setSoles(`L${fila}`, r2(adelantos[i].monto));
    } else {
      ws.getCell(`B${fila}`).value = null;
      ws.getCell(`L${fila}`).value = null;
    }
  }

  // --- TOTAL = venta toten + balones ---
  const totalGeneral = r2(totalVentaToten + rep.totalBalones);
  setSoles(`L${mapRow(54)}`, totalGeneral);

  // --- Deducciones ---
  // Las etiquetas se escriben explícitamente: tras los corrimientos de filas
  // (overflow, adelantos, Yape Culqui) la plantilla a veces perdía alguna (p.
  // ej. "GASTOS"), así que se garantizan por código.
  ws.getCell(`B${mapRow(56)}`).value = "DESCUENTOS";
  ws.getCell(`B${mapRow(57)}`).value = "GASTOS";
  ws.getCell(`B${mapRow(58)}`).value = "VISAS REFERENCIA";
  ws.getCell(`B${mapRow(59)}`).value = "YAPE";
  ws.getCell(`B${mapRow(60)}`).value = "TRANSFERENCIAS";
  setSoles(`L${mapRow(56)}`, r2(rep.totalDescuentos));
  setSoles(`L${mapRow(57)}`, r2(rep.totalGastos));
  const visas = r2(sumaPagos("visa"));
  const yapes = r2(sumaPagos("yape"));
  const transferencias = r2(sumaPagos("transferencia"));
  // "Visa Yape Culqui" va en su propia fila (insertada tras YAPE).
  const culqui = r2(sumaPagos("culqui"));
  setSoles(`L${mapRow(58)}`, visas);
  setSoles(`L${mapRow(59)}`, yapes);
  ws.getCell(`B${filaYapeCulqui}`).value = "VISA YQ";
  setSoles(`L${filaYapeCulqui}`, culqui);
  setSoles(`L${mapRow(60)}`, transferencias);
  const totalDeducciones = r2(
    rep.totalDescuentos + rep.totalGastos + visas + yapes + culqui + transferencias
  );
  setSoles(`L${mapRow(61)}`, totalDeducciones);

  // --- ENTREGAR vs ENTREGADO: ENTREGAR es lo que el sistema calcula que debe
  // haber en caja (efectivoAEntregar); ENTREGADO es lo que el encargado contó
  // físicamente (conteos). La diferencia es el faltante/sobrante real. Lo que
  // declaran los griferos no entra aquí: solo sirve para verificar por trabajador. ---
  const entregar = r2(rep.efectivoAEntregar);
  setSoles(`L${mapRow(62)}`, entregar);
  const totalContado = r2(
    sesiones.reduce(
      (a, s) => a + (s.conteos ?? []).reduce((x, c) => x + c.monto, 0),
      0
    )
  );
  setSoles(`L${mapRow(63)}`, totalContado);
  const diferencia = r2(totalContado - entregar);
  setSoles(`L${mapRow(64)}`, diferencia);
  ws.getCell(`M${mapRow(64)}`).value =
    diferencia < -EPS ? "FALTA" : diferencia > EPS ? "SOBRA" : null;

  // --- Calibración: solo se reflejan los precios (lo único que existe en el sistema) ---
  for (const { producto, puCol } of PRODUCTO_COLS) {
    setSoles(`${puCol}${mapRow(66)}`, precioRep(producto));
  }
  ws.getCell(`L${mapRow(66)}`).value = null;

  // --- Telemedición: no existe en el sistema, se deja vacío ---
  for (let row = 69; row <= 74; row++) {
    ws.getCell(`C${mapRow(row)}`).value = null;
  }

  // exceljs.duplicateRow descarta los rangos combinados (mergeCells) que
  // quedan por debajo del punto de inserción. Como SIEMPRE se inserta la fila
  // YAPE CULQUI (más el posible overflow), el "TOTAL" combinado A:C y los de
  // TELEMEDICION se rompen; se vuelven a aplicar en su posición final.
  const remerge = (desde: string, hasta: string) => {
    try {
      ws.unMergeCells(`${desde}:${hasta}`);
    } catch {
      /* no estaba combinado */
    }
    try {
      ws.mergeCells(`${desde}:${hasta}`);
    } catch {
      /* ya estaba combinado en su posición correcta */
    }
  };
  // exceljs NO desplaza estos merges al insertar filas: deja una copia
  // "fantasma" en la posición ORIGINAL de la plantilla. Si cae sobre una fila
  // de etiqueta (p. ej. GASTOS) oculta su texto, porque una celda combinada
  // solo muestra el valor de su esquina superior-izquierda. Se quitan de su
  // posición original antes de re-aplicarlas en la posición final.
  const desmerge = (rango: string) => {
    try {
      ws.unMergeCells(rango);
    } catch {
      /* no estaba combinado */
    }
  };
  desmerge("A61:C61"); // TOTAL deducciones (original)
  desmerge("B68:C68"); // TELEMEDICION (original)
  desmerge("E68:F68");
  remerge(`A${mapRow(61)}`, `C${mapRow(61)}`); // TOTAL deducciones
  remerge(`B${mapRow(68)}`, `C${mapRow(68)}`); // TELEMEDICION
  remerge(`E${mapRow(68)}`, `F${mapRow(68)}`);

  // Altura uniforme de 14.5 para todas las filas con contenido.
  for (let i = 1; i <= ws.rowCount; i++) {
    ws.getRow(i).height = 14.5;
  }
}

// ===========================================================================
// HOJA POR TURNO / ISLA (plantilla plantilla-isla.xlsx)
// ===========================================================================

const PROD_LABEL: Record<ProductoId, string> = {
  bio: "BIO",
  regular: "REGULAR",
  premium: "PREMIUM",
  glp: "GLP",
};

interface Posiciones {
  yapesInicio: number;
  descuentosInicio: number;
  creditosInicio: number;
  promocionesInicio: number;
  gastosInicio: number;
  filaTotales: number;
}

const DEFAULTS: Posiciones = {
  yapesInicio: 4,
  descuentosInicio: 4,
  creditosInicio: 4,
  promocionesInicio: 4,
  gastosInicio: 4,
  filaTotales: 46,
};

// Lee la hoja oculta CONFIG (si existe) para saber dónde empieza cada tabla.
function leerPosiciones(wb: ExcelJS.Workbook): Posiciones {
  const cfg = wb.getWorksheet("CONFIG");
  if (!cfg) return { ...DEFAULTS };
  const valores: Record<string, number> = {};
  cfg.eachRow((row) => {
    const clave = row.getCell(1).value;
    const valor = row.getCell(2).value;
    if (typeof clave === "string" && typeof valor === "number") {
      valores[clave] = valor;
    }
  });
  return {
    yapesInicio: valores.YAPES_INICIO ?? DEFAULTS.yapesInicio,
    descuentosInicio: valores.DESCUENTOS_INICIO ?? DEFAULTS.descuentosInicio,
    creditosInicio: valores.CREDITOS_INICIO ?? DEFAULTS.creditosInicio,
    promocionesInicio: valores.PROMOCIONES_INICIO ?? DEFAULTS.promocionesInicio,
    gastosInicio: valores.GASTOS_INICIO ?? DEFAULTS.gastosInicio,
    filaTotales: valores.FILA_TOTALES ?? DEFAULTS.filaTotales,
  };
}

// Totales escritos en la hoja (devueltos para que el caller, si quiere, los
// valide contra el sistema). El reporte general NO los valida.
export interface TotalesIsla {
  totalYapes: number;
  totalDescuentos: number;
  totalCreditos: number;
  totalPromociones: number;
  totalGastos: number;
}

// Llena la hoja "tablas" (plantilla-isla) con los datos de las sesiones de un
// turno (combinando Isla1→Isla2→Isla3). Sin validaciones.
export function llenarHojaIsla(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  sesiones: Sesion[],
  precios: Precios
): TotalesIsla {
  // Sin duplicados (por si el cliente envía la misma sesión dos veces)
  const sesionesUnicas = Array.from(
    new Map(sesiones.map((s) => [s.id, s])).values()
  );

  // Orden fijo: Isla 1, luego Isla 2, luego Isla 3
  const islasOrdenadas = ISLAS.map((isla) => ({
    isla,
    sesion: sesionesUnicas.find((s) => s.islaId === isla.id),
  }));

  // La plantilla trae 5 "tablas de Excel" con autofiltro. ExcelJS no las
  // mantiene bien al reescribir: los rangos del autofiltro quedan corruptos y
  // Excel pide "reparar" el archivo. Como solo necesitamos los datos, las
  // eliminamos antes de escribir. Los estilos de celda se conservan.
  const wsTabla = ws as unknown as {
    tables?: Record<string, unknown>;
    removeTable?: (name: string) => void;
    autoFilter?: unknown;
  };
  if (wsTabla.tables && wsTabla.removeTable) {
    for (const nombre of Object.keys(wsTabla.tables)) {
      try {
        wsTabla.removeTable(nombre);
      } catch {
        /* si no se puede quitar una, seguimos con las demás */
      }
    }
  }
  wsTabla.autoFilter = undefined;

  const pos = leerPosiciones(wb);
  // Precio por SESIÓN (turno): cada fila se valoriza al precio de su propio
  // turno, consistente con calcularCuadre (que valida este export).
  const precio = (s: Sesion, p: ProductoId) => preciosDe(s, precios)[p] ?? 0;

  // Construye, para cada tabla, la lista combinada Isla1→Isla2→Isla3
  const filasYapes = islasOrdenadas.flatMap(({ isla, sesion }) =>
    (sesion?.pagos ?? []).map((p) => ({ isla, sesion: sesion!, dato: p }))
  );
  const filasDescuentos = islasOrdenadas.flatMap(({ isla, sesion }) =>
    (sesion?.descuentos ?? []).map((d) => ({ isla, sesion: sesion!, dato: d }))
  );
  const filasCreditos = islasOrdenadas.flatMap(({ isla, sesion }) =>
    (sesion?.creditos ?? []).map((c) => ({ isla, sesion: sesion!, dato: c }))
  );
  const filasPromociones = islasOrdenadas.flatMap(({ isla, sesion }) =>
    (sesion?.promociones ?? []).map((p) => ({ isla, sesion: sesion!, dato: p }))
  );
  const filasGastos = islasOrdenadas.flatMap(({ isla, sesion }) =>
    (sesion?.gastos ?? []).map((g) => ({ isla, sesion: sesion!, dato: g }))
  );

  // Las 5 tablas comparten el mismo rango de filas y una única fila de totales
  // al final; si alguna necesita más filas, hay que insertar para TODAS.
  const huecosDisponibles = pos.filaTotales - pos.yapesInicio;
  const maxRegistros = Math.max(
    filasYapes.length,
    filasDescuentos.length,
    filasCreditos.length,
    filasPromociones.length,
    filasGastos.length
  );
  const extra = Math.max(0, maxRegistros - huecosDisponibles);
  if (extra > 0) {
    ws.duplicateRow(pos.filaTotales - 1, extra, true);
    // duplicateRow copia el estilo de la fila origen (la previa a totales),
    // que en la plantilla puede traer celdas combinadas/estilos especiales:
    // eso hacía que un registro agregado en esas filas apareciera desalineado
    // (nombre/tipo en blanco, monto corrido). Reaplicamos a cada fila nueva el
    // estilo de una fila de datos limpia (la primera, yapesInicio) y deshacemos
    // cualquier combinación heredada.
    for (let i = 0; i < extra; i++) {
      const f = pos.filaTotales + i; // filas recién insertadas
      for (let c = 1; c <= 28; c++) {
        try {
          ws.unMergeCells(f, c, f, c);
        } catch {
          /* la celda no estaba combinada */
        }
        ws.getCell(f, c).value = null;
        ws.getCell(f, c).style = ws.getCell(pos.yapesInicio, c).style;
      }
    }
  }
  const filaTotalesFinal = pos.filaTotales + extra;

  function escribirTabla(
    filas: { isla: (typeof ISLAS)[number]; sesion: Sesion; dato: unknown }[],
    inicio: number,
    escribirFila: (r: number, f: (typeof filas)[number]) => void
  ) {
    filas.forEach((f, i) => escribirFila(inicio + i, f));
  }

  escribirTabla(filasYapes, pos.yapesInicio, (rr, f) => {
    const p = f.dato as Sesion["pagos"][number];
    ws.getCell(`A${rr}`).value = f.isla.nombre;
    ws.getCell(`B${rr}`).value = f.sesion.trabajador;
    ws.getCell(`C${rr}`).value = METODO_LABEL[p.metodo] ?? p.metodo.toUpperCase();
    ws.getCell(`D${rr}`).value = p.referencia || "";
    ws.getCell(`E${rr}`).value = p.monto;
    ws.getCell(`F${rr}`).value = p.factura || "";
  });
  const totalYapes = r2(
    filasYapes.reduce((a, f) => a + (f.dato as Sesion["pagos"][number]).monto, 0)
  );
  ws.getCell(`E${filaTotalesFinal}`).value = totalYapes;

  // "TOTAL SOLES" del descuento = el AHORRO dado (galones × diferencia de
  // precio), no el total de la venta — así está definido en todo el sistema.
  escribirTabla(filasDescuentos, pos.descuentosInicio, (rr, f) => {
    const d = f.dato as Sesion["descuentos"][number];
    const descuentoPorGalon = Math.max(0, precio(f.sesion, d.producto) - d.precioDescuento);
    ws.getCell(`G${rr}`).value = f.isla.nombre;
    ws.getCell(`H${rr}`).value = d.cliente || "";
    ws.getCell(`I${rr}`).value = PROD_LABEL[d.producto];
    ws.getCell(`J${rr}`).value = d.precioDescuento;
    ws.getCell(`K${rr}`).value = d.galones;
    ws.getCell(`L${rr}`).value = r2(d.galones * descuentoPorGalon);
  });
  const totalDescuentos = r2(
    filasDescuentos.reduce((a, f) => {
      const d = f.dato as Sesion["descuentos"][number];
      return a + d.galones * Math.max(0, precio(f.sesion, d.producto) - d.precioDescuento);
    }, 0)
  );
  ws.getCell(`J${filaTotalesFinal}`).value = totalDescuentos;

  escribirTabla(filasCreditos, pos.creditosInicio, (rr, f) => {
    const c = f.dato as Sesion["creditos"][number];
    const total = r2(c.galones * precio(f.sesion, c.producto));
    ws.getCell(`M${rr}`).value = total;
    ws.getCell(`N${rr}`).value = f.isla.nombre;
    ws.getCell(`O${rr}`).value = c.cliente;
    ws.getCell(`P${rr}`).value = c.vale;
    ws.getCell(`Q${rr}`).value = PROD_LABEL[c.producto];
    ws.getCell(`R${rr}`).value = c.galones;
    ws.getCell(`S${rr}`).value = c.factura || "";
  });
  const totalCreditos = r2(
    filasCreditos.reduce((a, f) => {
      const c = f.dato as Sesion["creditos"][number];
      return a + c.galones * precio(f.sesion, c.producto);
    }, 0)
  );
  ws.getCell(`R${filaTotalesFinal}`).value = totalCreditos;

  escribirTabla(filasPromociones, pos.promocionesInicio, (rr, f) => {
    const p = f.dato as Sesion["promociones"][number];
    ws.getCell(`T${rr}`).value = f.isla.nombre;
    ws.getCell(`U${rr}`).value = p.dniPlaca || "";
    ws.getCell(`V${rr}`).value = f.sesion.trabajador;
    ws.getCell(`W${rr}`).value = PROD_LABEL[p.producto];
    ws.getCell(`X${rr}`).value = p.galones;
    ws.getCell(`Y${rr}`).value = r2(p.galones * precio(f.sesion, p.producto));
  });
  const totalPromociones = r2(
    filasPromociones.reduce((a, f) => {
      const p = f.dato as Sesion["promociones"][number];
      return a + p.galones * precio(f.sesion, p.producto);
    }, 0)
  );
  ws.getCell(`X${filaTotalesFinal}`).value = totalPromociones;

  escribirTabla(filasGastos, pos.gastosInicio, (rr, f) => {
    const g = f.dato as Sesion["gastos"][number];
    ws.getCell(`Z${rr}`).value = f.isla.nombre;
    ws.getCell(`AA${rr}`).value = g.descripcion;
    ws.getCell(`AB${rr}`).value = g.monto;
  });
  const totalGastos = r2(
    filasGastos.reduce((a, f) => a + (f.dato as Sesion["gastos"][number]).monto, 0)
  );
  ws.getCell(`AB${filaTotalesFinal}`).value = totalGastos;

  // Normaliza la fuente de toda la zona de datos. La plantilla tenía celdas de
  // muestra con fuentes en rojo/negrita/grande que se quedaban pegadas al
  // escribir encima. Solo tocamos la fuente: rellenos y bordes se conservan.
  const FUENTE_NORMAL = { name: "Calibri", size: 11 };
  for (let f = pos.yapesInicio; f <= filaTotalesFinal; f++) {
    for (let c = 1; c <= 28; c++) {
      ws.getCell(f, c).font = FUENTE_NORMAL;
    }
  }

  // Altura uniforme de 14.5 para todas las filas (las filas duplicadas por
  // overflow heredan alturas mayores; se normalizan aquí).
  for (let i = 1; i <= ws.rowCount; i++) {
    ws.getRow(i).height = 14.5;
  }

  return { totalYapes, totalDescuentos, totalCreditos, totalPromociones, totalGastos };
}

// Etiqueta de turno para nombrar las hojas del libro combinado.
export const TURNO_NOMBRE: Record<TurnoId, string> = {
  manana: "MAÑANA",
  tarde: "TARDE",
  noche: "NOCHE",
};
