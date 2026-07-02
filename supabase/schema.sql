-- ============================================================================
-- GrifoSys PRO — esquema Supabase (versión profesional)
-- Ejecutar en: Dashboard → SQL Editor → New query → pegar y RUN.
--
-- Diferencias con la maqueta original (supabase/schema.sql v2):
--   * Tablas relacionales para créditos por cliente (cuenta corriente),
--     pagos de crédito, clientes oficiales y alias, eventos de precio y
--     bitácora de auditoría — en vez de meter todo dentro de `data jsonb`.
--   * Las `sesiones` conservan su `data jsonb` (documento del turno) porque
--     ahí el modelo documental funciona bien y no se quiere romper el cálculo
--     de cuadre existente; pero se agregan columnas espejo indexables.
--   * Anti-duplicados de clientes con `pg_trgm` (similitud por trigramas).
--   * `updated_at` automático vía trigger.
--   * RLS preparada para Supabase Auth (roles dueño/admin/trabajador). Mientras
--     la app siga con auth propia se deja una política de transición explícita
--     y comentada — NO se usa `for all using (true)` en las tablas sensibles
--     sin dejar constancia de que es temporal.
-- ============================================================================

create extension if not exists pg_trgm;

-- ----------------------------------------------------------------------------
-- updated_at automático
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := (extract(epoch from now()) * 1000)::bigint;
  return new;
end;
$$;

-- ============================================================================
-- IDENTIDAD / ROLES
-- profiles: 1:1 con auth.users (Supabase Auth). El rol vive aquí, no en el
-- cliente. `permisos` es un arreglo de claves de sección del panel admin.
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  rol         text not null default 'trabajador'
              check (rol in ('dueno','admin','trabajador')),
  permisos    text[] not null default '{}',
  activo      boolean not null default true,
  trabajador_nombre text,            -- nombre operativo si rol=trabajador
  created_at  bigint not null default (extract(epoch from now())*1000)::bigint,
  updated_at  bigint not null default (extract(epoch from now())*1000)::bigint
);
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Helpers de rol (SECURITY DEFINER para usarlos dentro de policies sin recursión)
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol in ('admin','dueno') and p.activo
  );
$$;

create or replace function public.es_dueno()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol = 'dueno' and p.activo
  );
$$;

create or replace function public.esta_autenticado()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null;
$$;

-- ============================================================================
-- SESIONES (turnos). Documento del turno en `data jsonb`; columnas espejo
-- para filtrar por día/estado. id determinístico: ${dia}_${isla}_${turno}.
-- ============================================================================
create table if not exists public.sesiones (
  id             text primary key,
  dia_operativo  text  not null,
  isla_id        text  not null,
  turno          text  not null,
  trabajador     text,
  cerrada        boolean not null default false,
  created_at     bigint not null,
  updated_at     bigint not null,
  data           jsonb  not null
);
create index if not exists sesiones_dia_idx     on public.sesiones (dia_operativo);
create index if not exists sesiones_cerrada_idx on public.sesiones (cerrada);
create index if not exists sesiones_isla_turno_idx on public.sesiones (dia_operativo, isla_id, turno);

-- ============================================================================
-- CONFIG global (precios actuales, trabajadores, logo, nombre de la app…).
-- ============================================================================
create table if not exists public.config (
  key   text primary key,
  value jsonb not null
);

-- ============================================================================
-- PRECIOS — historial/eventos. La tabla `config('precios')` guarda el precio
-- VIGENTE (para lectura rápida y realtime); `precio_eventos` guarda CADA
-- cambio con quién, cuándo y por qué, para auditoría e historial.
-- ============================================================================
create table if not exists public.precio_eventos (
  id            uuid primary key default gen_random_uuid(),
  producto      text not null,                 -- bio|regular|premium|glp|gasfull|zetagas
  precio_anterior numeric(10,3),
  precio_nuevo  numeric(10,3) not null,
  aplica        text not null default 'proximo'  -- 'proximo' | 'activo'
                check (aplica in ('proximo','activo')),
  motivo        text,
  cambiado_por  uuid references public.profiles (id),
  cambiado_por_nombre text,
  created_at    bigint not null default (extract(epoch from now())*1000)::bigint
);
create index if not exists precio_eventos_prod_idx on public.precio_eventos (producto, created_at desc);

