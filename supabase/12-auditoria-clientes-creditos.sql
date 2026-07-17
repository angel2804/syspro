  -- GrifoSys PRO - Auditoria configurable, clientes y precios por rango.
  -- Migracion aditiva: ejecutar en Supabase SQL Editor cuando la app ya haya
  -- sido probada localmente.

  alter table public.profiles
    add column if not exists auditoria_activa boolean not null default true;

  comment on column public.profiles.auditoria_activa is
    'Si es false y el usuario es admin/encargado, sus acciones no se registran en audit_log.';

  create index if not exists profiles_auditoria_idx
    on public.profiles (auditoria_activa);

  alter table public.creditos
    drop constraint if exists creditos_cliente_id_fkey,
    add constraint creditos_cliente_id_fkey
      foreign key (cliente_id) references public.clientes (id) on delete cascade;

  alter table public.pagos_credito
    drop constraint if exists pagos_credito_cliente_id_fkey,
    add constraint pagos_credito_cliente_id_fkey
      foreign key (cliente_id) references public.clientes (id) on delete cascade;
