import type { MetadataRoute } from "next";

// Manifest de la PWA (Next.js App Router lo sirve en /manifest.webmanifest y
// agrega el <link rel="manifest"> automáticamente). Modo standalone para que
// se instale como app en Windows, Android e iPhone desde el navegador.
//
// El icono es un SVG vectorial (escala a cualquier tamaño y sirve como
// maskable). Los iconos de pestaña/pantalla de inicio en PNG los generan las
// rutas app/icon.tsx y app/apple-icon.tsx (ImageResponse), sin binarios.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GrifoSys — Gestión de estación",
    short_name: "GrifoSys",
    description:
      "Sistema operativo para estación de servicios: turnos, cuadre, créditos por cliente y reportes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0b0f19",
    theme_color: "#0b0f19",
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
