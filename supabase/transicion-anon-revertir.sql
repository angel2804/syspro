-- ============================================================================
-- GrifoSys PRO — REVERTIR políticas de transición (al iniciar la Fase 4)
-- Quita el acceso anónimo y deja solo la RLS por rol del schema.
-- ============================================================================
drop policy if exists tmp_anon_sesiones       on public.sesiones;
drop policy if exists tmp_anon_config         on public.config;
drop policy if exists tmp_anon_clientes        on public.clientes;
drop policy if exists tmp_anon_cliente_alias  on public.cliente_alias;
drop policy if exists tmp_anon_creditos       on public.creditos;
drop policy if exists tmp_anon_pagos_credito  on public.pagos_credito;
drop policy if exists tmp_anon_precio_eventos on public.precio_eventos;
drop policy if exists tmp_anon_audit_log      on public.audit_log;
drop policy if exists tmp_anon_backups        on public.backups;
