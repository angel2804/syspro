// Cliente Supabase (reemplaza a Firebase). Mientras no haya credenciales en
// .env.local, `getSupabase()` devuelve null y la app funciona 100% en local
// (localStorage vía Zustand), igual que antes con Firebase deshabilitado.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!url || !anonKey) return null; // sin credenciales aún
  client = createClient(url, anonKey, {
    // Fase 4: la sesión (anónima del trabajador o email del staff) se persiste
    // y auto-renueva para que Realtime y la RLS por rol respeten `auth.uid()`.
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    realtime: { params: { eventsPerSecond: 5 } },
  });
  return client;
}

export const supabaseHabilitado = !!(url && anonKey);
