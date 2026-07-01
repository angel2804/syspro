"use client";

import { useEffect, useState } from "react";
import { useStore, type SyncEstado } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Check, CloudOff, Loader2, RefreshCw, Wifi } from "lucide-react";

// Indicador de sincronización con la nube, para la UI operativa. Muestra si los
// cambios están guardados, guardándose, pendientes o si no hay conexión, con la
// hora del último guardado. Reactivo al estado `sync` del store.
const META: Record<
  SyncEstado,
  { label: string; icon: typeof Wifi; clase: string; spin?: boolean }
> = {
  conectando: { label: "Conectando…", icon: Loader2, clase: "text-slate-300", spin: true },
  conectado: { label: "Conectado", icon: Wifi, clase: "text-emerald-300" },
  pendiente: { label: "Cambios sin guardar", icon: RefreshCw, clase: "text-amber-300" },
  guardando: { label: "Guardando…", icon: Loader2, clase: "text-sky-300", spin: true },
  guardado: { label: "Guardado", icon: Check, clase: "text-emerald-300" },
  sinConexion: { label: "Sin conexión", icon: CloudOff, clase: "text-red-300" },
};

function horaRelativa(ts: number): string {
  const seg = Math.floor((Date.now() - ts) / 1000);
  if (seg < 5) return "hace un momento";
  if (seg < 60) return `hace ${seg}s`;
  const min = Math.floor(seg / 60);
  if (min < 60) return `hace ${min} min`;
  return new Date(ts).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
}

export function SyncBadge({ className }: { className?: string }) {
  const sync = useStore((s) => s.sync);
  // Re-render periódico para refrescar el texto "hace Xs" del último guardado.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const meta = META[sync.estado];
  const Icon = meta.icon;
  const detalle =
    sync.estado === "guardado" && sync.ultimoGuardado
      ? horaRelativa(sync.ultimoGuardado)
      : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium",
        meta.clase,
        className
      )}
      title={detalle ? `Último guardado ${detalle}` : meta.label}
    >
      <Icon className={cn("h-3.5 w-3.5", meta.spin && "animate-spin")} />
      <span>{meta.label}</span>
      {detalle && <span className="text-white/50">· {detalle}</span>}
    </span>
  );
}
