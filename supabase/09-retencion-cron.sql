-- ============================================================================
-- GrifoSys PRO — Retención de sesiones en el SERVIDOR (pg_cron), sin pérdida.
--
-- Reemplaza el borrado automático que hacía el navegador del admin (peligroso:
-- destruía historial financiero disparado por un render de la UI). Aquí, un
-- trabajo diario ARCHIVA (mueve, no borra) las sesiones de días operativos con
-- más de RETENCION_DIAS de antigüedad a la tabla `sesiones_archivo`. Los datos
-- NO se pierden: quedan disponibles para consulta/exportación histórica; solo
-- salen de la tabla "caliente" para mantenerla ligera.
--
-- Un día operativo con todos sus registros pesa ~5–20 KB, así que un año entero
-- (~30–60 MB) cabe de sobra en el plan gratuito (500 MB). Por eso la retención
-- por defecto es de 365 días: hay margen para años.
--
-- Cómo aplicar (una sola vez, en el SQL Editor de Supabase):
--   1) Ejecuta este archivo completo.
--   2) Verifica el job:  select * from cron.job;
--   3) (Opcional) Ejecuta la limpieza ahora:  select public.archivar_sesiones_viejas();
-- ============================================================================

-- 1) Extensión de cron (disponible en Supabase; idempotente).
create extension if not exists pg_cron;

-- 2) Tabla de archivo: misma forma que `sesiones` más la marca de archivado.
create table if not exists public.sesiones_archivo (
  id            text primary key,
  dia_operativo text not null,
  isla_id       text,
  turno         text,
  trabajador    text,
  cerrada       boolean,
  created_at    int8,
  updated_at    int8,
  data          jsonb,
  archivado_at  timestamptz not null default now()
);

-- El archivo es de solo lectura para el staff con permiso de auditoría; se
-- escribe solo desde la función SECURITY DEFINER de abajo.
alter table public.sesiones_archivo enable row level security;
drop policy if exists sesiones_archivo_select on public.sesiones_archivo;
create policy sesiones_archivo_select on public.sesiones_archivo
  for select using (public.tiene_permiso('auditoria') or public.es_admin());

-- 3) Función que archiva días operativos más viejos que RETENCION_DIAS.
--    SECURITY DEFINER: corre con privilegios del dueño de la función (bypassa
--    RLS) porque la ejecuta el cron, no un usuario final.
create or replace function public.archivar_sesiones_viejas(retencion_dias int default 365)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  corte text;
  movidas int;
begin
  -- Día operativo de corte en formato 'YYYY-MM-DD' (mismo que dia_operativo).
  corte := to_char((now() - make_interval(days => retencion_dias)), 'YYYY-MM-DD');

  with viejas as (
    select * from public.sesiones where dia_operativo < corte
  ), ins as (
    insert into public.sesiones_archivo
      (id, dia_operativo, isla_id, turno, trabajador, cerrada, created_at, updated_at, data)
    select id, dia_operativo, isla_id, turno, trabajador, cerrada, created_at, updated_at, data
    from viejas
    on conflict (id) do nothing
    returning id
  )
  select count(*) into movidas from ins;

  delete from public.sesiones where dia_operativo < corte;
  return movidas;
end;
$$;

-- 4) Programar el job diario (03:00). Se elimina primero para poder re-ejecutar
--    este archivo sin duplicar la programación.
select cron.unschedule('archivar-sesiones-viejas')
where exists (select 1 from cron.job where jobname = 'archivar-sesiones-viejas');

select cron.schedule(
  'archivar-sesiones-viejas',
  '0 3 * * *',
  $$ select public.archivar_sesiones_viejas(365); $$
);
