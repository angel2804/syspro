"use client";

// ============================================================================
// AuthProvider (Fase 4): reconcilia la sesión de Supabase Auth con el store.
//  * Al montar y ante cambios de auth, lee el perfil real de `profiles` y lo
//    vuelca al store (fuente de verdad del rol/permisos).
//  * Si Supabase pierde la sesión (logout/expiración), limpia el store.
// No renderiza nada.
// ============================================================================
import { useEffect } from "react";
import { getSupabase, supabaseHabilitado } from "@/lib/supabase";
import { cargarPerfil } from "@/lib/data/auth";
import { useStore } from "@/lib/store";

export function AuthProvider() {
  const setAuth = useStore((s) => s.setAuth);
  const logout = useStore((s) => s.logout);

  useEffect(() => {
    if (!supabaseHabilitado) return;
    const sb = getSupabase();
    if (!sb) return;
    let vivo = true;

    async function reconciliar() {
      const perfil = await cargarPerfil();
      if (!vivo) return;
      if (!perfil || !perfil.activo) {
        // Sesión sin perfil válido: no forzamos logout del store aquí para no
        // interferir con el login legacy por contraseña maestra (transición).
        return;
      }
      const actual = useStore.getState().auth;
      const trabajadorLocal =
        perfil.rol === "trabajador"
          ? actual?.rol === "trabajador" && actual.trabajador
            ? actual.trabajador
            : perfil.trabajadorNombre ?? perfil.nombre
          : "";
      setAuth({
        rol: perfil.rol,
        // La cuenta de trabajador es compartida entre PCs. El nombre operativo
        // elegido (Bill, Angel, etc.) pertenece a ESTE navegador, no al perfil
        // global de Supabase.
        trabajador: trabajadorLocal,
        nombre: perfil.rol === "trabajador" ? trabajadorLocal : perfil.nombre,
        permisos: perfil.permisos,
        auditoriaActiva: perfil.auditoriaActiva,
        userId: perfil.id,
      });
    }

    reconciliar();

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        if (vivo) logout();
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (
          event === "SIGNED_IN" &&
          session?.user.id &&
          useStore.getState().auth?.userId === session.user.id
        ) {
          return;
        }
        reconciliar();
      }
    });

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, [setAuth, logout]);

  return null;
}
