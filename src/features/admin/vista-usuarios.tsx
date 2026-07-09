"use client";

// Vista "Usuarios" del panel admin: alta/baja de trabajadores que pueden
// iniciar sesión. Extraída de admin/page.tsx (page.tsx sigue siendo dueño del
// estado y pasa props); comportamiento idéntico.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";

export function VistaUsuarios({
  nuevoNombre,
  setNuevoNombre,
  agregarTrabajador,
  trabajadores,
  quitarTrabajador,
}: {
  nuevoNombre: string;
  setNuevoNombre: (v: string) => void;
  agregarTrabajador: () => void;
  trabajadores: string[];
  quitarTrabajador: (nombre: string) => void;
}) {
  return (
    <div className="max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <h3 className="mb-1 text-base font-bold">Gestión de usuarios</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Trabajadores que pueden iniciar sesión y elegir turno. Los cambios se
        aplican en todo el sistema al instante.
      </p>
      <div className="mb-3 flex gap-2">
        <Input
          placeholder="Nombre del trabajador"
          value={nuevoNombre}
          onChange={(e) => setNuevoNombre(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregarTrabajador()}
          className="h-9"
        />
        <Button size="sm" className="h-9" onClick={agregarTrabajador}>
          + Agregar
        </Button>
      </div>
      <div className="space-y-2">
        {trabajadores.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No hay trabajadores registrados.
          </p>
        )}
        {trabajadores.map((nombre) => (
          <div
            key={nombre}
            className="flex items-center justify-between rounded-lg border p-2 text-sm"
          >
            <span className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 text-xs font-bold text-white">
                {nombre[0]}
              </span>
              {nombre}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-red-500 hover:text-red-600"
              onClick={() => quitarTrabajador(nombre)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
