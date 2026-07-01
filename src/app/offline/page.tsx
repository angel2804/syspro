// Página mostrada por el Service Worker cuando se abre la app sin conexión.
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="text-5xl">📡</div>
      <h1 className="text-xl font-semibold">Sin conexión</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        No hay internet en este momento. Tus datos están guardados en el
        dispositivo y se sincronizarán automáticamente cuando vuelva la
        conexión.
      </p>
    </main>
  );
}
