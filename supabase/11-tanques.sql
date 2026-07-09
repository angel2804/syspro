-- ============================================================================
-- GrifoSys PRO — Inventario de Tanques (SOLO REFERENCIA VISUAL).
--
-- Tabla nueva y aislada para que el medidor registre semanalmente el nivel
-- real medido de cada tanque. No participa en ningún cálculo de ventas,
-- cierre de turno ni reporte financiero: es puramente informativa para que el
-- admin tenga una idea del stock físico aproximado.
-- ============================================================================

create table if not exists public.tanque_registros (
  id             uuid primary key default gen_random_uuid(),
  producto       text not null check (producto in ('bio', 'regular', 'premium', 'glp')),
  capacidad_max  numeric not null check (capacidad_max > 0),
  nivel_medido   numeric not null check (nivel_medido >= 0),
  fecha_medicion date not null,
  medido_por     text,
  created_at     int8 not null default (extract(epoch from now()) * 1000)::int8
);

create index if not exists tanque_registros_producto_fecha_idx
  on public.tanque_registros (producto, fecha_medicion desc);

-- Capacidad fija por tanque. Se separa de la medición real para que el máximo
-- se edite como configuración y no cambie cada vez que se registra el nivel.
create table if not exists public.tanque_capacidades (
  producto       text primary key check (producto in ('bio', 'regular', 'premium', 'glp')),
  capacidad_max  numeric not null check (capacidad_max > 0),
  updated_at     int8 not null default (extract(epoch from now()) * 1000)::int8
);

insert into public.tanque_capacidades (producto, capacidad_max, updated_at)
select distinct on (producto)
  producto,
  capacidad_max,
  created_at
from public.tanque_registros
where capacidad_max > 1
order by producto, created_at desc
on conflict (producto) do nothing;

-- Recargas recibidas cuando llega combustible/petróleo al grifo. Son
-- informativas y se suman al estimado visual desde la última medición.
create table if not exists public.tanque_recargas (
  id              uuid primary key default gen_random_uuid(),
  producto        text not null check (producto in ('bio', 'regular', 'premium', 'glp')),
  galones         numeric not null check (galones > 0),
  fecha_recarga   date not null,
  proveedor       text,
  comprobante     text,
  registrado_por  text,
  created_at      int8 not null default (extract(epoch from now()) * 1000)::int8
);

create index if not exists tanque_recargas_producto_fecha_idx
  on public.tanque_recargas (producto, fecha_recarga desc);

alter table public.tanque_registros enable row level security;
alter table public.tanque_capacidades enable row level security;
alter table public.tanque_recargas enable row level security;

-- Solo staff con permiso 'inventario' (o admin/dueño) puede ver y registrar. Esta
-- sección no la usa el trabajador de turno.
drop policy if exists tanque_registros_select on public.tanque_registros;
create policy tanque_registros_select on public.tanque_registros
  for select using (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_registros_insert on public.tanque_registros;
create policy tanque_registros_insert on public.tanque_registros
  for insert with check (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_registros_delete on public.tanque_registros;
create policy tanque_registros_delete on public.tanque_registros
  for delete using (public.es_admin() or public.tiene_permiso('reset'));

drop policy if exists tanque_capacidades_select on public.tanque_capacidades;
create policy tanque_capacidades_select on public.tanque_capacidades
  for select using (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_capacidades_insert on public.tanque_capacidades;
create policy tanque_capacidades_insert on public.tanque_capacidades
  for insert with check (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_capacidades_update on public.tanque_capacidades;
create policy tanque_capacidades_update on public.tanque_capacidades
  for update using (public.es_admin() or public.tiene_permiso('inventario'))
  with check (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_capacidades_delete on public.tanque_capacidades;
create policy tanque_capacidades_delete on public.tanque_capacidades
  for delete using (public.es_admin() or public.tiene_permiso('reset'));

drop policy if exists tanque_recargas_select on public.tanque_recargas;
create policy tanque_recargas_select on public.tanque_recargas
  for select using (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_recargas_insert on public.tanque_recargas;
create policy tanque_recargas_insert on public.tanque_recargas
  for insert with check (public.es_admin() or public.tiene_permiso('inventario'));

drop policy if exists tanque_recargas_delete on public.tanque_recargas;
create policy tanque_recargas_delete on public.tanque_recargas
  for delete using (public.es_admin() or public.tiene_permiso('reset'));
