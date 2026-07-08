-- ============================================================================
-- GrifoSys PRO — Endurecer la ANULACIÓN de créditos en la base de datos (RLS).
--
-- PROBLEMA que corrige:
--   La política anterior `creditos_update` permitía a CUALQUIER autenticado
--   hacer UPDATE de un crédito, incluido cambiar su estado a 'anulado'. Como el
--   trabajador entra con una cuenta compartida autenticada, desde la consola del
--   navegador podía anular créditos (reducir la deuda de un cliente) sin ser
--   admin. La restricción "solo con permiso 'anular'" vivía SOLO en la UI.
--
-- CRITERIO (por qué esta política no rompe la operación normal):
--   * El trabajador, al CERRAR turno, solo INSERTA créditos en el ledger
--     (upsert por `origen_id`, primera vez = insert, estado 'activo'). Nunca
--     necesita poner 'anulado': la anulación por corrección la hace el admin
--     al re-sincronizar una sesión ya cerrada.
--   * Por eso basta con: permitir UPDATE a autenticado, pero PROHIBIR que el
--     resultado quede en estado 'anulado' salvo que el actor sea admin
--     (dueño/admin) o tenga el permiso 'anular'. Los upserts del trabajador
--     dejan estado 'activo', así que pasan sin problema.
--
--   * Los PAGOS de crédito (cobranza) ya estaban bien: `pagos_credito_write`
--     exige permiso 'pagos-credito' para TODA escritura, así que el trabajador
--     no puede anular pagos. No se toca aquí.
--
-- Requiere las funciones ya existentes: public.esta_autenticado(),
-- public.es_admin(), public.tiene_permiso(text). Reversible: para volver al
-- comportamiento anterior, recrea `creditos_update` solo con esta_autenticado().
-- ============================================================================

drop policy if exists creditos_update on public.creditos;
create policy creditos_update on public.creditos
  for update
  using (public.esta_autenticado())
  with check (
    public.esta_autenticado()
    and (
      estado <> 'anulado'
      or public.es_admin()
      or public.tiene_permiso('anular')
    )
  );

-- Nota: la anulación desde /admin/creditos (anularCredito) seguirá funcionando
-- para el dueño/admin y para cualquier usuario con el permiso 'anular'. Un
-- usuario sin ese permiso (o el trabajador) recibirá un error de RLS al intentar
-- el UPDATE a 'anulado', que es justamente lo que buscamos.
