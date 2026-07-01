"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { diaMenos, diaOperativoActual } from "@/lib/calc";
import {
  addClientesRemoto,
  fetchSesionesDesde,
  subscribeConfig,
  subscribeSesiones,
  upsertSesion,
} from "@/lib/db";
import { normalizarCliente } from "@/lib/clientes";
import { supabaseHabilitado } from "@/lib/supabase";
import type { Admin, Precios, Sesion } from "@/lib/types";

// Sincroniza el store (localStorage) con Supabase:
//  - al iniciar y en vivo: trae una VENTANA RECIENTE de sesiones (hoy y ayer)
//    vía Supabase Realtime, suficiente para autocompletar odómetros del turno
//    anterior y conocer los turnos ocupados del día.
//  - en cada cambio local: guarda (debounced) SOLO la sesión activa de este
//    dispositivo, nunca todas — así un navegador viejo no "resucita" datos
//    borrados ni reescribe sesiones de otros.
//  - escucha precios y trabajadores globales en vivo.
export function SupabaseSync() {
  const mergeRemoteSesiones = useStore((s) => s.mergeRemoteSesiones);
  const setPrecios = useStore((s) => s.setPrecios);
  const setTrabajadores = useStore((s) => s.setTrabajadores);
  const setClientes = useStore((s) => s.setClientes);
  const setAdmins = useStore((s) => s.setAdmins);
  const setLogo = useStore((s) => s.setLogo);

  // Precios globales en vivo (config/precios)
  useEffect(() => {
    if (!supabaseHabilitado) return;
    return subscribeConfig<Precios>("precios", setPrecios);
  }, [setPrecios]);

  // Lista de trabajadores en vivo (config/trabajadores)
  useEffect(() => {
    if (!supabaseHabilitado) return;
    return subscribeConfig<{ nombres: string[] }>("trabajadores", (v) => {
      if (Array.isArray(v.nombres) && v.nombres.length) setTrabajadores(v.nombres);
    });
  }, [setTrabajadores]);

  // Administradores en vivo (config/admins)
  useEffect(() => {
    if (!supabaseHabilitado) return;
    return subscribeConfig<{ admins: Admin[] }>("admins", (v) => {
      if (Array.isArray(v.admins)) setAdmins(v.admins);
    });
  }, [setAdmins]);

  // Logo de la empresa en vivo (config/logo)
  useEffect(() => {
    if (!supabaseHabilitado) return;
    return subscribeConfig<{ dataUrl: string | null }>("logo", (v) => {
      setLogo(v.dataUrl ?? null);
    });
  }, [setLogo]);

  // Lista de clientes en vivo (config/clientes). La lista remota es la
  // AUTORITATIVA: se reemplaza la local por la remota. Así las eliminaciones
  // que hace el admin se propagan a todos los dispositivos (un merge por unión
  // nunca podría quitar un cliente borrado, por eso reaparecían). Los clientes
  // recién aprendidos en este dispositivo se suben enseguida (efecto de abajo)
  // y vuelven en la siguiente actualización remota.
  useEffect(() => {
    if (!supabaseHabilitado) return;
    return subscribeConfig<{ nombres: string[] }>("clientes", (v) => {
      if (!Array.isArray(v.nombres)) return;
      setClientes(v.nombres);
    });
  }, [setClientes]);

  // Sube a Supabase SOLO los clientes nuevos que se aprenden localmente
  // (debounced y de forma ADITIVA). Antes subía la lista COMPLETA en cada
  // cambio: si este dispositivo tenía un cliente que el admin ya había
  // eliminado, lo volvía a subir y "resucitaba". Ahora solo se envían los
  // nombres que NO estaban antes; las eliminaciones las maneja el admin (su
  // escritura autoritativa) y nunca se pisan.
  useEffect(() => {
    if (!supabaseHabilitado) return;
    let prev = useStore.getState().clientes;
    let buffer: string[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useStore.subscribe(() => {
      const curr = useStore.getState().clientes;
      if (curr === prev) return;
      const vistos = new Set(prev.map(normalizarCliente));
      const nuevos = curr.filter((c) => !vistos.has(normalizarCliente(c)));
      prev = curr;
      if (nuevos.length === 0) return; // solo se quitaron clientes: no subir nada
      buffer.push(...nuevos);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const aSubir = buffer;
        buffer = [];
        addClientesRemoto(aSubir).catch(() => {});
      }, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  // Ventana reciente de sesiones en vivo (hoy y ayer) + guardado de la activa
  useEffect(() => {
    if (!supabaseHabilitado) return;
    const cutoff = diaMenos(diaOperativoActual(), 1);

    let primera = true;
    const unsub = subscribeSesiones(cutoff, (remotas: Sesion[]) => {
      // Siempre se llama con el `cutoff`: así un reset de base de datos hecho
      // desde otro dispositivo también borra el caché local "zombie" de este
      // dispositivo en vez de quedar desactualizado.
      mergeRemoteSesiones(remotas, cutoff);
      if (primera) {
        primera = false;
        toast.success("Conectado a Supabase", { duration: 2000 });
      }
    });

    return unsub;
  }, [mergeRemoteSesiones]);

  // Guardado automático: SOLO la sesión activa (currentSesionId), debounced.
  useEffect(() => {
    if (!supabaseHabilitado) return;
    let ultimoJson = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = async () => {
      const { sesiones, currentSesionId } = useStore.getState();
      if (!currentSesionId) return;
      const s = sesiones.find((x) => x.id === currentSesionId);
      if (!s) return;
      const json = JSON.stringify(s);
      if (json === ultimoJson) return;
      try {
        await upsertSesion(s);
        ultimoJson = json;
      } catch (e) {
        console.error("Supabase guardar:", e);
      }
    };

    const unsub = useStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 1000);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, []);

  return null;
}

// Carga puntual usada por el setup antes de crear una sesión (chequeo de
// condición de carrera entre dispositivos). Re-exporta para conveniencia.
export { fetchSesionesDesde };
