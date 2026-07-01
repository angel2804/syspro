"use client";

import { useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { AutocompleteInput } from "./autocomplete-input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export type ColTipo = "text" | "number" | "select";

export interface Col<T> {
  key: keyof T & string;
  label: string;
  tipo: ColTipo;
  options?: { value: string; label: string }[];
  // sugerencias de autocompletado para campos de texto (p. ej. nombres de
  // clientes guardados). Se renderiza un <datalist> nativo: al teclear, el
  // navegador muestra las coincidencias.
  sugerencias?: string[];
  opcional?: boolean;
  // columna calculada de solo lectura (solo en la tabla)
  computar?: (row: T) => ReactNode;
}

interface AddFormProps<T extends { id: string }> {
  columns: Col<T>[];
  nuevo: () => Omit<T, "id">;
  validar?: (row: Omit<T, "id">) => string | null;
  onAdd: (row: Omit<T, "id">) => void;
  // dense: sin etiquetas (usa placeholders) y alturas reducidas — para layout compacto
  dense?: boolean;
}

export function RegistroAddForm<T extends { id: string }>({
  columns,
  nuevo,
  validar,
  onAdd,
  dense,
}: AddFormProps<T>) {
  const [draft, setDraft] = useState<Record<string, unknown>>(nuevo());
  const editables = columns.filter((c) => !c.computar);

  function setField(key: string, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function agregar() {
    const row = draft as Omit<T, "id">;
    const err = validar?.(row);
    if (err) {
      toast.error(err);
      return;
    }
    onAdd(row);
    toast.success("Registrado");
    // Reinicia el formulario PERO conserva la elección de los campos tipo
    // "select" (método de pago, producto…) para no re-seleccionarlos en cada
    // registro: si el trabajador eligió "visa", el siguiente arranca en "visa".
    const fresh = nuevo() as Record<string, unknown>;
    for (const c of columns) {
      if (c.tipo === "select" && draft[c.key] != null && draft[c.key] !== "") {
        fresh[c.key] = draft[c.key];
      }
    }
    setDraft(fresh);
  }

  const h = dense ? "h-7" : "h-9";
  const ph = (c: Col<T>) => `${c.label}${c.opcional ? "" : " *"}`;

  return (
    <div className="flex flex-wrap items-end gap-1.5">
      {editables.map((c) => (
        <div
          key={c.key}
          className={dense ? "min-w-[5.5rem] flex-1" : "min-w-[7rem] flex-1 space-y-1"}
        >
          {!dense && (
            <Label className="text-[11px] text-muted-foreground">
              {c.label}
              {!c.opcional && <span className="text-red-500"> *</span>}
            </Label>
          )}
          {c.tipo === "select" ? (
            <Select
              value={(draft[c.key] as string) ?? ""}
              onValueChange={(v) => setField(c.key, v)}
            >
              <SelectTrigger className={`${h} w-full text-xs`}>
                <SelectValue placeholder={dense ? c.label : "—"}>
                  {(val: string) =>
                    !val
                      ? dense
                        ? c.label
                        : "—"
                      : c.options?.find((o) => o.value === val)?.label ?? val
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {c.options?.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : c.sugerencias && c.sugerencias.length > 0 ? (
            <AutocompleteInput
              className={`${h} ${dense ? "text-xs" : ""}`}
              placeholder={dense ? ph(c) : undefined}
              suggestions={c.sugerencias}
              value={(draft[c.key] as string) ?? ""}
              onChange={(v) => setField(c.key, v)}
              onEnter={agregar}
            />
          ) : (
            <Input
              className={`${h} ${dense ? "text-xs" : ""}`}
              type={c.tipo === "number" ? "number" : "text"}
              placeholder={dense ? ph(c) : undefined}
              value={
                c.tipo === "number"
                  ? (draft[c.key] as number) || ""
                  : ((draft[c.key] as string) ?? "")
              }
              onWheel={(e) => e.currentTarget.blur()}
              onKeyDown={(e) => e.key === "Enter" && agregar()}
              onChange={(e) =>
                setField(
                  c.key,
                  c.tipo === "number"
                    ? e.target.value === ""
                      ? ""
                      : Number(e.target.value)
                    : e.target.value
                )
              }
            />
          )}
        </div>
      ))}
      <Button size="sm" className={`${h} ${dense ? "px-2 text-xs" : ""}`} onClick={agregar}>
        +
      </Button>
    </div>
  );
}
