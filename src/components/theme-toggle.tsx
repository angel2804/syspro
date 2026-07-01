"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

// Botón para alternar claro/oscuro. El tema se aplica antes del primer
// pintado vía el script `beforeInteractive` de layout.tsx, así que la clase
// `dark` ya está en <html> al hidratar: leemos ese estado real con un
// inicializador perezoso (sin useEffect).
export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(() =>
    typeof document === "undefined"
      ? true // SSR: por defecto oscuro (coincide con el script de arranque)
      : document.documentElement.classList.contains("dark")
  );

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("gs-theme", next ? "dark" : "light");
    } catch {
      /* almacenamiento no disponible: el tema solo dura la sesión */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      title={dark ? "Modo claro" : "Modo oscuro"}
      suppressHydrationWarning
      className={cn(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 bg-white/10 text-white/90 transition-all hover:bg-white/20 hover:text-white active:scale-90",
        className
      )}
    >
      {dark ? (
        <Sun className="h-4 w-4 animate-in fade-in zoom-in-75 duration-200" />
      ) : (
        <Moon className="h-4 w-4 animate-in fade-in zoom-in-75 duration-200" />
      )}
    </button>
  );
}
