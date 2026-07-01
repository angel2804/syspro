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
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import type { Col } from "./registro-fields";

export type { Col } from "./registro-fields";

interface Props<T extends { id: string }> {
  titulo: string;
  islaNombre: string;
  columns: Col<T>[];
  rows: T[];
  onUpdate: (id: string, row: Partial<T>) => void;
  onRemove: (id: string) => void;
  resumen?: (rows: T[]) => string;
  trigger: ReactNode;
}

export function RegistroModal<T extends { id: string }>({
  titulo,
  islaNombre,
  columns,
  rows,
  onUpdate,
  onRemove,
  resumen,
  trigger,
}: Props<T>) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as ReactElement} />
      <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            {titulo}
            <Badge variant="outline">{islaNombre}</Badge>
            <Badge variant="secondary">{rows.length}</Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Tabla de registros con scroll interno y encabezado fijo */}
        <div className="max-h-[60vh] overflow-auto rounded-lg border text-xs [&_td]:px-2 [&_td]:py-0.5 [&_th]:px-2">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead className="h-8 w-10">#</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.key} className="h-8 font-bold">
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="h-8 w-12 text-right">—</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columns.length + 2}
                    className="py-6 text-center text-muted-foreground"
                  >
                    Sin registros. Agrégalos desde la sección «Ingresos».
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row, i) => (
                <TableRow key={row.id}>
                  <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key}>
                      {c.computar ? (
                        <span className="font-medium">{c.computar(row)}</span>
                      ) : c.tipo === "select" ? (
                        <Select
                          value={(row[c.key] as string) ?? ""}
                          onValueChange={(v) =>
                            onUpdate(row.id, { [c.key]: v } as Partial<T>)
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
                            onUpdate(row.id, {
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
                      onClick={() => onRemove(row.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {resumen && rows.length > 0 && (
          <div className="flex justify-end">
            <span className="rounded-lg bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary">
              {resumen(rows)}
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
