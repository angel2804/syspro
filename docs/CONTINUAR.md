# GrifoSys PRO — Prompt de continuación

> Pega este texto en una nueva sesión de Claude Code (abierta en
> `C:\Users\angel\Desktop\grifosys-pro` o en `grifosys-v2`) para retomar el
> trabajo donde quedó.

---

Estoy construyendo **GrifoSys PRO** (versión mejorada de la maqueta) en
`C:\Users\angel\Desktop\grifosys-pro`. **No toques la carpeta `grifosys-v2`**
(es la maqueta original). El proyecto nuevo ya tiene su **Supabase propio
configurado** en `.env.local` y el esquema aplicado.

## Estado actual (ya hecho y verificado)

- **Esquema SQL profesional** aplicado (`supabase/schema.sql`): profiles,
  clientes, cliente_alias, creditos, pagos_credito, precio_eventos, audit_log,
  backups, vista cliente_saldos, RLS por rol + funciones pg_trgm.
- Ya corrí en el SQL Editor: `schema.sql`, `transicion-anon.sql` (acceso
  anónimo temporal, Fase 1–3) y `02-creditos-origen.sql` (columna origen_id).
- **Cuenta corriente por cliente** completa y verificada en vivo:
  - dominio puro testeado: `src/lib/domain/cuenta-corriente.ts` y
    `src/lib/domain/clientes.ts` (anti-duplicados Levenshtein+trigramas, fusión).
  - servicios: `src/lib/data/{clientes,creditos,auditoria}.ts`.
  - UI `/admin/creditos`: estado de cuenta (formato obligatorio), registrar
    pago/crédito, anular, anti-duplicados al crear cliente, fusión, export CSV
    de estado de cuenta y de "clientes con deuda".
  - **Flujo trabajador**: al cerrar turno, `sincronizarCreditosSesion` vuelca
    los créditos del turno a la cuenta corriente (precio congelado, cliente
    resuelto/creado 'pendiente', idempotente por `origen_id`). No afecta el cuadre.
- **Bitácora** `/admin/auditoria` (filtro por acción), enlazada en el admin.
- **PWA**: manifest, iconos generados, service worker offline, /offline, botón
  instalar, aviso sin conexión.
- Calidad: `npm run build` ✅, `npm test` ✅ (57), lint limpio en TODO el código
  nuevo. (Las pantallas heredadas de la maqueta —admin/dashboard/page/setup—
  aún tienen errores `react-hooks/set-state-in-effect`; se quitan al reescribirlas.)

## Lo que falta (por prioridad)

