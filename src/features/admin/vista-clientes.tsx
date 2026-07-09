"use client";

// Vista "Clientes" del panel admin: gestión de la lista de autocompletado de
// clientes de crédito y de descuento (listas separadas), con paginación.
// Extraída de admin/page.tsx sin cambios de comportamiento.
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { clientesOrdenados } from "@/lib/clientes-autocompletado";

export function VistaClientes({
  tipoClientes,
  setTipoClientes,
  clientes,
  clientesDescuento,
  paginaCliente,
  setPaginaCliente,
  nuevoCliente,
  setNuevoCliente,
  agregarCliente,
  quitarCliente,
}: {
  tipoClientes: "credito" | "descuento";
  setTipoClientes: (v: "credito" | "descuento") => void;
  clientes: string[];
  clientesDescuento: string[];
  paginaCliente: number;
  setPaginaCliente: (v: number) => void;
  nuevoCliente: string;
  setNuevoCliente: (v: string) => void;
  agregarCliente: () => void;
  quitarCliente: (nombre: string) => void;
}) {
  const POR_PAGINA = 30;
  const esDescuento = tipoClientes === "descuento";
  const listaClientes = esDescuento ? clientesDescuento : clientes;
  const ordenados = clientesOrdenados(listaClientes);
  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / POR_PAGINA));
  const pagina = Math.min(paginaCliente, totalPaginas - 1);
  const visibles = ordenados.slice(
    pagina * POR_PAGINA,
    pagina * POR_PAGINA + POR_PAGINA
  );
  return (
    <div className="max-w-3xl rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
      <h3 className="mb-1 text-base font-bold">Gestión de clientes</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Clientes de crédito y clientes de descuento se manejan por separado. El
        mismo nombre puede existir en ambas listas sin mezclarse.
      </p>
      <div className="mb-3 inline-flex rounded-lg border bg-muted/40 p-1">
        <Button
          size="sm"
          variant={!esDescuento ? "default" : "ghost"}
          className="h-8"
          onClick={() => {
            setTipoClientes("credito");
            setPaginaCliente(0);
          }}
        >
          Clientes crédito
        </Button>
        <Button
          size="sm"
          variant={esDescuento ? "default" : "ghost"}
          className="h-8"
          onClick={() => {
            setTipoClientes("descuento");
            setPaginaCliente(0);
          }}
        >
          Clientes descuento
        </Button>
      </div>
      <div className="mb-3 flex max-w-md gap-2">
        <Input
          placeholder={esDescuento ? "Cliente para descuento" : "Cliente de crédito"}
          value={nuevoCliente}
          onChange={(e) => setNuevoCliente(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && agregarCliente()}
          className="h-9"
        />
        <Button size="sm" className="h-9" onClick={agregarCliente}>
          + Agregar
        </Button>
      </div>
      {listaClientes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No hay clientes registrados.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {visibles.map((nombre) => (
              <div
                key={nombre}
                className="flex items-center justify-between gap-1 rounded-md border px-2 py-1 text-xs"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-[10px] font-bold text-white">
                    {nombre[0]}
                  </span>
                  <span className="truncate">{nombre}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 shrink-0 px-0 text-red-500 hover:text-red-600"
                  onClick={() => quitarCliente(nombre)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
          {totalPaginas > 1 && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {Array.from({ length: totalPaginas }, (_, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant={i === pagina ? "default" : "outline"}
                  className="h-7 w-7 px-0 text-xs"
                  onClick={() => setPaginaCliente(i)}
                >
                  {i + 1}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
