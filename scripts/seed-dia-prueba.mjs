// Genera un día operativo completo de prueba (3 turnos × 3 islas = 9 sesiones
// cerradas) con datos en todas las secciones: odómetros, pagos, créditos,
// descuentos, promociones, gastos, adelantos, entregas y balones (GLP).
// Inserta directamente en Supabase usando la misma forma de fila que src/lib/db.ts.
//
// Uso:  node scripts/seed-dia-prueba.mjs [YYYY-MM-DD]
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

// ---- Cargar credenciales desde .env.local ----
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}
const sb = createClient(url, anon, { auth: { persistSession: false } });

// ---- Config (espejo de src/lib/config.ts) ----
const PRECIOS = { bio: 15, regular: 16, premium: 17.5, glp: 2.5, gasfull: 60, zetagas: 58 };
const ISLAS = [
  {
    id: "isla1", nombre: "Isla 1", tipo: "liquido", productos: ["bio", "regular", "premium"],
    mangueras: [
      { id: "i1_bio1a", producto: "bio" }, { id: "i1_bio1b", producto: "bio" },
      { id: "i1_reg1", producto: "regular" }, { id: "i1_prem1", producto: "premium" },
      { id: "i1_bio2a", producto: "bio" }, { id: "i1_bio2b", producto: "bio" },
      { id: "i1_reg2", producto: "regular" }, { id: "i1_prem2", producto: "premium" },
    ],
  },
  {
    id: "isla2", nombre: "Isla 2", tipo: "liquido", productos: ["bio", "regular", "premium"],
    mangueras: [
      { id: "i2_bio3a", producto: "bio" }, { id: "i2_bio3b", producto: "bio" },
      { id: "i2_reg3", producto: "regular" }, { id: "i2_prem3", producto: "premium" },
      { id: "i2_bio4a", producto: "bio" }, { id: "i2_bio4b", producto: "bio" },
      { id: "i2_reg4", producto: "regular" }, { id: "i2_prem4", producto: "premium" },
    ],
  },
  {
    id: "isla3", nombre: "Isla 3 - GLP", tipo: "glp", productos: ["glp"],
    mangueras: [
      { id: "i3_glp_a1", producto: "glp" }, { id: "i3_glp_a2", producto: "glp" },
      { id: "i3_glp_b1", producto: "glp" }, { id: "i3_glp_b2", producto: "glp" },
    ],
  },
];
const TURNOS = ["manana", "tarde", "noche"];
const TRABAJADORES = { manana: "Angel", tarde: "Lenin", noche: "Miguel" };
const r2 = (n) => Math.round(n * 100) / 100;

// ---- Día operativo objetivo ----
const dia = process.argv[2] || "2026-06-17";
const baseTs = new Date(`${dia}T08:00:00`).getTime();

// Galones por manguera y por turno (continuos: la salida de un turno = entrada
// del siguiente, para que el reporte del día agregue inicio→final correctamente).
const GAL_LIQ = 50;
const GAL_GLP = 40;

function odometros(isla, turnoIdx) {
  const od = {};
  const perTurno = isla.tipo === "glp" ? GAL_GLP : GAL_LIQ;
  isla.mangueras.forEach((m, i) => {
    const base = 1000 + i * 100; // odómetro de arranque distinto por manguera
    const entrada = base + turnoIdx * perTurno;
    od[m.id] = { entrada, salida: entrada + perTurno };
  });
  return od;
}

function galonesPorProducto(isla, od) {
  const acc = {};
  for (const m of isla.mangueras) {
    const o = od[m.id];
    const v = Math.max(0, (o?.salida ?? 0) - (o?.entrada ?? 0));
    acc[m.producto] = (acc[m.producto] ?? 0) + v;
  }
  return acc;
}