-- ============================================================================
-- CLIENTES (cuenta corriente). Cliente oficial + alias para anti-duplicados.
-- ============================================================================
create table if not exists public.clientes (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,              -- nombre oficial mostrado
  nombre_normalizado  text not null,              -- para comparar/deduplicar
  documento           text,
  telefono            text,
  estado              text not null default 'activo'
                      check (estado in ('activo','pendiente','fusionado','inactivo')),
  fusionado_en        uuid references public.clientes (id),  -- destino si fue fusionado
  creado_por          uuid references public.profiles (id),
  creado_por_nombre   text,
  created_at          bigint not null default (extract(epoch from now())*1000)::bigint,
  updated_at          bigint not null default (extract(epoch from now())*1000)::bigint
);
create index if not exists clientes_norm_idx on public.clientes (nombre_normalizado);
create index if not exists clientes_trgm_idx on public.clientes using gin (nombre_normalizado gin_trgm_ops);
create index if not exists clientes_estado_idx on public.clientes (estado);
drop trigger if exists trg_clientes_updated on public.clientes;
create trigger trg_clientes_updated before update on public.clientes
  for each row execute function public.set_updated_at();

create table if not exists public.cliente_alias (
  id                 uuid primary key default gen_random_uuid(),
  cliente_id         uuid not null references public.clientes (id) on delete cascade,
  alias              text not null,
  alias_normalizado  text not null,
  created_at         bigint not null default (extract(epoch from now())*1000)::bigint,
  unique (alias_normalizado)
);
create index if not exists cliente_alias_cli_idx on public.cliente_alias (cliente_id);
create index if not exists cliente_alias_trgm_idx on public.cliente_alias using gin (alias_normalizado gin_trgm_ops);

-- ============================================================================
-- CRÉDITOS (vales registrados por el trabajador). Aumentan la deuda del
-- cliente. El precio queda CONGELADO con el precio efectivo del turno.
-- ============================================================================
create table if not exists public.creditos (
  id                uuid primary key default gen_random_uuid(),
  cliente_id        uuid not null references public.clientes (id),
  sesion_id         text references public.sesiones (id),
  dia_operativo     text,
  fecha             bigint not null,              -- ms epoch (obligatorio)
  turno             text,
  isla_id           text,
  trabajador_id     uuid references public.profiles (id),
  trabajador_nombre text,
  producto          text not null,
  galones           numeric(12,3) not null check (galones > 0),
  vale              text not null,                -- obligatorio
  factura           text,
  precio_unitario   numeric(10,3) not null check (precio_unitario >= 0),
  total             numeric(12,2) not null,       -- galones * precio_unitario
  estado            text not null default 'activo'
                    check (estado in ('activo','anulado','corregido')),
  reemplaza_a       uuid references public.creditos (id),  -- si corrige a otro
  motivo            text,
  creado_por        uuid references public.profiles (id),
  created_at        bigint not null default (extract(epoch from now())*1000)::bigint,
  updated_at        bigint not null default (extract(epoch from now())*1000)::bigint
);
create index if not exists creditos_cliente_idx on public.creditos (cliente_id, fecha);
create index if not exists creditos_estado_idx  on public.creditos (estado);
create index if not exists creditos_sesion_idx  on public.creditos (sesion_id);
drop trigger if exists trg_creditos_updated on public.creditos;
create trigger trg_creditos_updated before update on public.creditos
  for each row execute function public.set_updated_at();

-- ============================================================================
-- PAGOS DE CRÉDITO (cobranza de deuda registrada por el admin). Disminuyen la
-- deuda total del cliente. NO se asignan a un vale; van contra el saldo.
-- Quedan SEPARADOS de los pagos electrónicos del turno (que viven en sesiones).
-- ============================================================================
create table if not exists public.pagos_credito (
  id              uuid primary key default gen_random_uuid(),
  cliente_id      uuid not null references public.clientes (id),
  fecha           bigint not null,
  monto           numeric(12,2) not null check (monto > 0),
  metodo_pago     text,                           -- efectivo|yape|transferencia|visa|culqui
  referencia      text,
  observacion     text,
  registrado_por  uuid references public.profiles (id),
  registrado_por_nombre text,
  estado          text not null default 'activo'
                  check (estado in ('activo','anulado','corregido')),
  reemplaza_a     uuid references public.pagos_credito (id),
  created_at      bigint not null default (extract(epoch from now())*1000)::bigint,
  updated_at      bigint not null default (extract(epoch from now())*1000)::bigint
);
create index if not exists pagos_credito_cliente_idx on public.pagos_credito (cliente_id, fecha);
create index if not exists pagos_credito_estado_idx  on public.pagos_credito (estado);
drop trigger if exists trg_pagos_credito_updated on public.pagos_credito;
create trigger trg_pagos_credito_updated before update on public.pagos_credito
  for each row execute function public.set_updated_at();

