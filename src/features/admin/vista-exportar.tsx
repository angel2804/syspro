"use client";

// Vista "Exportar" del panel admin: descarga de reportes en Excel por turno
// (3 islas), por isla individual y el reporte general del día. Extraída de
// admin/page.tsx sin cambios de comportamiento; page.tsx mantiene el estado.
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download } from "lucide-react";
import { ISLAS, TURNOS } from "@/lib/config";
import type { TurnoId } from "@/lib/types";

export function VistaExportar({
  diasAConservar,
  selectedDia,
  turnosListos,
  exportTurno,
  setExportTurno,
  descargarXlsx,
  exportando,
  turnosConIsla,
  exportTurnoIsla,
  setExportTurnoIsla,
  exportIslaId,
  setExportIslaId,
  islasCerradasTurnoIsla,
  descargarXlsxIsla,
  exportandoIsla,
  descargarGeneral,
  exportandoGeneral,
}: {
  diasAConservar: number;
  selectedDia: string | null;
  turnosListos: TurnoId[];
  exportTurno: TurnoId;
  setExportTurno: (v: TurnoId) => void;
  descargarXlsx: () => void;
  exportando: boolean;
  turnosConIsla: TurnoId[];
  exportTurnoIsla: TurnoId;
  setExportTurnoIsla: (v: TurnoId) => void;
  exportIslaId: string | null;
  setExportIslaId: (v: string | null) => void;
  islasCerradasTurnoIsla: string[];
  descargarXlsxIsla: () => void;
  exportandoIsla: boolean;
  descargarGeneral: () => void;
  exportandoGeneral: boolean;
}) {
  return (
    <div className="max-w-md animate-fade-up rounded-2xl border border-border/60 bg-card p-4 shadow-sm card-lift">
      <h3 className="mb-1 text-base font-bold">Exportar reporte</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Elige un día (lista a la izquierda, últimos {diasAConservar} días). Las
        ediciones que hagas en &quot;Reporte del día&quot; se reflejan
        automáticamente la próxima vez que exportes.
      </p>
      {/* Aviso importante: descargar y guardar en la PC */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
        <Download className="mt-0.5 h-4 w-4 shrink-0 animate-bounce" />
        <span>
          <b>No olvides guardar los reportes en tu PC.</b> Los datos se conservan
          solo los últimos {diasAConservar} días; después se borran
          automáticamente. Descarga el Excel y guárdalo en una carpeta segura.
        </span>
      </div>
      {!selectedDia ? (
        <p className="text-xs text-muted-foreground">
          Selecciona un día en la barra lateral.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="text-xs">
            Día: <b>{selectedDia}</b>
          </div>

          {/* Por turno (3 islas) */}
          <div className="space-y-2 border-t pt-3">
            <h4 className="text-xs font-bold text-muted-foreground">
              POR TURNO (3 ISLAS)
            </h4>
            {turnosListos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aún no hay ningún turno completo (las 3 islas de un turno deben
                haber finalizado) para exportar.
              </p>
            ) : (
              <>
                <Select
                  value={exportTurno}
                  onValueChange={(v) => setExportTurno((v as TurnoId) ?? turnosListos[0])}
                >
                  <SelectTrigger className="h-9 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TURNOS.filter((t) => turnosListos.includes(t.id)).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  className="w-full"
                  onClick={descargarXlsx}
                  disabled={exportando || !turnosListos.includes(exportTurno)}
                >
                  <Download className="mr-1 h-4 w-4" />
                  {exportando ? "Generando…" : "Descargar Excel del turno (.xlsx)"}
                </Button>
              </>
            )}
          </div>

          {/* Por turno e isla individual */}
          <div className="space-y-2 border-t pt-3">
            <h4 className="text-xs font-bold text-muted-foreground">
              POR ISLA INDIVIDUAL
            </h4>
            {turnosConIsla.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aún ninguna isla finalizó un turno este día.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={exportTurnoIsla}
                    onValueChange={(v) =>
                      setExportTurnoIsla((v as TurnoId) ?? turnosConIsla[0])
                    }
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TURNOS.filter((t) => turnosConIsla.includes(t.id)).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={exportIslaId ?? ""}
                    onValueChange={(v) => setExportIslaId(v)}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue placeholder="Isla" />
                    </SelectTrigger>
                    <SelectContent>
                      {ISLAS.filter((i) => islasCerradasTurnoIsla.includes(i.id)).map(
                        (i) => (
                          <SelectItem key={i.id} value={i.id}>
                            {i.nombre}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={descargarXlsxIsla}
                  disabled={exportandoIsla || !exportIslaId}
                >
                  <Download className="mr-1 h-4 w-4" />
                  {exportandoIsla ? "Generando…" : "Descargar Excel de la isla (.xlsx)"}
                </Button>
              </>
            )}
          </div>

          <div className="border-t pt-3">
            <p className="mb-2 text-xs text-muted-foreground">
              Reporte general del día completo (plantilla &quot;madre&quot;):
              ventas, clientes, vales, descuentos y formas de pago de todos los
              turnos.
            </p>
            <Button
              variant="secondary"
              className="w-full"
              onClick={descargarGeneral}
              disabled={exportandoGeneral}
            >
              <Download className="mr-1 h-4 w-4" />
              {exportandoGeneral ? "Generando…" : "Descargar reporte general (.xlsx)"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
