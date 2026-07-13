"use client";

// ============================================================================
// Gestión de usuarios administrativos (Fase 4) — solo DUEÑO.
// Crear/editar admin y encargado, asignar contraseña, configurar permisos,
// cambiar rol y activar/desactivar. La validación real ocurre en el servidor
// (Server Actions con service_role); esta UI solo envía el access token.
// ============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, KeyRound, Plus, ShieldCheck, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PERMISOS, PERMISOS_BASE } from "@/lib/config";
import type { Permiso, Rol } from "@/lib/types";
import { useStore } from "@/lib/store";
import { getAccessToken } from "@/lib/data/auth";
import {
  actualizarUsuario,
  crearUsuario,
  listarUsuarios,
  resetearPassword,
  resetearPasswordTrabajador,
  type UsuarioAdmin,
} from "@/lib/server/usuarios-actions";

type RolStaff = "admin" | "encargado";
const ROL_LABEL: Record<Rol, string> = {
  dueno: "Dueño",
  admin: "Administrador",
  encargado: "Encargado",
  trabajador: "Trabajador",
};

// Agrupa el catálogo de permisos por `grupo` para mostrarlos en secciones.
function permisosPorGrupo() {
  const grupos = new Map<string, { id: Permiso; label: string }[]>();
  for (const p of PERMISOS) {
    const arr = grupos.get(p.grupo) ?? [];
    arr.push({ id: p.id, label: p.label });
    grupos.set(p.grupo, arr);
  }
  return [...grupos.entries()];
}

