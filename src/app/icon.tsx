import { ImageResponse } from "next/og";

// Icono PNG de pestaña/buscador, generado por código (sin binarios). Next
// agrega el <link rel="icon"> automáticamente.
export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0f19",
          color: "#38bdf8",
          fontSize: 120,
          fontWeight: 800,
          borderRadius: 36,
        }}
      >
        G
      </div>
    ),
    size
  );
}