-- ============================================================================
-- VISTA de saldos por cliente (deuda = créditos activos - pagos activos).
-- ============================================================================
-- security_invoker=on: la vista respeta el RLS del usuario que consulta (no el
-- del owner). Evita el aviso "Security Definer View" del Advisor de Supabase.
create or replace view public.cliente_saldos
  with (security_invoker = on) as
  select
    c.id as cliente_id,
    c.nombre,
    coalesce(cr.total_creditos, 0) as total_creditos,
    coalesce(pg.total_pagos, 0)    as total_pagos,
    coalesce(cr.total_creditos, 0) - coalesce(pg.total_pagos, 0) as deuda_pendiente
  from public.clientes c
  left join (
    select cliente_id, sum(total) as total_creditos
    from public.creditos where estado = 'activo' group by cliente_id
  ) cr on cr.cliente_id = c.id
  left join (
    select cliente_id, sum(monto) as total_pagos
    from public.pagos_credito where estado = 'activo' group by cliente_id
  ) pg on pg.cliente_id = c.id;

-- ============================================================================
-- AUDITORÍA — bitácora consultable de acciones importantes.
-- ============================================================================
create table if not exists public.audit_log (
  id            uuid primary key default gen_random_uuid(),
  accion        text not null,        -- login|apertura_turno|cierre_turno|cambio_precio|
                                       -- edicion_sesion|reset|restauracion_backup|mover_trabajador|
                                       -- exportacion|credito_creado|credito_corregido|credito_anulado|
                                       -- pago_registrado|pago_corregido|pago_anulado|cliente_fusionado|alias_agregado
  entidad       text,                 -- tabla/dominio afectado
  entidad_id    text,
  actor_id      uuid references public.profiles (id),
  actor_nombre  text,
  detalle       jsonb not null default '{}'::jsonb,
  created_at    bigint not null default (extract(epoch from now())*1000)::bigint
);
create index if not exists audit_accion_idx on public.audit_log (accion, created_at desc);
create index if not exists audit_entidad_idx on public.audit_log (entidad, entidad_id);

-- ============================================================================
-- BACKUPS (copias de seguridad). Instantánea completa para recuperar datos.
-- ============================================================================
create table if not exists public.backups (
  id         text primary key,
  created_at bigint not null,
  dia        text   not null,
  sesiones   jsonb  not null,
  config     jsonb  not null default '{}'::jsonb
);
create index if not exists backups_created_idx on public.backups (created_at desc);

-- ============================================================================
-- Anti-duplicados: candidatos de cliente parecidos por similitud de trigramas.
-- Devuelve clientes oficiales cuyo nombre normalizado se parece al texto dado.
-- ============================================================================
create or replace function public.buscar_clientes_similares(
  texto text, umbral real default 0.35
)
returns table (id uuid, nombre text, similitud real)
language sql stable as $$
  select c.id, c.nombre, similarity(c.nombre_normalizado, lower(texto)) as similitud
  from public.clientes c
  where c.estado in ('activo','pendiente')
    and similarity(c.nombre_normalizado, lower(texto)) >= umbral
  order by similitud desc
  limit 8;
$$;

-- ============================================================================
-- Realtime
-- ============================================================================
alter publication supabase_realtime add table public.sesiones;
alter publication supabase_realtime add table public.config;
alter publication supabase_realtime add table public.clientes;
alter publication supabase_realtime add table public.creditos;
alter publication supabase_realtime add table public.pagos_credito;
alter publication supabase_realtime add table public.precio_eventos;

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.profiles       enable row level security;
alter table public.sesiones       enable row level security;
alter table public.config         enable row level security;
alter table public.precio_eventos enable row level security;
alter table public.clientes       enable row level security;
alter table public.cliente_alias  enable row level security;
alter table public.creditos       enable row level security;
alter table public.pagos_credito  enable row level security;
alter table public.audit_log      enable row level security;
alter table public.backups        enable row level security;

-- profiles: cada quien ve/edita lo suyo; admin gestiona todos.
drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.es_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all using (public.es_admin()) with check (public.es_admin());

