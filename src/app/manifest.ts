import type { MetadataRoute } from "next";

// Manifest de la PWA (Next.js App Router lo sirve en /manifest.webmanifest y
// agrega el <link rel="manifest"> automáticamente). Modo standalone para que
// se instale como app en Windows, Android e iPhone desde el navegador.
//
// El icono es el logo de Tanko en PNG (public/icons/tanko-*.png). La pestaña y
// el apple-touch-icon salen de app/icon.png y app/apple-icon.png (archivos
// estáticos que Next enlaza automáticamente).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tanko — Gestión de estación",
    short_name: "Tanko",
    description:
      "Sistema operativo para estación de servicios: turnos, cuadre, créditos por cliente y reportes.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0a1a10",
    theme_color: "#006B3D",
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icons/tanko-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/tanko-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/tanko-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