export default function UsuariosPage() {
  const auth = useStore((s) => s.auth);
  const [hydrated, setHydrated] = useState(false);
  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Inicia sesión como dueño.");
      setUsuarios(await listarUsuarios(token));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCargando(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect --
     Carga de datos remotos (Supabase) al montar: el setState ocurre tras el
     await dentro de funciones async, no de forma síncrona en el render. */
  useEffect(() => setHydrated(true), []);
  useEffect(() => {
    recargar();
  }, [recargar]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const esDueno = hydrated && auth?.rol === "dueno";

  if (hydrated && !esDueno) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center gap-3 p-6 text-center">
        <ShieldCheck className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Acceso solo para el dueño</h1>
        <p className="text-sm text-muted-foreground">
          La gestión de usuarios administrativos está reservada al dueño.
        </p>
        <Link href="/admin" className="text-sm text-sky-600 hover:underline">
          Volver al panel
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Link href="/admin" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-5" />
        </Link>
        <UserCog className="size-5 text-emerald-600" />
        <h1 className="text-lg font-semibold">Usuarios administrativos</h1>
        <div className="ml-auto">
          <NuevoUsuarioDialog onListo={recargar} />
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      ) : cargando ? (
        <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Correo</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Permisos</TableHead>
                <TableHead>Auditoría</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usuarios.map((u) => (
                <TableRow key={u.id} className={u.activo ? "" : "opacity-50"}>
                  <TableCell className="font-medium">{u.nombre}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{ROL_LABEL[u.rol]}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {u.rol === "dueno" ? "Todos" : u.permisos.length}
                  </TableCell>
                  <TableCell>
                    {u.rol === "dueno" || u.auditoriaActiva ? (
                      <span className="text-emerald-600">Activa</span>
                    ) : (
                      <span className="text-muted-foreground">Apagada</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {u.activo ? (
                      <span className="text-emerald-600">Activo</span>
                    ) : (
                      <span className="text-muted-foreground">Inactivo</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <EditarUsuarioDialog usuario={u} onListo={recargar} />
                      <ResetPasswordDialog usuario={u} onListo={recargar} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {usuarios.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Aún no hay usuarios administrativos. Crea el primero.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!error && !cargando && <CuentaTrabajadorCard />}
    </div>
  );
}

// Tarjeta para cambiar la contraseña de la CUENTA COMPARTIDA de trabajador.
function CuentaTrabajadorCard() {
  const [email, setEmail] = useState("trabajador@grifo.local");
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada.");
      await resetearPasswordTrabajador(token, email, password);
      toast.success("Contraseña de la cuenta de trabajador actualizada");
      setPassword("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <KeyRound className="size-4 text-sky-600" />
        <h2 className="text-sm font-semibold">Cuenta compartida de trabajador</h2>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Todos los trabajadores entran con esta cuenta y luego eligen su nombre.
        Cambia aquí su contraseña.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <Label htmlFor="ct-email">Correo</Label>
          <Input id="ct-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ct-pass">Nueva contraseña</Label>
          <Input id="ct-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6" />
        </div>
        <Button disabled={guardando || password.length < 6} onClick={guardar}>
          Cambiar contraseña
        </Button>
      </div>
    </div>
  );
}

// Lista de checkboxes de permisos agrupada.
function PermisosSelector({
  seleccionados,
  onToggle,
  disabled,
}: {
  seleccionados: Permiso[];
  onToggle: (p: Permiso) => void;
  disabled?: boolean;
}) {
  const grupos = useMemo(() => permisosPorGrupo(), []);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {grupos.map(([grupo, permisos]) => (
        <div key={grupo} className="rounded-md border p-2">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {grupo}
          </p>
          <div className="grid gap-1">
            {permisos.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={seleccionados.includes(p.id)}
                  onChange={() => onToggle(p.id)}
                  className="size-4 accent-emerald-600"
                />
                {p.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NuevoUsuarioDialog({ onListo }: { onListo: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [rol, setRol] = useState<RolStaff>("encargado");
  const [permisos, setPermisos] = useState<Permiso[]>(PERMISOS_BASE.encargado);
  const [auditoriaActiva, setAuditoriaActiva] = useState(true);
  const [guardando, setGuardando] = useState(false);

  function cambiarRol(r: RolStaff) {
    setRol(r);
    setPermisos(PERMISOS_BASE[r]); // sugerir base del rol
  }
  function toggle(p: Permiso) {
    setPermisos((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function guardar() {
    setGuardando(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada.");
      await crearUsuario(token, { email, password, nombre, rol, permisos, auditoriaActiva });
      toast.success("Usuario creado");
      setEmail(""); setPassword(""); setNombre("");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Nuevo usuario
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nuevo usuario administrativo</DialogTitle>
          <DialogDescription>Admin o encargado, con permisos configurables.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nu-nombre">Nombre</Label>
              <Input id="nu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div>
              <Label>Rol</Label>
              <Select value={rol} onValueChange={(v) => v && cambiarRol(v as RolStaff)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="encargado">Encargado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="nu-email">Correo</Label>
              <Input id="nu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="nu-pass">Contraseña</Label>
              <Input id="nu-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="mínimo 6" />
            </div>
          </div>
          <div>
            <Label className="mb-1 block">Permisos</Label>
            <PermisosSelector seleccionados={permisos} onToggle={toggle} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-emerald-600"
              checked={auditoriaActiva}
              onChange={(e) => setAuditoriaActiva(e.target.checked)}
            />
            Registrar sus cambios en auditoría
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={guardando} onClick={guardar}>Crear usuario</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditarUsuarioDialog({ usuario, onListo }: { usuario: UsuarioAdmin; onListo: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState(usuario.nombre);
  const [rol, setRol] = useState<Rol>(usuario.rol);
  const [permisos, setPermisos] = useState<Permiso[]>(usuario.permisos);
  const [activo, setActivo] = useState(usuario.activo);
  const [auditoriaActiva, setAuditoriaActiva] = useState(usuario.auditoriaActiva);
  const [guardando, setGuardando] = useState(false);
  const esDueno = usuario.rol === "dueno";

  function toggle(p: Permiso) {
    setPermisos((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  async function guardar() {
    setGuardando(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada.");
      await actualizarUsuario(token, usuario.id, {
        nombre,
        rol: rol === "dueno" ? undefined : (rol as RolStaff),
        permisos: rol === "dueno" ? undefined : permisos,
        activo,
        auditoriaActiva: rol === "dueno" ? undefined : auditoriaActiva,
      });
      toast.success("Usuario actualizado");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <UserCog className="size-4" /> Editar
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar {usuario.nombre}</DialogTitle>
          <DialogDescription>{usuario.email ?? ""}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="eu-nombre">Nombre</Label>
              <Input id="eu-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div>
              <Label>Rol</Label>
              <Select value={rol} onValueChange={(v) => v && setRol(v as Rol)} disabled={esDueno}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Administrador</SelectItem>
                  <SelectItem value="encargado">Encargado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-emerald-600" checked={activo} disabled={esDueno} onChange={(e) => setActivo(e.target.checked)} />
            Activo
          </label>
          {esDueno ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              El dueño tiene acceso total y no puede desactivarse ni cambiar su rol aquí.
            </p>
          ) : (
            <div>
              <Label className="mb-1 block">Permisos</Label>
              <PermisosSelector seleccionados={permisos} onToggle={toggle} />
            </div>
          )}
          {!esDueno && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-emerald-600"
                checked={auditoriaActiva}
                onChange={(e) => setAuditoriaActiva(e.target.checked)}
              />
              Registrar sus cambios en auditoría
            </label>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={guardando} onClick={guardar}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ usuario, onListo }: { usuario: UsuarioAdmin; onListo: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sesión expirada.");
      await resetearPassword(token, usuario.id, password);
      toast.success("Contraseña actualizada");
      setPassword("");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <KeyRound className="size-4" /> Clave
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Contraseña de {usuario.nombre}</DialogTitle>
          <DialogDescription>Asigna una nueva contraseña (mínimo 6 caracteres).</DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="rp-pass">Nueva contraseña</Label>
          <Input id="rp-pass" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button disabled={guardando} onClick={guardar}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
