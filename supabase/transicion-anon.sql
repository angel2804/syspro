-- ============================================================================
-- GrifoSys PRO — POLÍTICAS DE TRANSICIÓN (Fase 1–3)
--
-- Mientras la app use login propio (nombre/contraseña) y NO Supabase Auth, no
-- hay `auth.uid()`, así que las políticas por rol del schema bloquean a la
-- anon key. Este archivo agrega políticas que permiten acceso con la anon key
-- para poder operar la app durante la transición.
--
-- ⚠️  TEMPORAL. Al terminar la Fase 4 (Supabase Auth), ejecutar
--     `supabase/transicion-anon-revertir.sql` para quitarlas y dejar solo la
--     RLS por rol. NO dejar esto en producción definitiva.
--
-- Ejecutar en: Dashboard → SQL Editor → New query → pegar y RUN.
-- ============================================================================

create policy tmp_anon_sesiones       on public.sesiones       for all using (true) with check (true);
create policy tmp_anon_config         on public.config         for all using (true) with check (true);
create policy tmp_anon_clientes       on public.clientes       for all using (true) with check (true);
create policy tmp_anon_cliente_alias  on public.cliente_alias  for all using (true) with check (true);
create policy tmp_anon_creditos       on public.creditos       for all using (true) with check (true);
create policy tmp_anon_pagos_credito  on public.pagos_credito  for all using (true) with check (true);
create policy tmp_anon_precio_eventos on public.precio_eventos for all using (true) with check (true);
create policy tmp_anon_audit_log      on public.audit_log      for all using (true) with check (true);
create policy tmp_anon_backups        on public.backups        for all using (true) with check (true);
