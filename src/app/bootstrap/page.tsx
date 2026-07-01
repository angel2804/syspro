"use client";

// ============================================================================
// Bootstrap del PRIMER dueño (arranque de la Fase 4). Público, pero la Server
// Action solo lo permite si aún NO existe ningún dueño activo. Una vez creado,
// queda bloqueado. Anti-lockout: garantiza que siempre puedas crear tu acceso
// dueño la primera vez sin depender del Dashboard de Supabase.
// ============================================================================
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Fuel, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { crearDuenoInicial } from "@/lib/server/usuarios-actions";

export default function BootstrapPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [listo, setListo] = useState(false);

  async function crear() {
    setGuardando(true);
    try {
      await crearDuenoInicial({ email, password, nombre });
      setListo(true);
      toast.success("Dueño creado. Ya puedes iniciar sesión.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
          <Fuel className="size-6" />
        </span>
        <div>
          <h1 className="text-lg font-semibold">Crear usuario dueño</h1>
          <p className="text-sm text-muted-foreground">Primer arranque del sistema</p>
        </div>
      </div>

      {listo ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-sm dark:bg-emerald-950/30">
          <p className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <ShieldCheck className="size-4" /> Dueño creado correctamente.
          </p>
          <p className="mt-1 text-emerald-700/80 dark:text-emerald-300/80">
            Inicia sesión con tu correo y contraseña.
          </p>
          <Button className="mt-3" onClick={() => router.push("/")}>Ir al login</Button>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border p-4">
          <div>
            <Label htmlFor="bs-nombre">Nombre</Label>
            <Input id="bs-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre" />
          </div>
          <div>
            <Label htmlFor="bs-email">Correo</Label>
            <Input id="bs-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="dueno@grifo.com" />
          </div>
          <div>
            <Label htmlFor="bs-pass">Contraseña</Label>
            <Input id="bs-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6 caracteres" />
          </div>
          <Button disabled={guardando} onClick={crear}>
            {guardando ? "Creando…" : "Crear dueño"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Solo funciona una vez. Si ya existe un dueño, usa el{" "}
            <Link href="/" className="text-sky-600 hover:underline">login</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
