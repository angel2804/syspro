-- ============================================================================
-- GrifoSys PRO — Fase 4 (parte final): ACTIVAR RLS POR ROL/PERMISO
--
-- ⚠️  EJECUTAR SOLO AL FINAL, cuando:
--     1) ya corriste `04-auth-roles.sql`,
--     2) creaste la cuenta compartida de trabajador (scripts/crear-trabajador.mjs)
--        y tu usuario DUEÑO (/bootstrap) e iniciaste sesión OK,
--     3) verificaste que dueño/admin/encargado/trabajador operan bien,
--     4) (recomendado) deshabilitaste "Anonymous sign-ins" en el Dashboard.
--
-- CRITERIO (importante): la app escribe TODO desde el cliente. El trabajador es
-- una cuenta autenticada (cuenta compartida) que, al CERRAR TURNO, escribe en
-- sesiones, creditos (insert+update), clientes, cliente_alias, audit_log y
-- backups. Por eso esas tablas OPERATIVAS se permiten a cualquier autenticado.
-- La RLS reserva por permiso/rol solo lo SENSIBLE de dinero y administración:
--   * PAGOS DE CRÉDITO (cobranza)         → permiso 'pagos-credito'
--   * CONFIG admin (precios/logo/…)       → es_admin (dueño/admin)
--   * PRECIO_EVENTOS                       → permiso 'precios'
--   * AUDITORÍA (ver)                      → permiso 'auditoria'
--   * GESTIÓN DE USUARIOS                  → dueño (vía service_role en servidor)
-- El resto de restricciones finas (anular, fusionar, backups, exportar) se
-- aplican en la UI (menús + guardias por permiso). La RLS es el respaldo para
-- lo crítico. Tras esto, el acceso con contraseña maestra legacy (sin auth.uid)
-- queda BLOQUEADO: usa siempre Supabase Auth.
--
-- Reversible: si algo falla, corre `transicion-anon.sql` para reactivar el
-- acceso temporal mientras depuras.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Quitar políticas de transición (acceso anónimo).
-- ----------------------------------------------------------------------------
drop policy if exists tmp_anon_sesiones       on public.sesiones;
drop policy if exists tmp_anon_config         on public.config;
drop policy if exists tmp_anon_clientes       on public.clientes;
drop policy if exists tmp_anon_cliente_alias  on public.cliente_alias;
drop policy if exists tmp_anon_creditos       on public.creditos;
drop policy if exists tmp_anon_pagos_credito  on public.pagos_credito;
drop policy if exists tmp_anon_precio_eventos on public.precio_eventos;
drop policy if exists tmp_anon_audit_log      on public.audit_log;
drop policy if exists tmp_anon_backups        on public.backups;

-- ----------------------------------------------------------------------------
-- 2) CLIENTES: crear = autenticado (el trabajador crea 'pendiente' al cerrar
--    turno); editar/fusionar = permiso 'clientes'.
-- ----------------------------------------------------------------------------
drop policy if exists clientes_write  on public.clientes;
drop policy if exists clientes_insert on public.clientes;
drop policy if exists clientes_update on public.clientes;
drop policy if exists clientes_delete on public.clientes;
create policy clientes_insert on public.clientes
  for insert with check (public.esta_autenticado());
create policy clientes_update on public.clientes
  for update using (public.tiene_permiso('clientes')) with check (public.tiene_permiso('clientes'));
create policy clientes_delete on public.clientes
  for delete using (public.tiene_permiso('clientes'));

-- ALIAS (se crean al sincronizar/fusionar): crear autenticado; editar/borrar permiso.
drop policy if exists cliente_alias_write  on public.cliente_alias;
drop policy if exists cliente_alias_insert on public.cliente_alias;
drop policy if exists cliente_alias_mut    on public.cliente_alias;
drop policy if exists cliente_alias_del    on public.cliente_alias;
create policy cliente_alias_insert on public.cliente_alias
  for insert with check (public.esta_autenticado());
create policy cliente_alias_mut on public.cliente_alias
  for update using (public.tiene_permiso('clientes')) with check (public.tiene_permiso('clientes'));
create policy cliente_alias_del on public.cliente_alias
  for delete using (public.tiene_permiso('clientes'));

