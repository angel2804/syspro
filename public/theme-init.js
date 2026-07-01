// Aplica el tema guardado ANTES del primer pintado para evitar el "flash"
// de modo claro. Default: oscuro (look producción). Se carga con
// strategy="beforeInteractive" desde app/layout.tsx.
(function () {
  try {
    var t = localStorage.getItem("gs-theme");
    if (t === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  } catch {
    document.documentElement.classList.add("dark");
  }
})();
