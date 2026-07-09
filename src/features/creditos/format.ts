// Formateadores compartidos de la sección de créditos (cuenta corriente),
// usados por la página y por los diálogos extraídos.
export const soles = (n: number) => "S/ " + (n || 0).toFixed(2);

export const fechaLarga = (ms: number) =>
  new Date(ms).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });

// Fecha corta dd/mm/aaaa para la tabla principal del estado de cuenta.
export const fechaCorta = (ms: number) =>
  new Date(ms).toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
