"use client";

import { useSyncExternalStore } from "react";

// Devuelve `false` durante el render del servidor y el primer render del
// cliente (antes de hidratar) y `true` una vez montado en el cliente. Reemplaza
// al patrón `const [h,setH]=useState(false); useEffect(()=>setH(true),[])`, que
// dispara `setState` dentro de un efecto (regla react-hooks/set-state-in-effect).
// Con useSyncExternalStore no hay setState en efecto: el valor del servidor es
// el snapshot del servidor (false) y el del cliente es el getSnapshot (true).
const emptySubscribe = () => () => {};

export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // cliente: ya hidratado
    () => false // servidor / primer render: aún no
  );
}
