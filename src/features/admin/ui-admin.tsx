"use client";

// Piezas presentacionales compartidas del panel admin, extraídas de
// admin/page.tsx (sin cambios de comportamiento): estado vacío reutilizable y
// los elementos de navegación del sidebar.
import { cn } from "@/lib/utils";

// Estado vacío reutilizable: icono en círculo + título + texto de ayuda.
export function EstadoVacio({
  icon,
  titulo,
  texto,
}: {
  icon: React.ReactNode;
  titulo: string;
  texto?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border/60 bg-card/50 px-6 py-16 text-center shadow-sm">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium">{titulo}</p>
      {texto && <p className="max-w-sm text-xs text-muted-foreground">{texto}</p>}
    </div>
  );
}

// Encabezado de grupo en el sidebar (Operación / Personal / Créditos / Sistema).
export function NavLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground first:pt-1">
      {children}
    </p>
  );
}

export function SideNav({
  activo,
  onClick,
  icon,
  label,
}: {
  activo: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex w-full items-center gap-2 overflow-hidden rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
        activo
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-foreground hover:translate-x-0.5 hover:bg-accent"
      )}
    >
      {/* Indicador lateral animado del ítem activo */}
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary transition-all duration-300",
          activo ? "opacity-100" : "opacity-0 -translate-x-1"
        )}
      />
      <span className="transition-transform duration-200 group-hover:scale-110">
        {icon}
      </span>
      {label}
    </button>
  );
}
