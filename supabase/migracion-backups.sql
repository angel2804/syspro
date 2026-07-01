-- GrifoSys v2 — Migración: tabla de backups (copias de seguridad)
-- Ejecuta este archivo UNA vez en el SQL Editor de Supabase
-- (Dashboard → SQL Editor → New query → pega y RUN).
--
-- Guarda instantáneas completas de TODAS las sesiones + la config para
-- poder recuperar datos ante errores. Especialmente los odómetros, que
-- son continuos entre el turno noche de un día y el turno mañana del
-- siguiente. La app conserva como máximo 3 copias.

create table if not exists public.backups (
  id         text primary key,        -- bk_<timestamp>
  created_at bigint not null,
  dia        text   not null,         -- día operativo de la instantánea
  sesiones   jsonb  not null,         -- array de Sesion completas
  config     jsonb  not null default '{}'::jsonb
);

create index if not exists backups_created_idx on public.backups (created_at desc);

alter table public.backups enable row level security;

drop policy if exists "backups_anon_all" on public.backups;
create policy "backups_anon_all" on public.backups
  for all using (true) with check (true);