// Construye una sesión con datos de prueba en todas las secciones.
function construirSesion(isla, turno, turnoIdx) {
  const od = odometros(isla, turnoIdx);
  const gal = galonesPorProducto(isla, od);
  const productos = isla.productos;
  const p0 = productos[0]; // bio o glp

  const pagos = [
    { id: randomUUID(), metodo: "yape", monto: 50, referencia: "", factura: "" },
    { id: randomUUID(), metodo: "transferencia", monto: 80, referencia: "TRX-" + turnoIdx, factura: "" },
    { id: randomUUID(), metodo: "visa", monto: 120, referencia: "VISA-" + turnoIdx, factura: "F001" },
  ];
  const creditos = [
    { id: randomUUID(), producto: p0, cliente: "Cliente Crédito " + isla.id, vale: "VALE-" + turnoIdx + "1", factura: "", galones: 10 },
  ];
  const promociones = [
    { id: randomUUID(), producto: p0, dniPlaca: "ABC-123", galones: 5 },
  ];
  const descuentos = [
    { id: randomUUID(), producto: p0, cliente: "Cliente Dscto", galones: 8, precioDescuento: PRECIOS[p0] - 1 },
  ];
  const gastos = [
    { id: randomUUID(), descripcion: "Limpieza", monto: 15 },
  ];
  const adelantos = [
    { id: randomUUID(), cliente: "Caja chica", monto: 20 },
  ];
  const balones = isla.tipo === "glp"
    ? [
        { id: randomUUID(), tipo: "gasfull", cantidad: 3 },
        { id: randomUUID(), tipo: "zetagas", cantidad: 2 },
      ]
    : [];

  // Cuadre (mismo cálculo que src/lib/calc.ts) para dejar la entrega cuadrada.
  const ventaTotal = productos.reduce((a, p) => a + (gal[p] ?? 0) * PRECIOS[p], 0);
  const totalCreditos = creditos.reduce((a, c) => a + c.galones * PRECIOS[c.producto], 0);
  const totalPromos = promociones.reduce((a, p) => a + p.galones * PRECIOS[p.producto], 0);
  const totalDescuentos = descuentos.reduce(
    (a, d) => a + d.galones * Math.max(0, PRECIOS[d.producto] - d.precioDescuento), 0);
  const totalElectronico = pagos.reduce((a, p) => a + p.monto, 0);
  const totalGastos = gastos.reduce((a, g) => a + g.monto, 0);
  const totalAdelantos = adelantos.reduce((a, x) => a + x.monto, 0);
  const totalBalones = balones.reduce((a, b) => a + b.cantidad * PRECIOS[b.tipo], 0);
  const efectivo = r2(
    ventaTotal - totalCreditos - totalPromos - totalDescuentos - totalElectronico -
    totalGastos + totalAdelantos + totalBalones
  );
  const entregas = [{ id: randomUUID(), hora: "14:00", monto: efectivo }];
  // Conteo físico del admin: por defecto cuadra con lo entregado.
  const conteos = [{ id: randomUUID(), monto: efectivo }];

  const ts = baseTs + turnoIdx * 8 * 3600 * 1000;
  return {
    id: `${dia}_${turno}_${isla.id}`,
    fecha: dia,
    trabajador: TRABAJADORES[turno],
    islaId: isla.id,
    turno,
    precios: PRECIOS,
    odometros: od,
    pagos, creditos, promociones, descuentos, gastos, adelantos, entregas, conteos, balones,
    cerrada: true,
    createdAt: ts,
    diaOperativo: dia,
    updatedAt: ts,
    closedAt: ts + 7 * 3600 * 1000,
    schemaVersion: 1,
  };
}

function fila(s) {
  return {
    id: s.id,
    dia_operativo: s.diaOperativo,
    cerrada: s.cerrada,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
    data: JSON.parse(JSON.stringify(s)),
  };
}

async function main() {
  const sesiones = [];
  for (const isla of ISLAS) {
    TURNOS.forEach((turno, idx) => sesiones.push(construirSesion(isla, turno, idx)));
  }

  // Asegura precios/trabajadores en config
  await sb.from("config").upsert({ key: "precios", value: PRECIOS });
  await sb.from("config").upsert({ key: "trabajadores", value: { nombres: ["Angel", "Lenin", "Miguel"] } });

  const { error } = await sb.from("sesiones").upsert(sesiones.map(fila));
  if (error) {
    console.error("Error al insertar:", error);
    process.exit(1);
  }
  console.log(`✅ Insertadas ${sesiones.length} sesiones para el día ${dia}.`);
  for (const s of sesiones) {
    console.log(`   - ${s.islaId} / ${s.turno} / ${s.trabajador}`);
  }
}

main();
