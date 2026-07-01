# GrifoSys PRO — Diagnóstico y plan de migración

> Documento de arranque. La maqueta original queda intacta en `grifosys-v2`;
> esta carpeta (`grifosys-pro`) es la versión mejorada, construida por módulos
> conservando el dominio que ya funciona.

## 1. Diagnóstico del sistema actual

**Lo que está bien (se conserva):**

- **Dominio del cuadre** (`src/lib/calc.ts`): cálculo de cuadre por turno,
  día operativo 6am–6am, gating de turnos en cascada (mañana→tarde→noche),
  reporte del día con tramos de precio por odómetro continuo, congelado de
  precio al cerrar turno. Es sólido y está cubierto por tests. **No se reescribe.**
- **IDs determinísticos de sesión** (`${dia}_${isla}_${turno}`): evitan dos
  turnos para la misma combinación. Buena defensa contra doble-clic / 2 pestañas.
- **Capa de datos única** (`src/lib/db.ts`) sobre Supabase: las páginas no
  conocían el backend. Buena base para crecer.
- **Realtime + merge** que respeta la edición local de la sesión activa.

**Problemas detectados (se corrigen):**

| # | Problema | Riesgo | Fase |
|---|----------|--------|------|
| 1 | Contraseñas en cliente / `.env` público (`NEXT_PUBLIC_ADMIN_PASSWORD`) | Seguridad | 4 |
| 2 | RLS `for all using (true)` en todas las tablas | Seguridad | 4 |
| 3 | Permisos validados solo en UI | Seguridad | 4 |
| 4 | Créditos embebidos en la sesión (solo galones), sin precio congelado, sin pagos, sin cuenta corriente por cliente | Descuadre / negocio | 2 |
| 5 | Clientes como lista de strings → duplicados por typo (Belquer/belqer/…) | Datos sucios | 2 |
| 6 | Precios: cambio silencioso, el trabajador debe recargar; sin historial | Descuadre | 5 |
| 7 | Sin estado de sincronización visible (conectado/guardando/offline) | Operación | 1/3 |
| 8 | Cierre de turno sin validaciones previas ni resumen de confirmación | Errores | 5 |
| 9 | Sin auditoría de acciones sensibles | Trazabilidad | 5 |
| 10 | No instalable (sin PWA/manifest/offline) | Distribución | 3 |
| 11 | Lint actual no pasa (`react-hooks/set-state-in-effect` en las páginas) | Calidad | 1/3 |

## 2. Plan de migración por fases

Cada fase deja `build` + `test` verdes antes de pasar a la siguiente.

- **Fase 1 — Estabilización.** Estado de sincronización visible; evitar que un
  trabajador entre al turno activo de otro (chequeo de carrera contra Supabase
  antes de reclamar la sesión); arreglar `set-state-in-effect` al reescribir las
  pantallas; mantener Excel.
- **Fase 2 — Créditos por cliente (cuenta corriente).** ✅ *dominio + datos listos.*
  Estado de cuenta por cliente, pagos contra saldo, deuda acumulada, pagos
  parciales, saldo a favor, anti-duplicados (normalización + Levenshtein +
  trigramas), alias y fusión de clientes. Falta la **UI** (`/admin/creditos`).
- **Fase 3 — PWA.** ✅ *base lista:* manifest, iconos generados, service worker
  con offline, página `/offline`, registro + botón "Instalar" + aviso sin
  conexión. Falta pulir la UI profesional de las pantallas operativas.
- **Fase 4 — Seguridad / Auth.** Migrar a Supabase Auth; tabla `profiles` con
  rol (dueño/admin/trabajador) y permisos; endurecer RLS (ya redactada en el
  schema, lista para activar); validar permisos en servidor.
- **Fase 5 — Precios + auditoría + cierre.** `precio_eventos` con historial
  (quién/cuándo/por qué, aplica a turno activo o próximo); banner en vivo al
  trabajador; auditoría consultable; cierre con validaciones y resumen.
- **Fase 6 — Reportes + backups + README final.** Excel (se mantiene) + PDF
  opcional; reportes nuevos (créditos por cliente, clientes con deuda, pagos de
  crédito, estado de cuenta); backups mejorados.

## 3. Estado actual de esta carpeta

**Hecho:**

- `supabase/schema.sql` — esquema profesional: `profiles`, `clientes`,
  `cliente_alias`, `creditos`, `pagos_credito`, `precio_eventos`, `audit_log`,
  `backups`, vista `cliente_saldos`, función `buscar_clientes_similares`
  (pg_trgm), triggers `updated_at`, **RLS real por rol** (con bloque de
  transición comentado, sin `using(true)` permanente).
- `src/lib/domain/cuenta-corriente.ts` — dominio puro de la cuenta corriente
  (resumen, estado de cuenta cronológico con saldo acumulado firmado, formato
  obligatorio) + **tests**.
- `src/lib/domain/clientes.ts` — normalización con sufijos, Levenshtein,
  trigramas, sugerencias, `resolverCliente` (exacto/confirmar/nuevo), plan de
  fusión + **tests**.
- `src/lib/data/{clientes,creditos,auditoria}.ts` — servicios sobre Supabase
  (las páginas no tocan Supabase directo). Créditos del trabajador, pagos del
  admin, fusión, alias, bitácora.
- **PWA**: `app/manifest.ts`, `app/icon.tsx`, `app/apple-icon.tsx`,
  `public/icons/icon.svg`, `public/sw.js`, `app/offline/page.tsx`,
  `components/pwa.tsx`, metadatos `standalone` en el layout.

**Calidad:** `npm run build` ✅ · `npm test` ✅ (57 pruebas) · lint limpio en
todo el código nuevo. (Las pantallas heredadas de la maqueta aún arrastran
errores `set-state-in-effect`; se eliminan al reescribirlas en Fase 1/3.)

**Pendiente (próximas iteraciones):** UI de créditos por cliente, reescritura
de pantallas operativas con estado de sync, Supabase Auth + activación de RLS,
historial de precios en vivo, reportes nuevos y PDF.
