"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// Evento beforeinstallprompt (no tipado en lib.dom estándar).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Estado de conexión vía useSyncExternalStore (patrón idiomático para
// suscribirse a un sistema externo sin setState dentro del cuerpo del efecto).
function suscribirOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
function useOnline() {
  return useSyncExternalStore(
    suscribirOnline,
    () => navigator.onLine, // cliente
    () => true // servidor: asumir conectado para evitar parpadeo en SSR
  );
}

// Registra el Service Worker y expone un botón "Instalar app" cuando el
// navegador lo permite (Chrome/Edge/Android). En iPhone la instalación es
// manual (Compartir → Agregar a inicio); ahí no aparece el evento.
export function PWA() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const online = useOnline();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent); // setState dentro de callback: permitido
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function instalar() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  return (
    <>
      {!online && (
        <div className="fixed inset-x-0 top-0 z-50 bg-amber-500 px-3 py-1 text-center text-xs font-medium text-amber-950">
          Sin conexión — los cambios se sincronizarán al reconectar
        </div>
      )}
      {deferred && (
        <button
          onClick={instalar}
          className="fixed bottom-4 right-4 z-50 rounded-full bg-sky-600 px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-sky-500"
        >
          Instalar app
        </button>
      )}
    </>
  );
}
