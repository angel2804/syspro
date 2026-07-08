# GrifoSys PRO

Sistema operativo para una estación de servicios pequeña (grifo): turnos por
isla, cuadre, **créditos por cliente (cuenta corriente)**, reportes y
exportación a Excel. Instalable como **app (PWA)** en Windows, Android e iPhone.
Pensado para funcionar con **costo S/ 0** (Vercel Free + Supabase Free + GitHub).

Versión mejorada de la maqueta original (que queda intacta en `../grifosys-v2`).
Ver [`docs/DIAGNOSTICO-Y-PLAN.md`](docs/DIAGNOSTICO-Y-PLAN.md) para el diagnóstico
y el plan por fases.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind v4 · Zustand ·
Supabase (Postgres + Auth + Realtime) · exceljs · PWA.

---

## 1. Instalación local

```bash
npm install
cp .env.local.example .env.local   # y completa las credenciales (ver §2)
npm run dev                        # http://localhost:3000
```

Sin credenciales de Supabase, la app corre en **modo local** (localStorage),
sin sincronización en la nube — útil para probar la interfaz.

Scripts: `npm run dev` · `npm run build` · `npm test` (vitest) · `npm run lint`.

## 2. Configurar Supabase (proyecto nuevo)

1. Crea un proyecto en https://supabase.com (plan Free).
2. **Project Settings → API**: copia `Project URL` y `anon public` a `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
   ```
3. **SQL Editor → New query**: pega [`supabase/schema.sql`](supabase/schema.sql)
   y pulsa **RUN**. Crea tablas, índices, Realtime, la extensión `pg_trgm`
   (anti-duplicados) y las políticas **RLS por rol**.
4. *(Transición)* Mientras la app siga usando login por nombre/contraseña (no
   Supabase Auth), descomenta al final del schema el bloque `tmp_anon_*` para
   permitir acceso con la anon key. **Bórralo al migrar a Supabase Auth (Fase 4).**

> No reutilices las credenciales de la maqueta anterior: este proyecto usa su
> propia base de datos.

## 3. Deploy gratis en Vercel

