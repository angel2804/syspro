"use client";

// Vista "Configuraciones" del panel admin: copias de seguridad, logo, nombre del
// grifo, liberar turnos abiertos y reset de la base de datos (zona de pruebas).
// Extraída de admin/page.tsx sin cambios de comportamiento; page.tsx mantiene el
// estado y pasa los handlers.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CalendarDays,
  DatabaseBackup,
  Download,
  Fuel,
  RotateCcw,
  Save,
  Settings,
  Tag,
  Trash2,
} from "lucide-react";
import { getIsla, turnoLabel } from "@/lib/config";
import type { Permiso, Sesion } from "@/lib/types";
import type { Backup } from "@/lib/db";

export function VistaConfig({
  can,
  diasBackup,
  backups,
  backupManual,
  creandoBackup,
  descargarBackup,
  setBackupARestaurar,
  restaurandoId,
  eliminarBackup,
  logo,
  onSubirLogo,
  quitarLogo,
  nombreGrifoLocal,
  setNombreGrifoLocal,
  guardarNombreGrifo,
  activos,
  setTurnoALiberar,
  setConfirmandoReset,
}: {
  can: (p: Permiso) => boolean;
  diasBackup: number;
  backups: Backup[];
  backupManual: () => void;
  creandoBackup: boolean;
  descargarBackup: (b: Backup) => void;
  setBackupARestaurar: (b: Backup) => void;
  restaurandoId: string | null;
  eliminarBackup: (id: string) => void;
  logo: string | null;
  onSubirLogo: (file: File | undefined) => void;
  quitarLogo: () => void;
  nombreGrifoLocal: string;
  setNombreGrifoLocal: (v: string) => void;
  guardarNombreGrifo: () => void;
  activos: Sesion[];
  setTurnoALiberar: (s: Sesion) => void;
  setConfirmandoReset: (v: boolean) => void;
}) {
  return (
    <div className="max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <h3 className="mb-1 flex items-center gap-2 text-base font-bold">
        <Settings className="h-4 w-4" /> Configuraciones
      </h3>
      {!can("reset") && !can("backups-ver") && !can("backups-generar") ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            No tienes permiso para ver esta sección. Pídele al dueño el permiso
            de backups o de reseteo del sistema.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Copias de seguridad */}
          <div className="rounded-lg border border-sky-300/60 bg-sky-50 p-3 dark:border-sky-500/30 dark:bg-sky-950/20">
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-sky-700 dark:text-sky-300">
              <DatabaseBackup className="h-4 w-4" /> Copias de seguridad
            </h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Instantáneas de todas las sesiones (incluidos los odómetros) y la
              configuración. Se crea una automáticamente al completarse cada
              turno (3 islas) y puedes crear una manual. Se conservan los últimos{" "}
              {diasBackup} días.
              <br />
              <span className="text-[11px]">
                Para recuperar: usa &quot;Resetear base de datos&quot; (no borra
                las copias) y luego restaura un punto seguro.
              </span>
            </p>
            <Button
              size="sm"
              className="mb-3 w-full"
              onClick={backupManual}
              disabled={creandoBackup}
            >
              <Save className="mr-1 h-4 w-4" />
              {creandoBackup ? "Creando…" : "Crear copia ahora"}
            </Button>
            {backups.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Aún no hay copias de seguridad.
              </p>
            ) : (
              <div className="space-y-2">
                {backups.map((b) => (
                  <div
                    key={b.id}
                    className="animate-fade-up rounded-lg border bg-card p-2 text-xs card-lift"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5 font-semibold">
                          <CalendarDays className="h-3.5 w-3.5 shrink-0" /> {b.dia}
                          {b.nota && (
                            <span className="ml-1.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:text-sky-300">
                              {b.nota}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {new Date(b.createdAt).toLocaleString("es-PE")} ·{" "}
                          {b.sesiones.length} sesiones
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2"
                          onClick={() => descargarBackup(b)}
                          title="Descargar copia (.json)"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 px-2"
                          onClick={() => setBackupARestaurar(b)}
                          disabled={restaurandoId === b.id}
                          title="Restaurar esta copia"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-red-500 hover:text-red-600"
                          onClick={() => eliminarBackup(b.id)}
                          title="Eliminar copia"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Logo de la empresa */}
          <div className="rounded-lg border border-violet-300/60 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-950/20">
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-violet-700 dark:text-violet-300">
              <Tag className="h-4 w-4" /> Logo de la empresa
            </h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Reemplaza el ícono del login y del panel por el logo de la empresa.
              Imagen PNG/JPG de máx. 500 KB.
            </p>
            <div className="flex items-center gap-3">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-card">
                {logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logo}
                    alt="Logo actual"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <Fuel className="h-7 w-7 text-amber-500" />
                )}
              </span>
              <div className="flex flex-col gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                  {logo ? "Cambiar logo" : "Subir logo"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      onSubirLogo(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                {logo && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9"
                    onClick={quitarLogo}
                  >
                    Quitar logo
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Nombre del grifo (aparece en los reportes/PDFs del cliente) */}
          <div className="rounded-lg border border-violet-300/60 bg-violet-50 p-3 dark:border-violet-500/30 dark:bg-violet-950/20">
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-violet-700 dark:text-violet-300">
              <Tag className="h-4 w-4" /> Nombre del grifo
            </h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Nombre del negocio que aparece en los reportes y PDFs generados
              para el cliente (distinto del nombre del sistema).
            </p>
            <Input
              className="h-9 max-w-xs"
              value={nombreGrifoLocal}
              onChange={(e) => setNombreGrifoLocal(e.target.value)}
              onBlur={guardarNombreGrifo}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </div>

          {/* Liberar turnos abiertos (destrabar turnos de prueba) */}
          <div className="rounded-lg border border-orange-300/60 bg-orange-50 p-3 dark:border-orange-500/30 dark:bg-orange-950/20">
            <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-orange-700 dark:text-orange-300">
              <RotateCcw className="h-4 w-4" /> Liberar turnos abiertos
            </h4>
            <p className="mb-3 text-xs text-muted-foreground">
              Fuerza la liberación de un turno en curso: se borra por completo y
              el slot queda <b>libre</b>, como si no se hubiera empezado, para que
              otro trabajador pueda tomarlo. Útil para destrabar turnos de prueba
              con trabajadores que ya no existen.
            </p>
            {activos.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No hay turnos abiertos.
              </p>
            ) : (
              <div className="space-y-2">
                {activos.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-xs"
                  >
                    <div>
                      <div className="font-semibold">
                        {getIsla(s.islaId)?.nombre ?? s.islaId} ·{" "}
                        {turnoLabel(s.turno)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {s.trabajador || "(sin trabajador)"} · {s.diaOperativo}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 border-orange-400 px-2 text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-900/30"
                      onClick={() => setTurnoALiberar(s)}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Liberar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {can("reset") && (
            <div className="rounded-lg border border-red-300 bg-red-50 p-3 dark:bg-red-950/30">
              <h4 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-red-600">
                <AlertTriangle className="h-4 w-4" /> Zona de pruebas
              </h4>
              <p className="mb-3 text-xs text-muted-foreground">
                Borra TODO para probar el sistema de cero: turnos, créditos,
                pagos, clientes, inventario de tanques, historial de precios y
                auditoría. NO se borran las copias de seguridad, las cuentas de usuario
                (dueño/admin/trabajador) ni la configuración (precios y lista de
                trabajadores).
              </p>
              <Button
                variant="destructive"
                className="w-full"
                onClick={() => setConfirmandoReset(true)}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                Resetear base de datos
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
