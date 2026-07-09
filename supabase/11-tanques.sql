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

alter table public.tanque_registros enable row level security;

-- Solo staff con permiso 'config' (o admin/dueño) puede ver y registrar. Esta
-- sección no la usa el trabajador de turno.
drop policy if exists tanque_registros_select on public.tanque_registros;
create policy tanque_registros_select on public.tanque_registros
  for select using (public.es_admin() or public.tiene_permiso('config'));

drop policy if exists tanque_registros_insert on public.tanque_registros;
create policy tanque_registros_insert on public.tanque_registros
  for insert with check (public.es_admin() or public.tiene_permiso('config'));
