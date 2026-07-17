import type { BalonTipo, Isla, Permiso, Precios, ProductoId, TurnoId } from "./types";

// Catálogo de permisos configurables por usuario (admin/encargado). El dueño
// siempre los tiene todos. El orden define cómo aparecen en Configuraciones y
// qué vista se abre por defecto si la actual no está permitida. `grupo` sirve
// para agruparlos visualmente en la gestión de usuarios.
export const PERMISOS: { id: Permiso; label: string; grupo: string }[] = [
  // Operación / reportes
  { id: "activos", label: "Ver turnos activos", grupo: "Operación" },
  { id: "reporte", label: "Ver reporte general", grupo: "Operación" },
  { id: "venta-normal", label: "Registrar venta normal", grupo: "Operación" },
  { id: "reportes-avanzados", label: "Ver reportes avanzados", grupo: "Operación" },
  { id: "reporte-en-vivo", label: "Ver reporte por finalización (en vivo)", grupo: "Operación" },
  // Trabajadores / usuarios
  { id: "mover", label: "Mover trabajador", grupo: "Personal" },
  { id: "trabajadores", label: "Administrar trabajadores", grupo: "Personal" },
  { id: "usuarios", label: "Administrar usuarios administrativos", grupo: "Personal" },
  // Clientes / créditos
  { id: "clientes", label: "Ver clientes", grupo: "Créditos" },
  { id: "creditos", label: "Ver créditos por cliente", grupo: "Créditos" },
  { id: "pagos-credito", label: "Registrar pagos de crédito", grupo: "Créditos" },
  { id: "anular", label: "Anular créditos/pagos", grupo: "Créditos" },
  { id: "fusionar", label: "Fusionar clientes", grupo: "Créditos" },
  // Precios
  { id: "precios", label: "Cambiar precios", grupo: "Precios" },
  { id: "precios-historial", label: "Ver historial de precios", grupo: "Precios" },
  // Datos / sistema
  { id: "exportar", label: "Exportar datos", grupo: "Sistema" },
  { id: "auditoria", label: "Ver auditoría", grupo: "Sistema" },
  { id: "backups-ver", label: "Ver backups", grupo: "Sistema" },
  { id: "backups-generar", label: "Generar backups", grupo: "Sistema" },
  { id: "config", label: "Ver configuraciones", grupo: "Sistema" },
  { id: "config-datos", label: "Cambiar logo/datos del grifo", grupo: "Sistema" },
  { id: "corregir-trabajador-turno", label: "Corregir trabajador de turno", grupo: "Sistema" },
  { id: "inventario", label: "Ver inventario de tanques", grupo: "Sistema" },
  { id: "reset", label: "Resetear sistema", grupo: "Sistema" },
];

// Lista de todos los permisos (acceso total). Usado como valor por defecto
// para el dueño / contraseña maestra y para usuarios sin `permisos` definidos.
export const PERMISOS_TODOS: Permiso[] = PERMISOS.map((p) => p.id);

// Base de permisos sugerida por rol al crear un usuario nuevo (el dueño puede
// ajustarlos individualmente). El dueño no aparece: siempre tiene todos.
export const PERMISOS_BASE: Record<"admin" | "encargado", Permiso[]> = {
  // Admin: amplio, sin secciones críticas por defecto (el dueño las habilita).
  admin: [
    "activos", "reporte", "venta-normal", "reportes-avanzados",
    "mover", "trabajadores",
    "clientes", "creditos", "pagos-credito", "fusionar",
    "precios", "precios-historial", "exportar",
  ],
  // Encargado: enfocado en cobranza de créditos.
  encargado: [
    "clientes", "creditos", "pagos-credito", "fusionar", "exportar",
  ],
};

// Trabajadores por defecto (editables por el admin; ver store.trabajadores)
export const TRABAJADORES_DEFAULT = ["Angel", "Lenin", "Miguel"];