-- Lectura para cualquier usuario autenticado; escritura segun rol.
drop policy if exists sesiones_auth_select on public.sesiones;
create policy sesiones_auth_select on public.sesiones
  for select using (public.esta_autenticado());
drop policy if exists sesiones_auth_write on public.sesiones;
create policy sesiones_auth_write on public.sesiones
  for all using (public.esta_autenticado()) with check (public.esta_autenticado());

drop policy if exists config_auth_select on public.config;
create policy config_auth_select on public.config
  for select using (public.esta_autenticado());
drop policy if exists config_admin_write on public.config;
create policy config_admin_write on public.config
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists precio_eventos_select on public.precio_eventos;
create policy precio_eventos_select on public.precio_eventos
  for select using (public.esta_autenticado());
drop policy if exists precio_eventos_admin_write on public.precio_eventos;
create policy precio_eventos_admin_write on public.precio_eventos
  for insert with check (public.es_admin());

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select using (public.esta_autenticado());
drop policy if exists clientes_write on public.clientes;
create policy clientes_write on public.clientes
  for all using (public.esta_autenticado()) with check (public.esta_autenticado());

drop policy if exists cliente_alias_select on public.cliente_alias;
create policy cliente_alias_select on public.cliente_alias
  for select using (public.esta_autenticado());
drop policy if exists cliente_alias_write on public.cliente_alias;
create policy cliente_alias_write on public.cliente_alias
  for all using (public.esta_autenticado()) with check (public.esta_autenticado());

-- créditos: el trabajador autenticado puede crear; corregir/anular es admin.
drop policy if exists creditos_select on public.creditos;
create policy creditos_select on public.creditos
  for select using (public.esta_autenticado());
drop policy if exists creditos_insert on public.creditos;
create policy creditos_insert on public.creditos
  for insert with check (public.esta_autenticado());
drop policy if exists creditos_update_admin on public.creditos;
create policy creditos_update_admin on public.creditos
  for update using (public.es_admin()) with check (public.es_admin());

-- pagos de crédito: SOLO admin.
drop policy if exists pagos_credito_select on public.pagos_credito;
create policy pagos_credito_select on public.pagos_credito
  for select using (public.esta_autenticado());
drop policy if exists pagos_credito_admin_write on public.pagos_credito;
create policy pagos_credito_admin_write on public.pagos_credito
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log
  for select using (public.es_admin());
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert with check (public.esta_autenticado());

drop policy if exists backups_admin on public.backups;
create policy backups_admin on public.backups
  for all using (public.es_admin()) with check (public.es_admin());

-- ----------------------------------------------------------------------------
-- TRANSICIÓN (solo si todavía NO migraste a Supabase Auth):
-- mientras la app use auth propia (nombre/contraseña) no habrá `auth.uid()`,
-- así que las policies de arriba bloquearán todo con la anon key. Para correr
-- la app en ese estado intermedio, descomenta el bloque siguiente. BORRARLO
-- al terminar la Fase 4 (Supabase Auth). NO dejar esto en producción real.
-- ----------------------------------------------------------------------------
-- create policy tmp_anon_sesiones on public.sesiones for all using (true) with check (true);
-- create policy tmp_anon_config   on public.config   for all using (true) with check (true);
-- create policy tmp_anon_clientes on public.clientes for all using (true) with check (true);
-- create policy tmp_anon_alias    on public.cliente_alias for all using (true) with check (true);
-- create policy tmp_anon_creditos on public.creditos for all using (true) with check (true);
-- create policy tmp_anon_pagos    on public.pagos_credito for all using (true) with check (true);
-- create policy tmp_anon_audit    on public.audit_log for all using (true) with check (true);
-- create policy tmp_anon_backups  on public.backups  for all using (true) with check (true);
-- create policy tmp_anon_precio   on public.precio_eventos for all using (true) with check (true);

-- ============================================================================
-- Semillas opcionales
-- ============================================================================
insert into public.config (key, value) values
  ('precios', '{"bio":15.0,"regular":16.0,"premium":17.5,"glp":2.5,"gasfull":60.0,"zetagas":58.0}'),
  ('trabajadores', '{"nombres":["Angel","Lenin","Miguel"]}'),
  ('clientes', '{"nombres":[]}'),
  ('clientes_descuento', '{"nombres":[]}'),
  ('app', '{"nombre":"GrifoSys"}')
on conflict (key) do nothing;
