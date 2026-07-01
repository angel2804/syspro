# GrifoSys PRO — Prompt de continuación (post Fase 4)

> Pega este texto en una nueva sesión de Claude Code abierta en
> `C:\Users\angel\Desktop\grifosys-pro` para retomar el trabajo.
> **No toques `grifosys-v2`** (maqueta original).

## Contexto

Estoy construyendo **GrifoSys PRO** en `C:\Users\angel\Desktop\grifosys-pro`.
Tiene su propio Supabase configurado en `.env.local` y el esquema aplicado. El
dominio del cuadre (`src/lib/calc.ts`) y los reportes Excel funcionan y NO se
reescriben. Arquitectura: dominio puro en `src/lib/domain`, datos en
`src/lib/data`, servidor en `src/lib/server`; los componentes no importan
Supabase directo. Tras cada cambio: `npm run build`, `npm test`, lint limpio en
lo nuevo (las pantallas heredadas `admin/page.tsx` y `page.tsx` arrastran errores
`react-hooks/set-state-in-effect` PREEXISTENTES que se quitan al reescribirlas en
Fase 1/3).

## Fase 4 (Seguridad/Auth) — HECHA en código, verificada (build + 57 tests)

- **Roles:** dueno / admin / encargado / trabajador. Permisos configurables por
  usuario (`PERMISOS`, `PERMISOS_BASE` en `src/lib/config.ts`; tipo `Permiso` en
  `types.ts`). El dueño siempre tiene todos.
- **Login por rol** (`src/app/page.tsx`): dueño/admin/encargado con email+password
  (Supabase Auth); **trabajador = CUENTA COMPARTIDA** `trabajador@grifo.local`
  (signInWithPassword) → luego elige nombre real de `config/trabajadores` → se
  guarda en `sesiones.trabajador`. NO se usan usuarios anónimos.
- **Auth plumbing:** `src/lib/data/auth.ts` (loginConPassword,
  loginTrabajadorCompartido, cargarPerfil, getAccessToken, logoutSupabase);
  `src/components/auth-provider.tsx` reconcilia sesión↔store; `store.auth` con
  rol/nombre/permisos/userId + `setAuth`; cliente con persistSession
  (`src/lib/supabase.ts`).
- **Gestión de usuarios (dueño):** `src/lib/server/supabase-admin.ts` (service_role,
  requireDueno/requirePermiso/auditarServidor) + `src/lib/server/usuarios-actions.ts`
  (listar/crear/actualizar/resetearPassword/resetearPasswordTrabajador/
  crearDuenoInicial, anti-lockout del último dueño). UI `/admin/usuarios` (solo
  dueño) y `/bootstrap` (primer dueño).
- **Gating por URL:** `src/lib/use-permiso-guard.ts`, aplicado en `/admin/creditos`
  (permiso 'creditos') y `/admin/auditoria` ('auditoria').
- **Fecha visible** en el estado de cuenta de `/admin/creditos` (columna + filtro
  por rango + CSV).
- **BUG FIX importante:** `filaDeSesion` en `src/lib/db.ts` no escribía
  isla_id/turno/trabajador (NOT NULL) → los turnos no se guardaban en Supabase
  y el admin no veía turnos activos. Corregido.

Credenciales de prueba ya creadas en Supabase: dueño `angel@dev.com` / `123456`;
trabajador `trabajador@grifo.local` / `grifo1234`.

## Lo ÚNICO que falta para cerrar Fase 4 (pasos en Supabase + 1 opcional de código)

1. (Opcional recomendado) Quitar del login `src/app/page.tsx` el **fallback de
   contraseña maestra** (`ADMIN_PASSWORD`), porque tras activar RLS deja de
   funcionar y solo confunde. Entrar siempre con el dueño de Supabase.
2. **Verificar los 4 roles** operando bien en la app.
3. En Supabase → Authentication → Providers → **deshabilitar Anonymous sign-ins**.
4. (Opcional) limpiar anónimos de prueba: `node scripts/limpiar-anonimos.mjs`.
5. **Correr `supabase/05-activar-rls.sql`** (ya revisado y correcto). Scripts
   `04-auth-roles.sql` deben estar aplicados. Reversible con
   `supabase/transicion-anon.sql` si algo falla.

> Nota RLS (criterio ya decidido): la app escribe todo desde el cliente y el
> trabajador (cuenta compartida) al cerrar turno escribe en sesiones, creditos,
> clientes, alias, audit_log y backups → esas tablas = `esta_autenticado`. La RLS
> reserva por permiso solo lo crítico: pagos_credito, config admin, precio_eventos,
> auditoría-ver, usuarios (dueño). Restricciones finas van en la UI.

## Siguientes fases (según `docs/CONTINUAR.md` y `docs/DIAGNOSTICO-Y-PLAN.md`)

- **Fase 5 — Precios + cierre.** Historial de precios en vivo: cada cambio escribe
  en `precio_eventos` (quién/cuándo/por qué, aplica a turno activo o próximo) +
  **banner en tiempo real** al trabajador. Cierre de turno con **validaciones**
  (odómetros, salida<entrada, pagos incompletos, créditos sin cliente/vale, montos
  negativos) + resumen y confirmación. Admin corrige sesión cerrada con auditoría.
  (Aquí también: precios pasan a permitir permiso 'precios' a encargado si aplica.)
- **Fase 1/3 — Reescribir pantallas operativas.** Quitar `set-state-in-effect`
  heredado, **estado de sincronización visible** (conectado/guardando/sin
  conexión/cambios pendientes/último guardado), UI profesional (densa para admin,
  botones grandes para trabajador). `npm run lint` 100%.
- **Fase 6 — Reportes.** Por turno/trabajador/producto, diferencias, historial de
  precios, pagos de créditos, estado de cuenta en **PDF**; mejorar backups.
  Mantener Excel existente.

## Regla contable (no romper)

Los pagos de crédito son cuenta corriente aparte y NO afectan el cuadre del
trabajador, la venta del día ni el reporte general. El crédito del turno sí afecta
el cuadre del trabajador (como en la maqueta) y al cerrar turno se sincroniza a la
sección Créditos por cliente.

Empieza confirmando el estado y dime si continúo con **Fase 5** o con el cierre
final de Fase 4 (activar RLS).