1. Sube el repo a GitHub.
2. En https://vercel.com → **Add New → Project** → importa el repo.
3. **Environment Variables**: agrega `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (y `SUPABASE_SERVICE_ROLE_KEY` cuando llegue
   la Fase 4). Deploy. Vercel da HTTPS, requisito para instalar la PWA.

## 4. Instalar como app (PWA)

La app declara `display: standalone` y un service worker con soporte offline.

- **Windows (Chrome/Edge)**: abre la web → ícono **Instalar** en la barra de
  direcciones, o el botón **"Instalar app"** que aparece abajo a la derecha.
- **Android (Chrome)**: menú ⋮ → **Instalar aplicación / Agregar a inicio**.
- **iPhone/iPad (Safari)**: **Compartir** → **Agregar a inicio**. (iOS no
  muestra botón automático; la instalación es manual.)

Offline: si no hay internet, la app abre igual y muestra un aviso; los datos se
sincronizan al reconectar.

## 5. Roles iniciales

| Rol | Puede |
|-----|-------|
| **dueño** | Todo: usuarios, reset, backups, configuración, auditoría, fusión de clientes. |
| **admin** | Reportes, precios (si tiene permiso), mover trabajador (si tiene permiso), exportar, **registrar pagos de crédito**, gestionar clientes (si tiene permiso). |
| **trabajador** | Abrir/cerrar su turno, registrar datos y **créditos** (no pagos), ver solo su turno activo. |

El acceso es **siempre por Supabase Auth** (email + contraseña para el staff;
cuenta compartida para trabajadores) con la tabla `profiles` (rol + permisos);
la validación real la da la **RLS por rol/permiso** en la base de datos. Ya
**no existen** contraseñas embebidas en el cliente (`NEXT_PUBLIC_ADMIN_PASSWORD`
/ `NEXT_PUBLIC_CONFIG_PASSWORD` fueron eliminadas): crea al primer dueño desde
`/bootstrap` antes de desplegar, y usa el correo de recuperación de Supabase si
olvidas la contraseña. La sección "Configuraciones" (backups/reset) se protege
con los permisos `backups-*` / `reset` del perfil.

> **Migraciones a aplicar** (SQL Editor de Supabase, en orden):
> `supabase/08-rls-anular-creditos.sql` (endurece la anulación de créditos),
> `supabase/09-retencion-cron.sql` (archiva días viejos con `pg_cron`, sin
> borrar historial; retención en caliente **365 días**, antes 7) y
> `supabase/10-creditos-grupos-precio.sql` (precio con descuento por cliente/
> vale y grupos de sub-clientes tipo REDCOL). La `10` reemplaza la política de
> créditos de la `08`, así que si aplicas ambas, corre la `10` al final.

## 6. Límites del plan gratuito

- **Supabase Free**: 500 MB de base de datos, 1 GB de archivos, ~2 proyectos
  activos, pausa por inactividad tras ~1 semana sin uso (se reactiva solo).
  Realtime y Auth incluidos. Suficiente para una estación pequeña.
- **Vercel Free (Hobby)**: uso personal/no comercial, 100 GB de ancho de banda,
  funciones serverless con límites de tiempo. Suficiente para esta app.
- **GitHub Free**: repos privados ilimitados.

Sin VPS, sin Play Store / App Store, sin servicios pagos.

## 7. Créditos por cliente (cuenta corriente)

La sección **"Créditos por cliente"** funciona como un **estado de cuenta**:

- Un **crédito** (vale que registra el trabajador) **aumenta** la deuda. El
  precio queda **congelado** con el precio efectivo del turno.
- Un **pago** (lo registra el **admin**) **disminuye** la deuda. Los pagos NO se
  asignan a un vale: van contra el **saldo total** del cliente.
- `deuda pendiente = total créditos activos − total pagos activos`.
- El estado de cuenta lista créditos y pagos en orden cronológico; cada fila
  recalcula el saldo acumulado (deuda en negativo). Ejemplo (cliente Belquer):

  | Galones | Producto | Vale | Precio | Total crédito | Pago | Deuda pendiente |
  |--------:|----------|------|-------:|--------------:|-----:|----------------:|
  | 10 | BIO | 0001 | 19.20 | 192.00 |  | -192.00 |
  |  |  |  |  |  | 100 | -92.00 |

- Estados del cliente: **sin deuda** (0), **con deuda** (>0), **saldo a favor**
  (<0, pagó de más). Movimientos: `activo` / `anulado` / `corregido` (solo los
  `activos` cuentan).
- Los pagos de crédito son **cobranza de deuda**, no venta nueva: quedan en su
  propia tabla (`pagos_credito`), separados de los pagos electrónicos del turno,
  y se reportan aparte.

Dominio puro y testeado en `src/lib/domain/cuenta-corriente.ts`.

## 8. Prevención de duplicados y fusión de clientes

Para que "Belquer", "belqer", "beqer", "Belquer SAC" y "Belker" no creen 5
clientes:

- **Normalización**: minúsculas, sin tildes ni puntuación, sin sufijos
  societarios (SAC/EIRL/SRL…).
- **Búsqueda difusa**: Levenshtein + similitud por trigramas (igual que
  `pg_trgm` en Postgres). Al escribir, se sugiere *"¿quisiste decir Belquer?"*.
- **Anti-duplicados**: si el nombre se parece mucho a uno existente, **no** se
  crea automáticamente; se pide confirmar (usar el existente) o crear nuevo.
- **Alias**: un cliente puede tener varios alias; si el trabajador escribe un
  alias, se asocia al cliente oficial.
- **Fusión** (admin/dueño): fusionar `belqer` dentro de `Belquer` reapunta
  todos sus créditos, pagos y alias al oficial, convierte el nombre fusionado en
  alias, recalcula la deuda, marca el duplicado como `fusionado` (no se borra) y
  deja **auditoría**. Lógica en `src/lib/domain/clientes.ts`.

## 9. Arquitectura

- `src/lib/domain/` — dominio **puro** (sin Supabase ni React), testeado:
  `cuenta-corriente`, `clientes`. El cuadre/día operativo sigue en `src/lib/calc.ts`.
- `src/lib/data/` — servicios de acceso a datos sobre Supabase
  (`clientes`, `creditos`, `auditoria`). Las páginas no tocan Supabase directo.
- `src/lib/supabase.ts` + `src/lib/db.ts` — cliente y operaciones de sesiones/config.
- `src/components/` — `supabase-sync` (Realtime), `pwa` (instalación + offline).
- `src/app/` — rutas: `/` login, `/setup`, `/dashboard`, `/admin`, `/offline`,
  `/manifest.webmanifest`, `/api/export-*`.
- `supabase/schema.sql` — esquema, RLS, triggers, funciones.
