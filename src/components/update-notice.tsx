"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

const STORAGE_KEY = "grifosys-version-visto";
const AUTO_RELOAD_SECONDS = 20;

type VersionResponse = { version?: string };

async function fetchVersion(): Promise<string | null> {
  const res = await fetch(`/api/version?t=${Date.now()}`, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as VersionResponse;
  return data.version ?? null;
}

function hardReload() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.update().catch(() => undefined))))
      .finally(() => window.location.reload());
    return;
  }
  window.location.reload();
}

export function UpdateNotice() {
  const [version, setVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [segundos, setSegundos] = useState(AUTO_RELOAD_SECONDS);

  useEffect(() => {
    let vivo = true;

    async function revisar() {
      const actual = await fetchVersion().catch(() => null);
      if (!vivo || !actual || actual === "local") return;

      const visto = localStorage.getItem(STORAGE_KEY);
      if (!visto) {
        localStorage.setItem(STORAGE_KEY, actual);
        return;
      }

      if (visto !== actual) {
        setVersion(actual);
        setSegundos(AUTO_RELOAD_SECONDS);
        setOpen(true);
      }
    }

    revisar();
    const timer = window.setInterval(revisar, 30_000);
    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!open || !version) return;
    if (segundos <= 0) {
      localStorage.setItem(STORAGE_KEY, version);
      hardReload();
      return;
    }

    const timer = window.setTimeout(() => setSegundos((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [open, version, segundos]);

  if (!open || !version) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-emerald-500/30 bg-background p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600">
            <RefreshCw className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">Actualizacion disponible</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Se desplego una nueva version del sistema. Esta pantalla se actualizara sola
              para evitar que una computadora siga usando codigo antiguo.
            </p>
            <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Actualizacion automatica</p>
              <p className="mt-2 text-muted-foreground">
                La recarga iniciara en <b>{segundos}</b> segundos.
              </p>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Version: {version.slice(0, 12)}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            onClick={() => {
              localStorage.setItem(STORAGE_KEY, version);
              hardReload();
            }}
          >
            <RefreshCw className="mr-2 size-4" />
            Actualizar ahora
          </Button>
        </div>
      </div>
    </div>
  );
}
