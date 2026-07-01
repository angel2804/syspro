"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { Input } from "@/components/ui/input";
import { normalizarCliente } from "@/lib/clientes";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  // Se dispara con Enter cuando NO hay una sugerencia resaltada (p. ej. para
  // "Agregar" el registro desde el formulario). Si hay resaltada, Enter la elige.
  onEnter?: () => void;
  placeholder?: string;
  className?: string;
  // máximo de sugerencias visibles a la vez (el resto se ve con scroll)
  max?: number;
}

// Resalta en negrita la parte del nombre que coincide con lo tecleado.
function Resaltado({ texto, query }: { texto: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{texto}</>;
  const idx = normalizarCliente(texto).indexOf(normalizarCliente(q));
  if (idx < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, idx)}
      <span className="font-semibold text-foreground">
        {texto.slice(idx, idx + q.length)}
      </span>
      {texto.slice(idx + q.length)}
    </>
  );
}

export function AutocompleteInput({
  value,
  onChange,
  suggestions,
  onEnter,
  placeholder,
  className,
  max = 8,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activo, setActivo] = useState(-1); // índice resaltado (-1 = ninguno)
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Coincidencias: por subcadena, insensible a mayúsculas/acentos. Con campo
  // vacío se muestran todas (primeras `max`); el matemático prioriza las que
  // EMPIEZAN con lo tecleado y luego las que solo lo contienen.
  const matches = useMemo(() => {
    const q = normalizarCliente(value);
    if (!q) return suggestions;
    const empieza: string[] = [];
    const contiene: string[] = [];
    for (const s of suggestions) {
      const n = normalizarCliente(s);
      if (n.startsWith(q)) empieza.push(s);
      else if (n.includes(q)) contiene.push(s);
    }
    return [...empieza, ...contiene];
  }, [value, suggestions]);

  // Oculta solo la coincidencia exacta única (ya está escrito, nada que sugerir)
  const visibles = useMemo(() => {
    if (matches.length === 1 && normalizarCliente(matches[0]) === normalizarCliente(value))
      return [];
    return matches.slice(0, max);
  }, [matches, value, max]);

  const mostrar = open && visibles.length > 0;

  // Cerrar al hacer clic fuera
  useEffect(() => {
    if (!mostrar) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [mostrar]);

  function elegir(nombre: string) {
    onChange(nombre);
    setOpen(false);
    setActivo(-1);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (mostrar && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActivo((a) => {
        const n = visibles.length;
        if (e.key === "ArrowDown") return a + 1 >= n ? 0 : a + 1;
        return a - 1 < 0 ? n - 1 : a - 1;
      });
      return;
    }
    if (e.key === "Enter") {
      if (mostrar && activo >= 0 && activo < visibles.length) {
        e.preventDefault();
        elegir(visibles[activo]);
        return;
      }
      onEnter?.();
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setActivo(-1);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        className={className}
        type="text"
        role="combobox"
        aria-expanded={mostrar}
        aria-controls={listId}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          // Los nombres de cliente siempre se guardan/muestran en MAYÚSCULAS,
          // sin importar cómo esté el teclado.
          onChange(e.target.value.toUpperCase());
          setOpen(true);
          setActivo(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {mostrar && (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            "absolute left-0 top-full z-50 mt-1 max-h-56 w-max min-w-full max-w-[22rem] overflow-auto",
            "rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-black/5",
            "animate-in fade-in-0 zoom-in-95 slide-in-from-top-1 duration-150"
          )}
        >
          {visibles.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === activo}
              // onMouseDown (no onClick) para que se dispare antes del blur del input
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(s);
              }}
              onMouseEnter={() => setActivo(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors",
                i === activo ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"
              )}
            >
              <span className="text-muted-foreground">👤</span>
              <span className="truncate">
                <Resaltado texto={s} query={value} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
