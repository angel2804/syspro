// ============================================================================
// Dominio puro: CLIENTES — normalización, búsqueda difusa y anti-duplicados.
//
// Objetivo: que "Belquer", "belqer", "beqer", "Belquer SAC" y "Belker" no
// generen 5 clientes distintos. Se normaliza el nombre, se compara con los
// existentes (igualdad exacta de normalizado o similitud difusa) y se exige
// confirmación cuando hay un parecido fuerte.
//
// Puro: sin Supabase ni React. El backend replica la similitud con pg_trgm;
// aquí se ofrece una versión local equivalente (Levenshtein + trigramas) para
// sugerencias inmediatas mientras el trabajador escribe.
// ============================================================================

export interface ClienteRef {
  id: string;
  nombre: string;
  nombreNormalizado: string;
  estado?: "activo" | "pendiente" | "fusionado" | "inactivo";
}

export interface AliasRef {
  clienteId: string;
  alias: string;
  aliasNormalizado: string;
}

// Sufijos societarios comunes que no deben diferenciar un cliente.
const SUFIJOS = ["sac", "s a c", "s.a.c.", "eirl", "e i r l", "srl", "s r l", "sa", "s a"];

// Normaliza para COMPARAR (no para mostrar): minúsculas, sin acentos, sin
// puntuación, espacios colapsados y sin sufijos societarios al final.
export function normalizar(nombre: string): string {
  let s = (nombre ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[.,_/\\-]+/g, " ") // puntuación → espacio
    .replace(/[^a-z0-9 ]/g, "") // resto de símbolos fuera
    .replace(/\s+/g, " ")
    .trim();
  // Quitar sufijo societario al final (una sola vez).
  for (const suf of SUFIJOS) {
    if (s.endsWith(" " + suf) || s === suf) {
      s = s.slice(0, s.length - suf.length).trim();
      break;
    }
  }
  return s;
}

// Limpia para GUARDAR/mostrar: conserva mayúsculas/acentos, recorta espacios.
export function limpiar(nombre: string): string {
  return (nombre ?? "").replace(/\s+/g, " ").trim();
}

// ----- Similitud -----------------------------------------------------------

// Distancia de Levenshtein (edición) entre dos cadenas.
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

// Similitud por Levenshtein normalizada a [0,1] (1 = idénticas).
export function similitudLevenshtein(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function trigramas(s: string): Set<string> {
  const t = `  ${s} `;
  const set = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) set.add(t.slice(i, i + 3));
  return set;
}

