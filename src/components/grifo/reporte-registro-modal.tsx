"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getIsla, turnoLabel } from "@/lib/config";
import type { Sesion } from "@/lib/types";
import type { Col } from "./registro-fields";
import { AutocompleteInput } from "./autocomplete-input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export interface Grupo<T> {
  sesion: Sesion;
  rows: T[];
  columns: Col<T>[];
}

interface Props<T extends { id: string }> {
  titulo: string;
  grupos: Grupo<T>[];
  onUpdate: (sesionId: string, rowId: string, patch: Partial<T>) => void;
  onRemove: (sesionId: string, rowId: string) => void;
  trigger: ReactNode;
  // Si se proveen, habilitan agregar un registro nuevo a una de las
  // sesiones del día (p. ej. el admin corrige un pago que el trabajador
  // olvidó anotar). `nuevo` recibe la sesión elegida (para defaults que
  // dependen del producto/isla, como créditos o promociones).
  nuevo?: (sesion: Sesion) => Omit<T, "id">;
  validar?: (row: Omit<T, "id">) => string | null;
  onAdd?: (sesionId: string, row: Omit<T, "id">) => void;
  // Pie con un resumen (p. ej. total de pagos desglosado por tipo). Recibe
  // todas las filas del día (de todas las sesiones del filtro).
  resumen?: (rows: T[]) => string;
}

