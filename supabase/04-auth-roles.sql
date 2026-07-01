-- ============================================================================
-- GrifoSys PRO — Fase 4 (parte 1): ROLES + HELPERS + PERFIL AUTOMÁTICO
--
-- Este script es ADITIVO y SEGURO: NO activa la RLS restrictiva ni quita el
-- acceso anónimo de transición. Solo prepara la base para Supabase Auth:
--   * agrega el rol 'encargado';
--   * define helpers de rol/permiso usados por las policies;
--   * crea un perfil automático para los ingresos ANÓNIMOS del trabajador
--     (signInAnonymously) para que tengan un `auth.uid()` con rol 'trabajador'.
--
-- REQUISITO: en el Dashboard de Supabase → Authentication → Providers,
-- habilitar "Anonymous sign-ins". Sin eso, el login del trabajador fallará.
--
-- La activación de la RLS por rol (y el revertir del acceso anónimo) va en
-- `05-activar-rls.sql`, que se ejecuta AL FINAL, tras crear el usuario dueño.
-- Ejecutar en: Dashboard → SQL Editor → New query → pegar y RUN.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Rol 'encargado' (operativo-administrativo: cobranza de créditos).
--    4 roles base: dueno | admin | encargado | trabajador.
-- ----------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_rol_check;
alter table public.profiles
  add constraint profiles_rol_check
  check (rol in ('dueno','admin','encargado','trabajador'));

-- ----------------------------------------------------------------------------
-- 2) Helpers de rol/permiso (SECURITY DEFINER para usarlos en policies sin
--    recursión de RLS). `es_admin`/`es_dueno` ya existen en schema.sql; aquí se
--    redefinen para incluir 'encargado' donde corresponde y se agregan nuevos.
-- ----------------------------------------------------------------------------

-- El dueño: acceso total, siempre.
create or replace function public.es_dueno()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol = 'dueno' and p.activo
  );
$$;

-- ¿Tiene acceso a paneles administrativos? dueño/admin/encargado activos.
-- (El detalle de qué secciones ve cada uno lo decide `tiene_permiso`.)
create or replace function public.es_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.rol in ('dueno','admin','encargado') and p.activo
  );
$$;

-- Compatibilidad: `es_admin` (usada por policies del schema) = dueño o admin.
-- El encargado NO es "admin" a secas; sus accesos se validan por permiso.
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol in ('dueno','admin') and p.activo
  );
$$;

create or replace function public.es_encargado()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol = 'encargado' and p.activo
  );
$$;

-- ¿El usuario actual tiene un permiso concreto? El dueño SIEMPRE lo tiene.
-- Los demás lo tienen si la clave está en su arreglo `permisos` y están activos.
create or replace function public.tiene_permiso(clave text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.activo
      and (p.rol = 'dueno' or clave = any(p.permisos))
  );
$$;

-- `esta_autenticado` ya existe en schema.sql (auth.uid() is not null). Se deja igual.

-- ----------------------------------------------------------------------------
-- 3) TRABAJADOR = CUENTA COMPARTIDA (no usuarios por persona, no anónimos).
--    Todos los trabajadores entran con UNA sola cuenta técnica de Supabase Auth
--    (ej. trabajador@grifo.local) con rol 'trabajador'. El nombre real operativo
--    se elige después (lista config/trabajadores) y se guarda en
--    `sesiones.trabajador`. La identidad de Auth es siempre la misma cuenta.
--
--    La cuenta y su perfil se crean con `scripts/crear-trabajador.mjs` (o a mano
--    en el Dashboard + una fila en profiles con rol='trabajador', activo=true).
--
--    ⚠️ Recomendado: en Authentication → Providers, DESHABILITAR "Anonymous
--    sign-ins" (ya no se usan) para no permitir accesos sin cuenta.
--
--    Ya NO se usa el trigger de perfil anónimo: se elimina si existía de una
--    corrida previa de este script.
-- ----------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop trigger if exists on_auth_user_meta_update on auth.users;
drop function if exists public.handle_user_meta_update();

-- ----------------------------------------------------------------------------
-- 4) Limpieza de usuarios anónimos que hayan quedado de pruebas anteriores.
--    Borra los usuarios anónimos (sin email) creados antes de migrar a la
--    cuenta compartida. Requiere service_role. Devuelve cuántos borró.
--    Por defecto borra TODOS los anónimos (dias=0).
-- ----------------------------------------------------------------------------
create or replace function public.limpiar_trabajadores_anonimos(dias int default 0)
returns int language plpgsql security definer set search_path = public, auth as $$
declare borrados int;
begin
  with viejos as (
    delete from auth.users u
    where coalesce(u.is_anonymous, false)
      and u.created_at < now() - make_interval(days => dias)
    returning u.id
  )
  select count(*) into borrados from viejos;
  return borrados;
end;
$$;
