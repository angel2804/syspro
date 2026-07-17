// Tipos de dominio del sistema de grifo

export type ProductoId = "bio" | "regular" | "premium" | "glp";
export type IslaTipo = "liquido" | "glp";
export type TurnoId = "manana" | "tarde" | "noche";
export type MetodoPago = "yape" | "transferencia" | "visa" | "culqui";
// 4 roles base del sistema (Fase 4 — Supabase Auth):
//   dueno      → acceso total, siempre.
//   admin      → administrativo, permisos configurables por el dueño.
//   encargado  → operativo-administrativo (cobranza), permisos configurables.
//   trabajador → operativo del turno, sin acceso administrativo.
// "admin" se conserva como valor histórico compatible con el código previo.
export type Rol = "dueno" | "admin" | "encargado" | "trabajador";

// Balones de gas envasado (solo isla GLP)
export type BalonTipo = "gasfull" | "zetagas";

// Claves de precio gestionadas por el admin (combustibles + balones)
export type PrecioKey = ProductoId | BalonTipo;
export type Precios = Record<PrecioKey, number>;

// Secciones del panel admin que pueden activarse/desactivarse por cada
// administrador. Los ids que coinciden con una vista del panel comparten su
// nombre; "venta-normal" es una subsección dentro del Reporte del día.
export type Permiso =
  // Operación / reportes
  | "activos" // ver turnos activos
  | "reporte" // ver reporte general del día
  | "venta-normal" // registrar venta a precio normal (dentro del reporte)
  | "reportes-avanzados" // ver reportes avanzados
  // Ver el reporte/exportar de un día "por finalización" (en vivo), a medida
  // que van cerrando los turnos. Si FALTA, el día solo aparece cuando está
  // completo (mañana, tarde y noche cerrados). Por defecto ausente = off.
  | "reporte-en-vivo"
  // Trabajadores / usuarios
  | "mover" // mover trabajador de isla
  | "trabajadores" // administrar trabajadores operativos
  | "usuarios" // administrar usuarios administrativos (admin/encargado)
  // Clientes / créditos (cobranza)
  | "clientes" // ver/editar clientes oficiales
  | "creditos" // ver sección Créditos por cliente
  | "pagos-credito" // registrar pagos de crédito
  | "anular" // anular créditos/pagos
  | "fusionar" // fusionar clientes
  // Precios
  | "precios" // cambiar precios
  | "precios-historial" // ver historial de precios
  // Datos / sistema
  | "exportar" // exportar datos
  | "auditoria" // ver auditoría
  | "backups-ver" // ver backups
  | "backups-generar" // generar backups
  | "config" // ver configuraciones
  | "config-datos" // cambiar logo/datos del grifo
  | "corregir-trabajador-turno" // corregir solo el nombre del trabajador en un turno
  | "inventario" // ver inventario de tanques (referencia visual)
  | "reset"; // resetear sistema

// Administrador con nombre y contraseña, gestionado por el desarrollador en
// Configuraciones. Aparece en la lista de login de admin.
export interface Admin {
  id: string;
  nombre: string;
  password: string;
  // Secciones que este admin puede ver. Si es `undefined` (admins creados
  // antes de existir los permisos) se interpreta como acceso total, para no
  // romper la compatibilidad. La contraseña maestra siempre ve todo.
  permisos?: Permiso[];
}

export interface Manguera {
  id: string;
  label: string;
  producto: ProductoId;
}

export interface Isla {
  id: string;
  nombre: string;
  tipo: IslaTipo;
  mangueras: Manguera[];
  productos: ProductoId[];
}

export interface OdometroValor {
  entrada: number;
  salida: number;
}

export interface PagoElectronico {
  id: string;
  metodo: MetodoPago;
  referencia?: string; // obligatorio si visa o transferencia
  factura?: string; // opcional
  monto: number; // obligatorio
}

export interface Credito {
  id: string;
  producto: ProductoId;
  cliente: string; // obligatorio
  vale: string; // obligatorio
  factura?: string; // opcional
  galones: number; // obligatorio
}

export interface Promocion {
  id: string;
  producto: ProductoId;
  dniPlaca?: string; // opcional
  galones: number; // obligatorio
}

export interface Descuento {
  id: string;
  producto: ProductoId;
  cliente?: string;
  galones: number; // obligatorio
  precioDescuento: number; // precio al que se dio (obligatorio)
}

export interface Gasto {
  id: string;
  descripcion: string;
  monto: number;
}

export interface Adelanto {
  id: string;
  descripcion?: string;
  monto: number;
}

export interface Entrega {
  id: string;
  hora?: string; // ej. "16:00" — opcional
  monto: number;
}

// Conteo físico de efectivo que hace el ADMIN al cerrar el día, por
// trabajador. El trabajador se infiere de la sesión donde se registra (cada
// isla×turno tiene un encargado). Se compara contra lo "entregado" (entregas
// que registraron los propios trabajadores en el sistema).
export interface Conteo {
  id: string;
  monto: number; // efectivo contado en físico para ese trabajador
}

export interface Balon {
  id: string;
  tipo: BalonTipo; // gasfull | zetagas
  cantidad: number; // unidades vendidas
}

export interface Sesion {
  id: string;
  fecha: string; // YYYY-MM-DD
  trabajador: string;
  islaId: string;
  turno: TurnoId;
  precios: Precios; // snapshot al iniciar (informativo); el cálculo usa precios globales
  odometros: Record<string, OdometroValor>; // por manguera.id
  pagos: PagoElectronico[];
  creditos: Credito[];
  promociones: Promocion[];
  descuentos: Descuento[];
  gastos: Gasto[];
  adelantos: Adelanto[];
  entregas: Entrega[];
  conteos: Conteo[]; // conteo físico del admin por trabajador (cierre del día)
  balones: Balon[];
  cerrada: boolean;
  createdAt: number;
  // Día operativo (6am–6am) guardado como campo para consultas eficientes.
  diaOperativo: string; // YYYY-MM-DD
  updatedAt: number; // última edición (ms epoch)
  closedAt?: number; // momento de cierre del turno
  schemaVersion: number; // versión del esquema del documento
}