1. **Fase 4 — Seguridad/Auth (mi problema #1).** Migrar a Supabase Auth, crear
   filas en `profiles` (rol dueño/admin/trabajador + permisos), validar permisos
   en servidor, y **revertir** el acceso anónimo (`transicion-anon-revertir.sql`)
   activando la RLS por rol. DECISIÓN PENDIENTE: ¿login con **email+contraseña**
   o **usuario+PIN**? (aún no lo decidí). Cuidado de no dejarme fuera: crear
   primero el usuario 'dueño'. 

   ### Decisión de autenticación definitiva

  Mantener el ingreso de trabajadores como en la maqueta:
  - El trabajador/grifero NO debe usar contraseña ni PIN.
  - El trabajador entra seleccionando su nombre.
  - El trabajador solo puede:
    - abrir su turno
    - registrar odómetros
    - registrar pagos/registros de su turno
    - registrar créditos otorgados durante su turno
    - cerrar su turno
  - El trabajador NO puede:
    - entrar al panel admin
    - registrar pagos de créditos
    - cobrar deudas
    - editar clientes oficiales
    - fusionar clientes
    - cambiar precios
    - ver reportes administrativos

  La autenticación fuerte con Supabase Auth debe aplicarse a:
  - dueño
  - administradores
  - encargados

  Los encargados son quienes manejan la cobranza de créditos:
  - ver sección Créditos por cliente
  - registrar pagos de crédito
  - anular/corregir pagos si tienen permiso
  - revisar clientes pendientes
  - fusionar clientes si tienen permiso
  - exportar estados de cuenta si tienen permiso

  Los trabajadores solo registran el crédito en su turno. Al cerrar el turno, esos créditos se sincronizan a la sección Créditos por cliente.

  Los trabajadores solo registran el crédito en su turno. Al cerrar el turno, esos créditos se sincronizan a la sección Créditos por cliente.
## Autenticación, roles y permisos

El sistema debe manejar 4 roles base:

- dueño
- admin
- encargado
- trabajador

### Dueño

El dueño es el usuario principal del sistema.

Reglas:

- Entra con contraseña propia.
- Tiene acceso total a todo el sistema.
- Puede crear, editar, activar y desactivar usuarios administrativos.
- Puede crear o asignar contraseñas para admin y encargado.
- Puede administrar trabajadores operativos.
- Puede cambiar roles.
- Puede configurar permisos por usuario.
- Puede ver auditoría completa.
- Puede ver y administrar configuraciones críticas.
- Puede hacer backups, restauraciones o resets si el sistema lo permite.
- No debe poder quedarse sin permisos críticos.
- No debe poder eliminarse o bloquearse accidentalmente sin confirmación fuerte.

### Admin

El admin es un usuario administrativo creado por el dueño.

Reglas:

- Entra con contraseña creada o asignada por el dueño.
- Puede tener acceso a paneles administrativos.
- Sus permisos deben ser configurables por el dueño.
- No debe tener acceso total automático.
- Puede ver o usar solo las secciones que el dueño le permita.
- Por ejemplo, el dueño puede quitarle acceso a Auditoría, Configuraciones, Backups, Reportes avanzados o Créditos.
- No puede cambiar permisos del dueño.
- No puede quitar permisos críticos al dueño.
- No puede acceder a secciones ocultas escribiendo la URL directamente.

### Encargado

El encargado es un usuario operativo-administrativo creado por el dueño.

Reglas:

- Entra con contraseña creada o asignada por el dueño cuando tenga acceso a paneles administrativos.
- Puede administrar trabajadores si el dueño le da permiso.
- Puede manejar créditos y cobranza si el dueño le da permiso.
- Puede registrar pagos de crédito si tiene permiso.
- Puede ver reportes si tiene permiso.
- Sus permisos deben ser configurables por el dueño.
- No debe tener acceso total automático.
- No puede ver Auditoría completa salvo que el dueño lo permita.
- No puede cambiar permisos del dueño.
- No puede acceder a secciones ocultas escribiendo la URL directamente.

### Trabajador

El trabajador es el usuario operativo del turno.

Reglas:

- Entra sin contraseña.
- Entra sin PIN.
- Debe ingresar como en la maqueta original, mediante selección simple de trabajador o flujo equivalente.
- No tiene acceso administrativo.
- No entra a Configuraciones.
- No entra a Auditoría.
- No administra usuarios.
- No administra créditos/cobranza.
- Solo registra operaciones de su turno:
  - ventas
  - créditos del turno
  - datos necesarios para cierre
- Los créditos registrados por el trabajador pasan luego a la sección Créditos.
- El trabajador no cobra créditos desde la sección Créditos.
- El trabajador no modifica pagos de créditos.
- El trabajador no debe afectar reportes administrativos fuera de su flujo normal.

## Permisos configurables por usuario

El rol define una base, pero los permisos concretos deben poder configurarse por usuario desde Configuraciones.

El dueño debe poder activar o desactivar accesos para cada admin o encargado.

Ejemplos de permisos:

- ver turnos activos
- ver reporte general
- registrar venta normal
- mover trabajador
- administrar trabajadores
- administrar usuarios administrativos
- ver clientes
- ver créditos
- registrar pagos de crédito
- anular créditos/pagos
- fusionar clientes
- exportar datos
- cambiar precios
- ver historial de precios
- ver backups
- generar backups
- ver auditoría
- ver configuraciones
- cambiar logo/datos del grifo
- resetear sistema
- ver reportes avanzados

Reglas obligatorias:

- La interfaz debe ocultar menús, botones y páginas sin permiso.
- El servidor debe validar permisos antes de ejecutar acciones.
- Supabase/RLS debe proteger los datos según rol/permisos.
- No basta con ocultar botones en frontend.
- Toda acción sensible debe quedar registrada en auditoría.
- El dueño siempre debe conservar acceso total.
## Créditos por cliente: fecha visible y trazabilidad completa

En la sección `/admin/creditos`, el estado de cuenta debe mostrar también la fecha de cada movimiento.

Actualmente el formato principal es:

Galones | Producto | Vale | Precio | Total crédito | Pago | Deuda pendiente

Debe quedar así:

Fecha | Galones | Producto | Vale | Precio | Total crédito | Pago | Deuda pendiente

Ejemplo:

Cliente: Belquer

Fecha       | Galones | Producto | Vale | Precio | Total crédito | Pago | Deuda pendiente
30/06/2026  | 10      | BIO      | 0001 | 19.20  | 192.00        |      | -192.00
30/06/2026  |         |          |      |        |               | 100  | -92.00

Reglas:
- Toda fila de crédito debe mostrar la fecha en que se registró.
- Toda fila de pago debe mostrar la fecha en que el encargado/admin registró el pago.
- La fecha debe guardarse como dato obligatorio.
- La fecha debe poder mostrarse en formato corto en la tabla principal.
- En vista detalle o exportación debe incluir fecha 
- Debe poder filtrarse por rango de fechas.
- Debe poder ordenarse cronológicamente.
- Si dos movimientos tienen la misma fecha, ordenar por `created_at`.
- La exportación CSV/PDF del estado de cuenta debe incluir fecha.

2. **Fase 5 — Precios + cierre.** Historial de precios en vivo: cada cambio de
   precio del admin escribe en `precio_eventos` (quién/cuándo/por qué, aplica a
   turno activo o próximo) y muestra un **banner en tiempo real** al trabajador.
   Cierre de turno con **validaciones** (odómetros, salida<entrada, pagos
   incompletos, créditos sin cliente/vale, montos negativos) + **resumen** y
   confirmación. Admin corrige sesión cerrada con auditoría.
3. **Fase 1/3 — Reescribir pantallas operativas.** Quitar el patrón
   `set-state-in-effect` heredado, agregar **estado de sincronización visible**
   (conectado/guardando/sin conexión/cambios pendientes/último guardado), UI
   profesional (densa para admin, botones grandes para trabajador). Que
   `npm run lint` pase 100%.
4. **Fase 6 — Reportes.** Reporte por turno/trabajador/producto, diferencias,
   historial de precios, pagos de créditos, estado de cuenta en **PDF**; mejorar
   backups. Mantener Excel existente.

## Reglas
-### Separación contable obligatoria de créditos

Los créditos por cliente y sus pagos son una cuenta corriente aparte.

Regla obligatoria:
- El trabajador registra el crédito durante su turno.
- Ese crédito sí afecta el cuadre del trabajador como crédito otorgado, igual que en la maqueta.
- Al cerrar el turno, el crédito se copia/sincroniza a la sección Créditos por cliente.
- Los encargados/admin cobran posteriormente esos créditos.
- Los pagos de créditos NO deben afectar:
  - el reporte del grifero
  - el cuadre del turno del trabajador
  - la venta del día
  - el reporte general de ventas de combustible

Los pagos de crédito deben vivir en un reporte separado:
- cobranza de créditos
- estado de cuenta por cliente
- historial de pagos de crédito

No mezclar pagos de créditos con:
- yape/transferencia/visa/culqi del turno
- efectivo del turno
- venta de combustible del día

- No tocar `grifosys-v2`. Trabajar solo en `grifosys-pro`.
- Mantener el dominio existente (cuadre/día operativo/cascada de turnos en
  `src/lib/calc.ts`) — no romper los reportes Excel.
- Dominio puro en `src/lib/domain`, datos en `src/lib/data`; los componentes no
  importan Supabase directo.
- Tras cada cambio: `npm run build`, `npm test`, lint limpio en lo nuevo.
- Costo S/ 0 (Vercel/Supabase/GitHub Free, PWA). Leer `node_modules/next/dist/docs`
  antes de tocar rutas/metadata/PWA.

Continúa con la **Fase 4** (o la que te indique). Lee primero `docs/DIAGNOSTICO-Y-PLAN.md`.