export function ReporteRegistroModal<T extends { id: string }>({
  titulo,
  grupos,
  onUpdate,
  onRemove,
  trigger,
  nuevo,
  validar,
  onAdd,
  resumen,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [grupoIdx, setGrupoIdx] = useState(0);
  const [draft, setDraft] = useState<Record<string, unknown>>({});

  const columns = grupos[0]?.columns ?? [];
  const editables = columns.filter((c) => !c.computar);
  // Filas aplanadas con su sesión de origen
  const filas = grupos.flatMap((g) =>
    g.rows.map((row) => ({ row, grupo: g }))
  );
  const grupoActivo = grupos[grupoIdx] ?? grupos[0];

  function abrir(v: boolean) {
    setOpen(v);
    if (v && grupos[0] && nuevo) {
      setGrupoIdx(0);
      setDraft(nuevo(grupos[0].sesion));
    }
  }

  function cambiarGrupo(idx: number) {
    setGrupoIdx(idx);
    if (nuevo && grupos[idx]) setDraft(nuevo(grupos[idx].sesion));
  }

  function agregar() {
    if (!onAdd || !grupoActivo) return;
    const row = draft as Omit<T, "id">;
    const err = validar?.(row);
    if (err) {
      toast.error(err);
      return;
    }
    onAdd(grupoActivo.sesion.id, row);
    toast.success("Registrado");
    if (nuevo) setDraft(nuevo(grupoActivo.sesion));
  }

  return (
    <Dialog open={open} onOpenChange={abrir}>
      <DialogTrigger render={trigger as ReactElement} />
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-base">{titulo} · reporte del día</DialogTitle>
        </DialogHeader>

        {onAdd && grupoActivo && (
          <div className="flex flex-wrap items-end gap-1.5 rounded-lg border bg-muted/30 p-2">
            <div className="min-w-[9rem] flex-1 space-y-1">
              <label className="text-[11px] text-muted-foreground">Encargado</label>
              <Select
                value={String(grupoIdx)}
                onValueChange={(v) => cambiarGrupo(Number(v))}
              >
                <SelectTrigger className="h-8 w-full text-xs">
                  <SelectValue>
                    {() => {
                      const g = grupos[grupoIdx];
                      if (!g) return null;
                      const isla = getIsla(g.sesion.islaId);
                      return `${g.sesion.trabajador} · ${isla?.nombre} · ${turnoLabel(g.sesion.turno)}`;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {grupos.map((g, i) => {
                    const isla = getIsla(g.sesion.islaId);
                    return (
                      <SelectItem key={g.sesion.id} value={String(i)}>
                        {g.sesion.trabajador} · {isla?.nombre} · {turnoLabel(g.sesion.turno)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {editables.map((c) => (
              <div key={c.key} className="min-w-[6.5rem] flex-1 space-y-1">
                <label className="text-[11px] text-muted-foreground">{c.label}</label>
                {c.tipo === "select" ? (
                  <Select
                    value={(draft[c.key] as string) ?? ""}
                    onValueChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue>
                        {(val: string) =>
                          c.options?.find((o) => o.value === val)?.label ?? val
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
                    className="h-8 text-xs"
                    suggestions={c.sugerencias}
                    value={(draft[c.key] as string) ?? ""}
                    onChange={(v) => setDraft((d) => ({ ...d, [c.key]: v }))}
                    onEnter={agregar}
                  />
                ) : (
                  <Input
                    className="h-8 text-xs"
                    type={c.tipo === "number" ? "number" : "text"}
                    value={
                      c.tipo === "number"
                        ? (draft[c.key] as number) || ""
                        : ((draft[c.key] as string) ?? "")
                    }
                    onWheel={(e) => e.currentTarget.blur()}
                    onKeyDown={(e) => e.key === "Enter" && agregar()}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        [c.key]:
                          c.tipo === "number"
                            ? e.target.value === ""
                              ? ""
                              : Number(e.target.value)
                            : e.target.value,
                      }))
                    }
                  />
                )}
              </div>
            ))}
            <Button size="sm" className="h-8" onClick={agregar}>
              + Agregar
            </Button>
          </div>
        )}

        <div className="max-h-[65vh] overflow-auto rounded-lg border text-xs [&_td]:px-2 [&_td]:py-0.5 [&_th]:px-2">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead className="h-8 font-bold">Encargado</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.key} className="h-8 font-bold">
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="h-8 w-12 text-right">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filas.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 2}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Sin registros
                  </TableCell>
                </TableRow>
              )}
              {filas.map(({ row, grupo }) => {
                const isla = getIsla(grupo.sesion.islaId);
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      <div className="font-semibold">{grupo.sesion.trabajador}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {isla?.nombre} · {turnoLabel(grupo.sesion.turno)}
                      </div>
                    </TableCell>
                    {grupo.columns.map((c) => (
                      <TableCell key={c.key}>
                        {c.computar ? (
                          <span className="font-medium">{c.computar(row)}</span>
                        ) : c.tipo === "select" ? (
                          <Select
                            value={(row[c.key] as string) ?? ""}
                            onValueChange={(v) =>
                              onUpdate(grupo.sesion.id, row.id, {
                                [c.key]: v,
                              } as Partial<T>)
                            }
                          >
                            <SelectTrigger className="h-7 w-full min-w-24 text-xs">
                              <SelectValue>
                                {(val: string) =>
                                  c.options?.find((o) => o.value === val)?.label ?? val
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
                            className="h-7 min-w-20 text-xs"
                            suggestions={c.sugerencias}
                            value={(row[c.key] as string) ?? ""}
                            onChange={(v) =>
                              onUpdate(grupo.sesion.id, row.id, {
                                [c.key]: v,
                              } as Partial<T>)
                            }
                          />
                        ) : (
                          <Input
                            className="h-7 min-w-20 text-xs"
                            type={c.tipo === "number" ? "number" : "text"}
                            value={
                              c.tipo === "number"
                                ? (row[c.key] as number) || ""
                                : ((row[c.key] as string) ?? "")
                            }
                            onWheel={(e) => e.currentTarget.blur()}
                            onChange={(e) =>
                              onUpdate(grupo.sesion.id, row.id, {
                                [c.key]:
                                  c.tipo === "number"
                                    ? Number(e.target.value)
                                    : e.target.value,
                              } as Partial<T>)
                            }
                          />
                        )}
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Eliminar"
                        className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => onRemove(grupo.sesion.id, row.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {resumen && filas.length > 0 && (
          <div className="flex justify-end">
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              {resumen(grupos.flatMap((g) => g.rows))}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
