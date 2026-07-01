/* GrifoSys — Service Worker (PWA, soporte offline básico).
 *
 * Estrategia:
 *  - Navegaciones (HTML): network-first; si no hay red, cae a la página /offline
 *    cacheada. Así la app abre instalada aunque no haya internet.
 *  - Estáticos del mismo origen (íconos, css, js, fuentes): stale-while-revalidate.
 *  - Supabase / APIs externas: NUNCA se cachean (siempre red). Los datos viven
 *    en Supabase + el caché de la app (Zustand/localStorage), no en el SW.
 */
const VERSION = "grifosys-v1";
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll([OFFLINE_URL, "/icons/icon.svg"]))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

function esMismoOrigen(url) {
  return new URL(url, self.location.origin).origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // No interceptar Supabase ni nada de otro origen (auth/realtime/datos).
  if (!esMismoOrigen(url) || url.pathname.startsWith("/api/")) return;

  // Navegaciones → network-first con fallback a /offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((r) => r || Response.error())
      )
    );
    return;
  }

  // Estáticos → stale-while-revalidate.
  event.respondWith(
    caches.open(STATIC).then(async (cache) => {
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200) cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