-- ----------------------------------------------------------------------------
-- 3) CRÉDITOS: crear/actualizar = autenticado. El trabajador, al cerrar turno,
--    hace upsert (insert Y update por onConflict) y marca 'anulado' los que el
--    admin quitó; por eso UPDATE debe permitirse a autenticado. La anulación
--    manual desde /admin/creditos se controla en la UI (permiso 'anular').
-- ----------------------------------------------------------------------------
drop policy if exists creditos_update_admin  on public.creditos;
drop policy if exists creditos_update_anular on public.creditos;
drop policy if exists creditos_update        on public.creditos;
create policy creditos_update on public.creditos
  for update using (public.esta_autenticado()) with check (public.esta_autenticado());
-- (creditos_select y creditos_insert = autenticado, del schema.sql, se conservan.)

-- ----------------------------------------------------------------------------
-- 4) PAGOS DE CRÉDITO (cobranza): el trabajador NO los ve ni los toca.
--    Ver = permiso 'creditos'; registrar/anular = permiso 'pagos-credito'.
-- ----------------------------------------------------------------------------
drop policy if exists pagos_credito_select      on public.pagos_credito;
drop policy if exists pagos_credito_admin_write on public.pagos_credito;
drop policy if exists pagos_credito_write       on public.pagos_credito;
create policy pagos_credito_select on public.pagos_credito
  for select using (public.tiene_permiso('creditos'));
create policy pagos_credito_write on public.pagos_credito
  for all using (public.tiene_permiso('pagos-credito'))
  with check (public.tiene_permiso('pagos-credito'));

-- ----------------------------------------------------------------------------
-- 5) PRECIO_EVENTOS: registrar cambio de precio = permiso 'precios'
--    (select autenticado del schema se conserva).
-- ----------------------------------------------------------------------------
drop policy if exists precio_eventos_admin_write on public.precio_eventos;
drop policy if exists precio_eventos_write       on public.precio_eventos;
create policy precio_eventos_write on public.precio_eventos
  for insert with check (public.tiene_permiso('precios'));

-- ----------------------------------------------------------------------------
-- 6) AUDITORÍA: ver = permiso 'auditoria'; insertar = cualquier autenticado
--    (el trabajador registra auditoría al operar). (insert del schema se conserva.)
-- ----------------------------------------------------------------------------
drop policy if exists audit_select_admin on public.audit_log;
drop policy if exists audit_select_perm  on public.audit_log;
create policy audit_select_perm on public.audit_log
  for select using (public.tiene_permiso('auditoria'));

-- ----------------------------------------------------------------------------
-- 7) BACKUPS: el trabajador crea/poda un backup automático al COMPLETARSE un
--    turno (backupSiTurnoCompleto), por lo que ver/escribir se permite a
--    autenticado. La sección de backups del panel se limita por permiso en la UI.
-- ----------------------------------------------------------------------------
drop policy if exists backups_admin   on public.backups;
drop policy if exists backups_select  on public.backups;
drop policy if exists backups_write   on public.backups;
create policy backups_all on public.backups
  for all using (public.esta_autenticado()) with check (public.esta_autenticado());

-- ----------------------------------------------------------------------------
-- 8) CONFIG: escritura admin (precios/logo/trabajadores/admins) = es_admin
--    (se conserva `config_admin_write` del schema). PERO el trabajador aprende
--    nombres de cliente para el autocompletado (config key='clientes'); se le
--    permite SOLO esa clave. Las políticas permisivas se combinan con OR.
-- ----------------------------------------------------------------------------
drop policy if exists config_clientes_ins on public.config;
drop policy if exists config_clientes_upd on public.config;
create policy config_clientes_ins on public.config
  for insert with check (key = 'clientes' and public.esta_autenticado());
create policy config_clientes_upd on public.config
  for update using (key = 'clientes' and public.esta_autenticado())
  with check (key = 'clientes' and public.esta_autenticado());

-- profiles / sesiones: se conservan las políticas del schema.sql
--   * profiles: cada quien ve/edita lo suyo + es_admin; la gestión de usuarios
--     va por service_role en el servidor (bypassa RLS, valida requireDueno).
--   * sesiones: autenticado lee/escribe (trabajador y staff).
