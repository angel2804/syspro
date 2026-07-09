"use client";

// Editor de precios del sistema (diálogo del topbar admin) + input de precio con
// commit al salir + historial de cambios. Extraído de admin/page.tsx sin cambios
// de comportamiento.
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tag, History } from "lucide-react";
import { BALONES, PRODUCTOS } from "@/lib/config";
import { soles } from "@/lib/calc";
import {
  fetchHistorialPrecios,
  type PrecioEvento,
} from "@/lib/data/precios";
import type { PrecioKey, Precios } from "@/lib/types";

// Input de precio con estado LOCAL: el valor solo se confirma (sube al store)
// al salir del campo o presionar Enter, no en cada tecla. Así el admin puede
// escribir "18" sin que el sistema se recargue/reinicie a mitad de la edición.
function PrecioInput({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (v: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [local, setLocal] = useState(value ? String(value) : "");
  const [prevValue, setPrevValue] = useState(value);

  // Mientras no se está editando, refleja el valor externo (ej. otro cambio).
  // Ajuste de estado en render (patrón recomendado por React) en vez de effect.
  if (value !== prevValue && !focused) {
    setPrevValue(value);
    setLocal(value ? String(value) : "");
  }

  const commit = () => {
    const n = Number(local);
    onCommit(Number.isFinite(n) && n > 0 ? n : 0);
  };

  return (
    <Input
      type="number"
      step="0.01"
      inputMode="decimal"
      className="h-9"
      value={local}
      onFocus={() => setFocused(true)}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        }
      }}
      onWheel={(e) => e.currentTarget.blur()}
    />
  );
}

export function PreciosEditor({
  precios,
  onChange,
  puedeVerHistorial,
}: {
  precios: Precios;
  onChange: (
    k: PrecioKey,
    v: number,
    opts?: { motivo?: string; aplica?: "proximo" | "activo" }
  ) => void;
  puedeVerHistorial?: boolean;
}) {
  const combustibles: PrecioKey[] = ["bio", "regular", "premium", "glp"];
  const balones: PrecioKey[] = ["gasfull", "zetagas"];
  const label = (k: PrecioKey) =>
    (PRODUCTOS as Record<string, string>)[k] ??
    (BALONES as Record<string, string>)[k] ??
    k;
  const [motivo, setMotivo] = useState("");
  const [aplica, setAplica] = useState<"proximo" | "activo">("proximo");
  const [verHistorial, setVerHistorial] = useState(false);

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="secondary"
            className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <Tag className="mr-1 h-4 w-4" /> Precios
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Precios del sistema</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          El nuevo precio rige desde el <b>próximo turno</b>. Los turnos abiertos
          pueden conservarlo o actualizarse si eliges <b>Aplicar ya</b>.
        </p>
        {/* Motivo + alcance del cambio (quedan en el historial) */}
        <div className="grid grid-cols-1 gap-2 rounded-lg border bg-muted/40 p-2.5">
          <div className="space-y-1">
            <Label className="text-xs">Motivo del cambio (opcional)</Label>
            <Input
              className="h-8"
              placeholder="Ej. ajuste de mayorista"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={aplica === "proximo" ? "default" : "outline"}
              className="h-7 flex-1 text-xs"
              onClick={() => setAplica("proximo")}
            >
              Desde próximo turno
            </Button>
            <Button
              type="button"
              size="sm"
              variant={aplica === "activo" ? "default" : "outline"}
              className="h-7 flex-1 text-xs"
              onClick={() => setAplica("activo")}
            >
              Aplicar ya
            </Button>
          </div>
        </div>
        <div className="space-y-3">
          <div>
            <h4 className="mb-1 text-xs font-bold text-muted-foreground">
              COMBUSTIBLES (por galón)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {combustibles.map((k) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label(k)}</Label>
                  <PrecioInput
                    value={precios[k] || 0}
                    onCommit={(v) => onChange(k, v, { motivo, aplica })}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-bold text-muted-foreground">
              BALONES DE GAS (por unidad)
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {balones.map((k) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label(k)}</Label>
                  <PrecioInput
                    value={precios[k] || 0}
                    onCommit={(v) => onChange(k, v, { motivo, aplica })}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
        {puedeVerHistorial && (
          <div className="border-t pt-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-full justify-start text-xs text-muted-foreground"
              onClick={() => setVerHistorial((v) => !v)}
            >
              <History className="mr-1 h-3.5 w-3.5" />
              {verHistorial ? "Ocultar historial" : "Ver historial de precios"}
            </Button>
            {verHistorial && <HistorialPrecios />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Historial de cambios de precio (permiso 'precios-historial'). Carga bajo
// demanda al abrirse; más reciente primero.
function HistorialPrecios() {
  const [eventos, setEventos] = useState<PrecioEvento[] | null>(null);
  useEffect(() => {
    let vivo = true;
    fetchHistorialPrecios({ limite: 50 })
      .then((e) => vivo && setEventos(e))
      .catch(() => vivo && setEventos([]));
    return () => {
      vivo = false;
    };
  }, []);
  const label = (k: string) =>
    (PRODUCTOS as Record<string, string>)[k] ??
    (BALONES as Record<string, string>)[k] ??
    k;
  if (eventos == null)
    return <p className="px-1 py-2 text-xs text-muted-foreground">Cargando…</p>;
  if (eventos.length === 0)
    return (
      <p className="px-1 py-2 text-xs text-muted-foreground">
        Aún no hay cambios de precio registrados.
      </p>
    );
  return (
    <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
      {eventos.map((e) => (
        <div key={e.id} className="rounded-md bg-muted/50 px-2 py-1 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold">{label(e.producto)}</span>
            <span className="tabular-nums">
              {e.precioAnterior != null ? soles(e.precioAnterior) : "—"} →{" "}
              <b>{soles(e.precioNuevo)}</b>
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 text-muted-foreground">
            <span>
              {e.cambiadoPorNombre ?? "—"}
              {e.aplica === "activo" ? " · aplicó ya" : " · próximo turno"}
              {e.motivo ? ` · ${e.motivo}` : ""}
            </span>
            <span>{new Date(e.createdAt).toLocaleString("es-PE")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
