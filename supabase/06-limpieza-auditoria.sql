-- ============================================================================
-- GrifoSys PRO — LIMPIEZA AUTOMÁTICA DE AUDITORÍA (audit_log)
-- Ejecutar UNA VEZ en: Dashboard → SQL Editor → New query → pegar y RUN.
--
-- Motivo: `audit_log` es la tabla que más crece y nunca se borra sola (es el
-- ~60–70% del crecimiento de la base). Las `sesiones` y `backups` ya se podan
-- solas; esto hace lo mismo con la bitácora: borra lo más viejo que 6 meses y
-- así la tabla se mantiene PLANA para siempre, sin mantenimiento manual.
--
-- Es idempotente: puedes volver a correr todo este archivo sin problema
-- (la tarea programada se reemplaza por nombre).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Función que borra la auditoría más vieja que N meses.
--    created_at está en milisegundos epoch (bigint), igual que en el schema.
--    Devuelve cuántas filas borró (útil para verlo al ejecutarla a mano).
-- ----------------------------------------------------------------------------
create or replace function public.limpiar_auditoria_antigua(meses int default 6)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  corte     bigint;
  borradas  integer;
begin
  -- Momento de corte (ms epoch): ahora menos `meses`. make_interval respeta
  -- la duración real de cada mes.
  corte := (extract(epoch from (now() - make_interval(months => meses))) * 1000)::bigint;
  delete from public.audit_log where created_at < corte;
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) Programar la limpieza con pg_cron (dentro de la propia base de datos).
--    Corre cada DOMINGO 03:00 UTC (~22:00 hora Perú del sábado): tráfico bajo.
--    La auditoría crece lento, así que semanal es más que suficiente.
-- ----------------------------------------------------------------------------
create extension if not exists pg_cron;

-- cron.schedule con nombre: si la tarea ya existía, se actualiza (no duplica).
select cron.schedule(
  'limpiar-auditoria-6m',
  '0 3 * * 0',
  $$ select public.limpiar_auditoria_antigua(6); $$
);

-- ----------------------------------------------------------------------------
-- 3) (Opcional, UNA sola vez) Recuperar el disco de lo YA acumulado.
--    Un DELETE marca las filas como muertas pero NO devuelve el disco al
--    sistema; VACUUM FULL sí lo devuelve. Bloquea la tabla unos segundos, así
--    que córrelo cuando nadie esté usando el sistema. Descomenta para usarlo:
--
--    select public.limpiar_auditoria_antigua(6);  -- borra lo viejo ahora mismo
--    vacuum full analyze public.audit_log;        -- devuelve el disco liberado
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- Utilidades de verificación (opcionales):
--    -- Ver que la tarea quedó programada:
--    select jobname, schedule, command from cron.job where jobname = 'limpiar-auditoria-6m';
--    -- Ver el peso actual de la tabla:
--    select pg_size_pretty(pg_total_relation_size('public.audit_log'));
--    -- Para APAGAR la limpieza automática en el futuro:
--    select cron.unschedule('limpiar-auditoria-6m');
-- ----------------------------------------------------------------------------
