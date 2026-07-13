"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";

const STORAGE_KEY = "grifosys-version-visto";
const DISMISSED_KEY = "grifosys-version-omitido";

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
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.update().catch(() => undefined))))
      .finally(() => window.location.reload());
    return;
  }
  window.location.reload();
}

export function UpdateNotice() {
  const auth = useStore((s) => s.auth);
  const [version, setVersion] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const esAdmin = auth?.rol === "dueno" || auth?.rol === "admin" || auth?.rol === "encargado";

  useEffect(() => {
    if (!esAdmin) return;
    let vivo = true;

    async function revisar() {
      const actual = await fetchVersion().catch(() => null);
      if (!vivo || !actual || actual === "local") return;

      const visto = localStorage.getItem(STORAGE_KEY);
      const omitido = localStorage.getItem(DISMISSED_KEY);
      if (!visto) {
        localStorage.setItem(STORAGE_KEY, actual);
        setVersion(actual);
        setOpen(true);
        return;
      }
      if (visto !== actual && omitido !== actual) {
        setVersion(actual);
        setOpen(true);
      }
    }

    revisar();
    const timer = window.setInterval(revisar, 60000);
    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [esAdmin]);

  if (!open || !version) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-emerald-500/30 bg-background p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-emerald-500/10 p-3 text-emerald-600">
            <RefreshCw className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold">Actualización disponible</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Se desplegó una nueva versión del sistema. Para evitar pantallas viejas por caché,
              actualiza el navegador antes de seguir trabajando en el panel administrativo.
            </p>
            <div className="mt-4 rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Pasos recomendados</p>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>Presiona <b>Actualizar ahora</b>.</li>
                <li>Si algo se queda pegado, usa <b>Ctrl + Shift + R</b>.</li>
                <li>En celular, cierra la pestaña y vuelve a abrir la app si no cambia.</li>
              </ol>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Versión: {version.slice(0, 12)}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              localStorage.setItem(DISMISSED_KEY, version);
              setOpen(false);
            }}
          >
            Luego
          </Button>
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
