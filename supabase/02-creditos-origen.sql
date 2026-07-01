-- ============================================================================
-- GrifoSys PRO — migración aditiva: vincular créditos de la cuenta corriente
-- con el crédito original de la sesión del trabajador.
--
-- `origen_id` = "${sesion_id}:${credito_sesion_id}". Permite sincronizar de
-- forma IDEMPOTENTE los créditos de un turno hacia la cuenta corriente al
-- cerrar el turno (o al corregir una sesión cerrada) sin duplicar.
--
-- Ejecutar en: Dashboard → SQL Editor → New query → pegar y RUN.
-- ============================================================================
alter table public.creditos add column if not exists origen_id text;

-- UNIQUE permite múltiples NULL (créditos creados directo por el admin) y a la
-- vez sirve como destino de conflicto para el upsert de sincronización.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'creditos_origen_uniq'
  ) then
    alter table public.creditos add constraint creditos_origen_uniq unique (origen_id);
  end if;
end $$;