// NOTA DE SEGURIDAD: ya NO existen contraseñas en el cliente. El acceso del
// staff (dueño/admin/encargado) es SIEMPRE por Supabase Auth (email+contraseña,
// ver loginConPassword) y la validación real la da la RLS por rol/permiso en la
// base de datos. La sección "Configuraciones" (backups/reset) se protege con el
// permiso 'reset' del perfil, no con una contraseña embebida en el bundle.

export const TURNOS: { id: TurnoId; label: string }[] = [
  { id: "manana", label: "Mañana" },
  { id: "tarde", label: "Tarde" },
  { id: "noche", label: "Noche" },
];

export const PRODUCTOS: Record<ProductoId, string> = {
  bio: "Bio",
  regular: "Regular",
  premium: "Premium",
  glp: "GLP",
};

export const BALONES: Record<BalonTipo, string> = {
  gasfull: "Gas Full",
  zetagas: "Zeta Gas",
};

// Clases de color por producto (tabla de odómetros estilo Excel)
export const PRODUCTO_COLOR: Record<ProductoId, string> = {
  bio: "bg-zinc-200 dark:bg-zinc-700",
  regular: "bg-green-300/70 dark:bg-green-800/50",
  premium: "bg-sky-200 dark:bg-sky-900/50",
  glp: "bg-amber-200 dark:bg-amber-900/50",
};

// Precios por defecto (el admin los edita; se guardan en Firestore config/precios)
export const PRECIOS_DEFAULT: Precios = {
  bio: 15.0,
  regular: 16.0,
  premium: 17.5,
  glp: 2.5,
  gasfull: 60.0,
  zetagas: 58.0,
};

export const ISLAS: Isla[] = [
  {
    id: "isla1",
    nombre: "Isla 1",
    tipo: "liquido",
    productos: ["bio", "regular", "premium"],
    mangueras: [
      { id: "i1_bio1a", label: "BIO1A", producto: "bio" },
      { id: "i1_bio1b", label: "BIO1B", producto: "bio" },
      { id: "i1_reg1", label: "REGULAR-1", producto: "regular" },
      { id: "i1_prem1", label: "PREMIUM-1", producto: "premium" },
      { id: "i1_bio2a", label: "BIO2A", producto: "bio" },
      { id: "i1_bio2b", label: "BIO2B", producto: "bio" },
      { id: "i1_reg2", label: "REGULAR-2", producto: "regular" },
      { id: "i1_prem2", label: "PREMIUM-2", producto: "premium" },
    ],
  },
  {
    id: "isla2",
    nombre: "Isla 2",
    tipo: "liquido",
    productos: ["bio", "regular", "premium"],
    mangueras: [
      { id: "i2_bio3a", label: "BIO3A", producto: "bio" },
      { id: "i2_bio3b", label: "BIO3B", producto: "bio" },
      { id: "i2_reg3", label: "REGULAR-3", producto: "regular" },
      { id: "i2_prem3", label: "PREMIUM-3", producto: "premium" },
      { id: "i2_bio4a", label: "BIO4A", producto: "bio" },
      { id: "i2_bio4b", label: "BIO4B", producto: "bio" },
      { id: "i2_reg4", label: "REGULAR-4", producto: "regular" },
      { id: "i2_prem4", label: "PREMIUM-4", producto: "premium" },
    ],
  },
  {
    id: "isla3",
    nombre: "Isla 3 - GLP",
    tipo: "glp",
    productos: ["glp"],
    mangueras: [
      { id: "i3_glp_a1", label: "GLP 5A", producto: "glp" },
      { id: "i3_glp_a2", label: "GLP 5B", producto: "glp" },
      { id: "i3_glp_b1", label: "GLP 6A", producto: "glp" },
      { id: "i3_glp_b2", label: "GLP 6B", producto: "glp" },
    ],
  },
];

export function getIsla(id: string): Isla | undefined {
  return ISLAS.find((i) => i.id === id);
}

export function turnoLabel(id: TurnoId): string {
  return TURNOS.find((t) => t.id === id)?.label ?? id;
}
