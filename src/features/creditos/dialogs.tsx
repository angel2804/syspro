"use client";

// Diálogos de la sección de créditos (cuenta corriente): alta de cliente con
// anti-duplicados, registro de pago, registro de crédito (vale) y fusión de
// clientes. Extraídos de admin/creditos/page.tsx sin cambios de comportamiento.
import { useState } from "react";
import { toast } from "sonner";
import { GitMerge, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { PRODUCTOS } from "@/lib/config";
import type { ProductoId } from "@/lib/types";
import { resolverCliente, type AliasRef, type ClienteRef } from "@/lib/domain/clientes";
import {
  crearCliente,
  fusionarClientes,
  type Cliente,
} from "@/lib/data/clientes";
import { crearCredito, registrarPago } from "@/lib/data/creditos";
import { soles } from "./format";

export function NuevoClienteDialog({
  refs,
  alias,
  onCreado,
}: {
  refs: ClienteRef[];
  alias: AliasRef[];
  onCreado: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  const resolucion = nombre.trim() ? resolverCliente(nombre, refs, alias) : null;
  const bloqueado = resolucion?.tipo === "confirmar";

  async function crear(forzar = false) {
    if (!nombre.trim()) return;
    if (resolucion?.tipo === "exacto") {
      toast.info("Ese cliente ya existe: " + resolucion.cliente.nombre);
      return;
    }
    if (bloqueado && !forzar) return;
    setGuardando(true);
    try {
      await crearCliente({ nombre, creadoPorNombre: "Admin" });
      toast.success("Cliente creado");
      setNombre("");
      setOpen(false);
      await onCreado();
    } catch (e) {
      toast.error("No se pudo crear: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Nuevo cliente
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>
            Se detectan nombres parecidos para evitar duplicados.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label htmlFor="nc-nombre">Nombre</Label>
            <Input
              id="nc-nombre"
              value={nombre}
              autoFocus
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Belquer"
            />
          </div>
          {resolucion && resolucion.tipo !== "nuevo" && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
              {resolucion.tipo === "exacto" ? (
                <p>Ya existe: <b>{resolucion.cliente.nombre}</b>.</p>
              ) : (
                <>
                  <p className="mb-1 font-medium">¿Quisiste decir…?</p>
                  <ul className="list-disc pl-5">
                    {resolucion.sugerencias.slice(0, 3).map((s) => (
                      <li key={s.cliente.id}>
                        {s.cliente.nombre}{" "}
                        <span className="text-muted-foreground">
                          ({Math.round(s.similitud * 100)}%{s.viaAlias ? `, alias ${s.viaAlias}` : ""})
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          {bloqueado ? (
            <Button variant="destructive" disabled={guardando} onClick={() => crear(true)}>
              Crear de todos modos
            </Button>
          ) : (
            <Button disabled={guardando || !nombre.trim() || resolucion?.tipo === "exacto"} onClick={() => crear()}>
              Crear cliente
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RegistrarPagoDialog({
  clienteId,
  deuda,
  onListo,
}: {
  clienteId: string;
  deuda: number;
  onListo: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [monto, setMonto] = useState("");
  const [metodo, setMetodo] = useState("efectivo");
  const [referencia, setReferencia] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const m = parseFloat(monto);
    if (!(m > 0)) return toast.error("Monto inválido");
    setGuardando(true);
    try {
      await registrarPago({
        clienteId,
        monto: m,
        metodoPago: metodo,
        referencia: referencia || undefined,
        observacion: obs || undefined,
        registradoPorNombre: "Admin",
      });
      toast.success("Pago registrado");
      setMonto("");
      setReferencia("");
      setObs("");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error("No se pudo registrar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}>
        Registrar pago
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
          <DialogDescription>
            Se aplica contra la deuda total del cliente (deuda actual: {soles(deuda)}).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label htmlFor="pago-monto">Monto</Label>
            <Input
              id="pago-monto"
              type="number"
              inputMode="decimal"
              value={monto}
              autoFocus
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>
          <div>
            <Label>Método</Label>
            <Select value={metodo} onValueChange={(v) => setMetodo(v ?? "efectivo")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["efectivo", "yape", "transferencia", "visa", "culqui"].map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="pago-ref">Referencia (opcional)</Label>
            <Input id="pago-ref" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pago-obs">Observación (opcional)</Label>
            <Input id="pago-obs" value={obs} onChange={(e) => setObs(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={guardando} onClick={guardar}>
            Guardar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RegistrarCreditoDialog({
  clienteId,
  onListo,
}: {
  clienteId: string;
  onListo: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [producto, setProducto] = useState<ProductoId>("bio");
  const [galones, setGalones] = useState("");
  const [vale, setVale] = useState("");
  const [precio, setPrecio] = useState("");
  const [guardando, setGuardando] = useState(false);

  const total = (parseFloat(galones) || 0) * (parseFloat(precio) || 0);

  async function guardar() {
    if (!vale.trim()) return toast.error("El vale es obligatorio");
    const g = parseFloat(galones);
    const p = parseFloat(precio);
    if (!(g > 0)) return toast.error("Galones inválidos");
    if (!(p >= 0)) return toast.error("Precio inválido");
    setGuardando(true);
    try {
      await crearCredito({
        clienteId,
        producto,
        galones: g,
        vale: vale.trim(),
        precioUnitario: p,
        trabajadorNombre: "Admin",
      });
      toast.success("Crédito registrado");
      setGalones("");
      setVale("");
      setPrecio("");
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error("No se pudo registrar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" /> Crédito
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar crédito (vale)</DialogTitle>
          <DialogDescription>El precio queda congelado en este crédito.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Producto</Label>
            <Select value={producto} onValueChange={(v) => v && setProducto(v as ProductoId)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(PRODUCTOS) as ProductoId[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRODUCTOS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cr-gal">Galones</Label>
              <Input id="cr-gal" type="number" inputMode="decimal" value={galones} onChange={(e) => setGalones(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="cr-precio">Precio</Label>
              <Input id="cr-precio" type="number" inputMode="decimal" value={precio} onChange={(e) => setPrecio(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="cr-vale">Vale (obligatorio)</Label>
            <Input id="cr-vale" value={vale} onChange={(e) => setVale(e.target.value)} placeholder="Ej. 0001" />
          </div>
          <p className="text-sm text-muted-foreground">Total: {soles(total)}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button disabled={guardando} onClick={guardar}>
            Guardar crédito
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FusionarDialog({
  cliente,
  clientes,
  onListo,
}: {
  cliente: Cliente;
  clientes: Cliente[];
  onListo: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [destinoId, setDestinoId] = useState("");
  const [guardando, setGuardando] = useState(false);

  const candidatos = clientes.filter((c) => c.id !== cliente.id && c.estado !== "fusionado");

  async function fusionar() {
    const destino = clientes.find((c) => c.id === destinoId);
    if (!destino) return toast.error("Elige el cliente destino");
    setGuardando(true);
    try {
      await fusionarClientes(cliente, destino, "Admin");
      toast.success(`"${cliente.nombre}" fusionado en "${destino.nombre}"`);
      setOpen(false);
      await onListo();
    } catch (e) {
      toast.error("No se pudo fusionar: " + (e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <GitMerge className="size-4" /> Fusionar
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Fusionar cliente</DialogTitle>
          <DialogDescription>
            Mueve los créditos, pagos y alias de <b>{cliente.nombre}</b> a otro cliente
            oficial. {cliente.nombre} quedará como alias del destino (no se borra).
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label>Cliente destino (se conserva)</Label>
          <Select value={destinoId} onValueChange={(v) => setDestinoId(v ?? "")}>
            <SelectTrigger>
              <SelectValue placeholder="Elegir…" />
            </SelectTrigger>
            <SelectContent>
              {candidatos.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={guardando || !destinoId} onClick={fusionar}>
            Fusionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
