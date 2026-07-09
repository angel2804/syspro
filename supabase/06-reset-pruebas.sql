-- ============================================================================
-- GrifoSys PRO — Políticas DELETE para el RESET DE PRUEBAS (Fase 5)
--
-- Con la RLS de `05-activar-rls.sql` activa, varias tablas NO tenían política
-- DELETE, así que el botón "Resetear base de datos" (Configuraciones → Zona de
-- pruebas) borraba pagos/créditos con 204 pero SIN eliminar filas, y luego el
-- DELETE de `sesiones` fallaba con 409 (FK `creditos_sesion_id_fkey`).
--
-- Estas políticas permiten BORRAR (solo dueño/admin, vía es_admin) las tablas
-- de datos operativos, para poder dejar el sistema "de cero" al probar. NO se
-- tocan `backups` ni `profiles` (usuarios): el reset conserva ambos.
--
-- Correr una sola vez en el SQL Editor de Supabase. Idempotente.
-- ============================================================================

-- CRÉDITOS: borrar = dueño/admin (la operación normal solo inserta/actualiza).
drop policy if exists creditos_delete on public.creditos;
create policy creditos_delete on public.creditos
  for delete using (public.es_admin());

-- HISTORIAL DE PRECIOS: borrar = dueño/admin (solo para reset de pruebas).
drop policy if exists precio_eventos_delete on public.precio_eventos;
create policy precio_eventos_delete on public.precio_eventos
  for delete using (public.es_admin());

-- AUDITORÍA: borrar = dueño/admin (solo para reset de pruebas).
drop policy if exists audit_delete on public.audit_log;
create policy audit_delete on public.audit_log
  for delete using (public.es_admin());

-- INVENTARIO DE TANQUES: borrar = dueÃ±o/admin o permiso reset.
drop policy if exists tanque_registros_delete on public.tanque_registros;
create policy tanque_registros_delete on public.tanque_registros
  for delete using (public.es_admin() or public.tiene_permiso('reset'));

drop policy if exists tanque_capacidades_delete on public.tanque_capacidades;
create policy tanque_capacidades_delete on public.tanque_capacidades
  for delete using (public.es_admin() or public.tiene_permiso('reset'));

drop policy if exists tanque_recargas_delete on public.tanque_recargas;
create policy tanque_recargas_delete on public.tanque_recargas
  for delete using (public.es_admin() or public.tiene_permiso('reset'));

-- Nota: `pagos_credito` ya se puede borrar con permiso 'pagos-credito'
-- (política pagos_credito_write = for all). `clientes` con permiso 'clientes'
-- (clientes_delete). `cliente_alias` con permiso 'clientes' (cliente_alias_del)
-- y además cascada al borrar el cliente. `sesiones` con cualquier autenticado.
-- El dueño tiene todos los permisos, así que el reset completo funciona.
