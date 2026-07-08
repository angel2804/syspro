-- ============================================================================
-- GrifoSys PRO — Créditos por cliente: PRECIO CON DESCUENTO + GRUPOS/SUB-CLIENTES
--
-- Dos requerimientos del negocio:
--
--  (A) PRECIO CON DESCUENTO por cliente. El grifero registra el crédito con el
--      precio normal del grifo (eso no cambia, ni afecta reportes del turno),
--      pero en la cuenta corriente los admins pueden darle a un cliente un
--      precio menor. Dos niveles:
--        * clientes.precio_credito  → precio fijo por galón para TODOS los
--          créditos de ese cliente (actuales y futuros).
--        * creditos.precio_ajustado → sobrescribe el precio de UN vale puntual
--          (el "lápiz" en la fila). Manda sobre precio_credito.
--      Precio efectivo = coalesce(precio_ajustado, cliente.precio_credito,
--      precio_unitario). La DEUDA usa el precio efectivo.
--
--  (B) GRUPOS / SUB-CLIENTES. Una empresa madre (p. ej. REDCOL) agrupa varios
--      sub-clientes (REDCOL ARDEPE, REDCOL CESAR…). Los CRÉDITOS se registran
--      por sub-cliente (para ver cuánto sacó cada uno), pero los PAGOS se
--      registran SOLO en el cliente madre (grupo). Deuda del grupo = suma de
--      créditos de la madre + sub-clientes − pagos de la madre.
--        * clientes.grupo_id → apunta al cliente madre (null = cliente normal
--          o él mismo es una madre). La agregación por grupo se calcula en la
--          app; aquí solo se guarda la relación y se protege el pago.
--
-- Aplicar en el SQL Editor de Supabase después de schema.sql (idempotente).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) Columnas de precio con descuento.
-- ----------------------------------------------------------------------------
alter table public.clientes
  add column if not exists precio_credito numeric(10,3)
    check (precio_credito is null or precio_credito >= 0);

alter table public.creditos
  add column if not exists precio_ajustado numeric(10,3)
    check (precio_ajustado is null or precio_ajustado >= 0);

-- ----------------------------------------------------------------------------
-- (B) Relación de grupo (sub-cliente → cliente madre).
-- ----------------------------------------------------------------------------
alter table public.clientes
  add column if not exists grupo_id uuid references public.clientes (id);
create index if not exists clientes_grupo_idx on public.clientes (grupo_id);

-- ----------------------------------------------------------------------------
-- Vista de saldos: la deuda usa el PRECIO EFECTIVO (con descuento) por crédito.
-- (La agregación por grupo se hace en la app usando clientes.grupo_id.)
-- ----------------------------------------------------------------------------
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
    select cr.cliente_id,
           sum(cr.galones * coalesce(cr.precio_ajustado, cl.precio_credito, cr.precio_unitario)) as total_creditos
    from public.creditos cr
    join public.clientes cl on cl.id = cr.cliente_id
    where cr.estado = 'activo'
    group by cr.cliente_id
  ) cr on cr.cliente_id = c.id
  left join (
    select cliente_id, sum(monto) as total_pagos
    from public.pagos_credito where estado = 'activo' group by cliente_id
  ) pg on pg.cliente_id = c.id;

-- ----------------------------------------------------------------------------
-- RLS créditos: reemplaza a la política de 08-rls-anular-creditos.sql sumando
-- una segunda guarda. Un autenticado puede editar un crédito, pero:
--   * dejarlo en 'anulado'  → solo admin o permiso 'anular'
--   * ponerle precio_ajustado (descuento) → solo admin o permiso 'creditos'
-- El trabajador (cuenta compartida) nunca hace ninguna de las dos en su flujo
-- normal (solo INSERTA al cerrar turno), así que no se ve afectado; se le
-- bloquea manipularlas desde la consola.
-- ----------------------------------------------------------------------------
drop policy if exists creditos_update on public.creditos;
create policy creditos_update on public.creditos
  for update
  using (public.esta_autenticado())
  with check (
    public.esta_autenticado()
    and (estado <> 'anulado' or public.es_admin() or public.tiene_permiso('anular'))
    and (precio_ajustado is null or public.es_admin() or public.tiene_permiso('creditos'))
  );

-- ----------------------------------------------------------------------------
-- RLS pagos: además del permiso 'pagos-credito', se PROHÍBE registrar/mover un
-- pago hacia un sub-cliente (grupo_id no nulo). Los pagos de un grupo van
-- siempre al cliente madre.
-- ----------------------------------------------------------------------------
drop policy if exists pagos_credito_write on public.pagos_credito;
create policy pagos_credito_write on public.pagos_credito
  for all
  using (public.tiene_permiso('pagos-credito'))
  with check (
    public.tiene_permiso('pagos-credito')
    and not exists (
      select 1 from public.clientes c
      where c.id = cliente_id and c.grupo_id is not null
    )
  );
