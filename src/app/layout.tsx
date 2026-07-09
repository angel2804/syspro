import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { SupabaseSync } from "@/components/supabase-sync";
import { AuthProvider } from "@/components/auth-provider";
import { PWA } from "@/components/pwa";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tanko",
  description: "Sistema de gestión para estación de servicios",
  applicationName: "Tanko",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tanko",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#006B3D",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Aplica el tema guardado ANTES del primer pintado para evitar el
            "flash" de modo claro (script externo en /public para no renderizar
            un <script> inline dentro del árbol de React). */}
        <Script src="/theme-init.js" strategy="beforeInteractive" />
        {children}
        <AuthProvider />
        <SupabaseSync />
        <PWA />
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
