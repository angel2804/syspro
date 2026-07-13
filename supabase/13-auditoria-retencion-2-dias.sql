-- GrifoSys PRO - Retencion corta de auditoria.
-- Mantiene audit_log por maximo 2 dias y reemplaza el cron anterior de 6 meses.

create extension if not exists pg_cron;

drop function if exists public.limpiar_auditoria_antigua(integer);

create or replace function public.limpiar_auditoria_antigua(dias int default 2)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  corte bigint;
  borradas integer;
begin
  corte := (extract(epoch from (now() - make_interval(days => dias))) * 1000)::bigint;
  delete from public.audit_log where created_at < corte;
  get diagnostics borradas = row_count;
  return borradas;
end;
$$;

select cron.unschedule('limpiar-auditoria-6m')
where exists (select 1 from cron.job where jobname = 'limpiar-auditoria-6m');

select cron.unschedule('limpiar-auditoria-2d')
where exists (select 1 from cron.job where jobname = 'limpiar-auditoria-2d');

select cron.schedule(
  'limpiar-auditoria-2d',
  '0 8 * * *',
  $$ select public.limpiar_auditoria_antigua(2); $$
);

select public.limpiar_auditoria_antigua(2);
