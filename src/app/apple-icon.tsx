import { ImageResponse } from "next/og";

// Icono para "Agregar a inicio" en iPhone/iPad (apple-touch-icon). PNG sólido
// (iOS no respeta transparencia) generado por código.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
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
          fontSize: 116,
          fontWeight: 800,
        }}
      >
        G
      </div>
    ),
    size
  );
}