// Similitud por trigramas (estilo pg_trgm) en [0,1]: índice de Jaccard.
export function similitudTrigrama(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = trigramas(a);
  const B = trigramas(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

// Similitud combinada usada por las sugerencias: el máximo entre Levenshtein
// normalizado y trigramas. Levenshtein capta bien los typos cortos
// (belqer≈belquer); los trigramas captan mejor inserciones/reordenamientos.
export function similitud(a: string, b: string): number {
  const na = normalizar(a);
  const nb = normalizar(b);
  if (na === nb) return 1;
  return Math.max(similitudLevenshtein(na, nb), similitudTrigrama(na, nb));
}

export interface Sugerencia {
  cliente: ClienteRef;
  similitud: number;
  viaAlias?: string; // si coincidió por un alias, el alias que coincidió
}

export const UMBRAL_SUGERENCIA = 0.4; // mostrar como "¿quisiste decir…?"
export const UMBRAL_BLOQUEO = 0.72; // tan parecido que NO se crea sin confirmar

// Busca clientes parecidos al texto. Considera el nombre oficial y los alias.
// Devuelve ordenado por similitud desc, máx `limite`.
export function sugerirClientes(
  texto: string,
  clientes: ClienteRef[],
  alias: AliasRef[] = [],
  opts: { umbral?: number; limite?: number } = {}
): Sugerencia[] {
  const umbral = opts.umbral ?? UMBRAL_SUGERENCIA;
  const limite = opts.limite ?? 8;
  const objetivo = normalizar(texto);
  if (!objetivo) return [];

  const aliasPorCliente = new Map<string, AliasRef[]>();
  for (const a of alias) {
    if (!aliasPorCliente.has(a.clienteId)) aliasPorCliente.set(a.clienteId, []);
    aliasPorCliente.get(a.clienteId)!.push(a);
  }

  const out: Sugerencia[] = [];
  for (const c of clientes) {
    if (c.estado === "fusionado" || c.estado === "inactivo") continue;
    let mejor = similitudTrigrama(objetivo, c.nombreNormalizado);
    mejor = Math.max(mejor, similitudLevenshtein(objetivo, c.nombreNormalizado));
    let viaAlias: string | undefined;
    for (const a of aliasPorCliente.get(c.id) ?? []) {
      const sa = Math.max(
        similitudTrigrama(objetivo, a.aliasNormalizado),
        similitudLevenshtein(objetivo, a.aliasNormalizado)
      );
      if (sa > mejor) {
        mejor = sa;
        viaAlias = a.alias;
      }
    }
    if (mejor >= umbral) out.push({ cliente: c, similitud: mejor, viaAlias });
  }
  return out.sort((a, b) => b.similitud - a.similitud).slice(0, limite);
}

export type ResolucionCliente =
  | { tipo: "exacto"; cliente: ClienteRef } // alias/normalizado idéntico
  | { tipo: "confirmar"; sugerencias: Sugerencia[] } // parecido fuerte: pedir confirmación
  | { tipo: "nuevo"; sugerencias: Sugerencia[] }; // sin parecido: se puede crear

// Decide qué hacer cuando un trabajador escribe un nombre de cliente:
//  - "exacto": ya existe (match exacto por normalizado o por alias) → usarlo.
//  - "confirmar": hay un parecido >= UMBRAL_BLOQUEO → NO crear automáticamente,
//    mostrar "¿quisiste decir…?".
//  - "nuevo": no hay parecido relevante → se puede crear (o como "pendiente").
export function resolverCliente(
  texto: string,
  clientes: ClienteRef[],
  alias: AliasRef[] = []
): ResolucionCliente {
  const objetivo = normalizar(texto);
  // Match exacto por nombre normalizado
  const exacto = clientes.find(
    (c) =>
      c.nombreNormalizado === objetivo &&
      c.estado !== "fusionado" &&
      c.estado !== "inactivo"
  );
  if (exacto) return { tipo: "exacto", cliente: exacto };
  // Match exacto por alias
  const aliasMatch = alias.find((a) => a.aliasNormalizado === objetivo);
  if (aliasMatch) {
    const c = clientes.find((x) => x.id === aliasMatch.clienteId);
    if (c) return { tipo: "exacto", cliente: c };
  }
  const sugerencias = sugerirClientes(texto, clientes, alias);
  if (sugerencias.length > 0 && sugerencias[0].similitud >= UMBRAL_BLOQUEO) {
    return { tipo: "confirmar", sugerencias };
  }
  return { tipo: "nuevo", sugerencias };
}

// ----- Fusión ---------------------------------------------------------------

export interface PlanFusion {
  origenId: string; // cliente duplicado (queda 'fusionado')
  destinoId: string; // cliente oficial que se conserva
  // Efectos a aplicar por el servicio de datos (auditables):
  reapuntarCreditos: { de: string; a: string };
  reapuntarPagos: { de: string; a: string };
  reapuntarAlias: { de: string; a: string };
  nuevoAlias: string; // el nombre del origen pasa a ser alias del destino
}

// Construye el plan de fusión de `origen` dentro de `destino`. No ejecuta
// nada (puro); el servicio de datos aplica los movimientos en una transacción
// y deja la auditoría. Lanza si origen === destino.
export function planificarFusion(
  origen: ClienteRef,
  destino: ClienteRef
): PlanFusion {
  if (origen.id === destino.id) {
    throw new Error("No se puede fusionar un cliente consigo mismo");
  }
  return {
    origenId: origen.id,
    destinoId: destino.id,
    reapuntarCreditos: { de: origen.id, a: destino.id },
    reapuntarPagos: { de: origen.id, a: destino.id },
    reapuntarAlias: { de: origen.id, a: destino.id },
    nuevoAlias: limpiar(origen.nombre),
  };
}
