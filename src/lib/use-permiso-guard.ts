"use client";

// ============================================================================
// Guardia de acceso por ROL/PERMISO para páginas del panel (Fase 4).
//  * Bloquea el acceso por URL directa: si el usuario no es staff → al login;
//    si es staff pero le falta el permiso → de vuelta al panel.
//  * El dueño siempre pasa. La protección REAL de datos la da la RLS en la BD;
//    esto evita además que se vean pantallas sin permiso.
// Devuelve { listo, permitido } para que la página muestre "verificando…"
// mientras hidrata y no parpadee contenido no autorizado.
// ============================================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStore } from "./store";
import type { Permiso, Rol } from "./types";

const STAFF: Rol[] = ["dueno", "admin", "encargado"];

export function usePermisoGuard(permiso?: Permiso) {
  const router = useRouter();
  const auth = useStore((s) => s.auth);
  const [listo, setListo] = useState(false);

  /* eslint-disable-next-line react-hooks/set-state-in-effect --
     Marca de hidratación en cliente para no redirigir antes de que el store
     persistido se rehidrate (mismo patrón usado en el resto de páginas). */
  useEffect(() => setListo(true), []);

  const esStaff = !!auth && STAFF.includes(auth.rol);
  const tienePermiso =
    esStaff && (auth!.rol === "dueno" || !permiso || auth!.permisos.includes(permiso));

  useEffect(() => {
    if (!listo) return;
    if (!esStaff) {
      router.replace("/");
    } else if (!tienePermiso) {
      router.replace("/admin");
    }
  }, [listo, esStaff, tienePermiso, router]);

  return { listo, permitido: listo && tienePermiso, auth };
}
