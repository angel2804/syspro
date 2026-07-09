// Utilidades para la "base de datos" de clientes. Los nombres de cliente que
// los trabajadores escriben en créditos, descuentos y adelantos se aprenden
// automáticamente y se reutilizan como sugerencias de autocompletado.

// Normaliza un nombre para comparar duplicados: sin espacios sobrantes,
// minúsculas y sin acentos. NO se usa para mostrar; solo para deduplicar.
export function normalizarCliente(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Limpia un nombre para guardar (recorta espacios). Conserva el formato que
// el trabajador escribió (mayúsculas/acentos) para mostrarlo tal cual.
export function limpiarCliente(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

// Devuelve una nueva lista con los nombres `nuevos` agregados a `actuales`,
// ignorando vacíos y duplicados (comparados de forma insensible a mayúsculas
// y acentos). Si no hay cambios, devuelve la MISMA referencia de `actuales`.
export function aprenderClientes(
  actuales: string[],
  nuevos: (string | undefined)[]
): string[] {
  const vistos = new Set(actuales.map(normalizarCliente));
  let resultado = actuales;
  for (const raw of nuevos) {
    if (!raw) continue;
    const nombre = limpiarCliente(raw);
    if (!nombre) continue;
    const clave = normalizarCliente(nombre);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    if (resultado === actuales) resultado = [...actuales];
    resultado.push(nombre);
  }
  return resultado;
}

// Lista ordenada alfabéticamente (para mostrar como sugerencias).
export function clientesOrdenados(clientes: string[]): string[] {
  return [...clientes].sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
}
