-- Permite sincronizar la lista separada de clientes usados solo en descuentos.
-- Ejecutar en Supabase si la base ya existe y ya se aplicaron los scripts previos.

insert into public.config (key, value)
values
  ('clientes', '{"nombres":[]}'),
  ('clientes_descuento', '{"nombres":[]}')
on conflict (key) do nothing;

drop policy if exists config_clientes_ins on public.config;
drop policy if exists config_clientes_upd on public.config;

create policy config_clientes_ins on public.config
  for insert
  with check (
    key in ('clientes', 'clientes_descuento')
    and public.esta_autenticado()
  );

create policy config_clientes_upd on public.config
  for update
  using (
    key in ('clientes', 'clientes_descuento')
    and public.esta_autenticado()
  )
  with check (
    key in ('clientes', 'clientes_descuento')
    and public.esta_autenticado()
  );
