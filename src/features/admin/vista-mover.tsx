"use client";

// Vista "Mover trabajador" del panel admin: corrige la isla mal elegida moviendo
// al trabajador y sus registros (los odómetros no se mueven). Extraída de
// admin/page.tsx sin cambios de comportamiento; page.tsx mantiene el estado.
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeftRight } from "lucide-react";
import { getIsla, turnoLabel } from "@/lib/config";
import { cn } from "@/lib/utils";
import type { Isla, Sesion } from "@/lib/types";

export function VistaMover({
  activos,
  moverOrigenId,
  setMoverOrigenId,
  setMoverDestinoIsla,
  moverOrigen,
  moverDestinoIsla,
  islasDestino,
  moverDestino,
  destinoCerrado,
  setConfirmandoMover,
}: {
  activos: Sesion[];
  moverOrigenId: string | null;
  setMoverOrigenId: (v: string | null) => void;
  setMoverDestinoIsla: (v: string | null) => void;
  moverOrigen: Sesion | null;
  moverDestinoIsla: string | null;
  islasDestino: Isla[];
  moverDestino: Sesion | null;
  destinoCerrado: boolean;
  setConfirmandoMover: (v: boolean) => void;
}) {
  return (
    <div className="max-w-md animate-fade-up rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold">
        <ArrowLeftRight className="h-4 w-4" /> Mover trabajador de isla
      </h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Corrige cuando un trabajador eligió la isla equivocada. Se mueve su
        nombre y todos sus registros (pagos, créditos, ventas, gastos…) a la isla
        correcta. <b>Los odómetros NO se mueven</b>: pertenecen a la isla física
        y se quedan donde están.
      </p>
      {activos.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No hay turnos activos para mover.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-xs">Trabajador / isla actual</Label>
            <Select
              value={moverOrigenId ?? ""}
              onValueChange={(v) => {
                setMoverOrigenId(v);
                setMoverDestinoIsla(null);
              }}
            >
              <SelectTrigger className="h-9 w-full">
                <SelectValue placeholder="Elige el turno a corregir" />
              </SelectTrigger>
              <SelectContent>
                {activos.map((s) => {
                  const isla = getIsla(s.islaId);
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {isla?.nombre} · {turnoLabel(s.turno)} · {s.trabajador}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {moverOrigen && (
            <div className="space-y-1">
              <Label className="text-xs">Isla correcta (destino)</Label>
              <Select
                value={moverDestinoIsla ?? ""}
                onValueChange={(v) => setMoverDestinoIsla(v)}
              >
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Elige la isla destino" />
                </SelectTrigger>
                <SelectContent>
                  {islasDestino.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {moverOrigen && moverDestinoIsla && (
            <div
              className={cn(
                "rounded-lg border p-3 text-xs",
                destinoCerrado
                  ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/30 dark:bg-red-950/20 dark:text-red-300"
                  : "border-sky-300/60 bg-sky-50 text-sky-800 dark:border-sky-500/30 dark:bg-sky-950/20 dark:text-sky-200"
              )}
            >
              {destinoCerrado ? (
                <span>
                  La isla destino ya cerró su turno; no se puede mover ahí.
                </span>
              ) : moverDestino ? (
                <span>
                  <b>Intercambio.</b> {moverOrigen.trabajador} pasará a{" "}
                  <b>{getIsla(moverDestinoIsla)?.nombre}</b> y{" "}
                  {moverDestino.trabajador} pasará a{" "}
                  <b>{getIsla(moverOrigen.islaId)?.nombre}</b>. Cada isla conserva
                  su odómetro.
                </span>
              ) : (
                <span>
                  <b>Mover a isla libre.</b> {moverOrigen.trabajador} pasará a{" "}
                  <b>{getIsla(moverDestinoIsla)?.nombre}</b> con el odómetro
                  propio de esa isla. El turno de{" "}
                  {getIsla(moverOrigen.islaId)?.nombre} se eliminará (como si
                  nunca se hubiera abierto ahí); su odómetro no se rompe.
                </span>
              )}
            </div>
          )}

          <Button
            className="w-full"
            disabled={!moverOrigen || !moverDestinoIsla || destinoCerrado}
            onClick={() => setConfirmandoMover(true)}
          >
            <ArrowLeftRight className="mr-1 h-4 w-4" /> Mover trabajador
          </Button>
        </div>
      )}
    </div>
  );
}
