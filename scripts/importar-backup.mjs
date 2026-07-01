// ============================================================================
// Importa un archivo de backup (JSON con {id,createdAt,dia,nota,sesiones,config})
// a la tabla `backups` de Supabase. Luego se RESTAURA desde el panel admin
// (Configuraciones → Backups → Restaurar), que escribe sesiones + config.
//
// Uso (desde la raíz del proyecto):
//   node scripts/importar-backup.mjs "C:/ruta/al/backup.json"
// Requiere SUPABASE_SERVICE_ROLE_KEY y NEXT_PUBLIC_SUPABASE_URL en .env.local.
// ============================================================================
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const ruta = process.argv[2];
if (!ruta) throw new Error("Falta la ruta del backup: node scripts/importar-backup.mjs <archivo.json>");

const b = JSON.parse(readFileSync(ruta, "utf8"));
if (!Array.isArray(b.sesiones)) throw new Error("El archivo no parece un backup válido (falta 'sesiones').");

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// La tabla backups guarda la nota dentro de config (así lo lee la app).
const fila = {
  id: b.id ?? `bk_import_${Date.now()}`,
  created_at: b.createdAt ?? Date.now(),
  dia: b.dia ?? new Date().toISOString().slice(0, 10),
  sesiones: b.sesiones,
  config: { ...(b.config ?? {}), nota: b.nota ?? "Importado" },
};

const { error } = await sb.from("backups").upsert(fila);
if (error) throw new Error("upsert backups: " + error.message);

console.log(`✅ Backup importado: ${fila.id} (${b.sesiones.length} sesiones, día ${fila.dia}).`);
console.log("   Ahora entra al panel admin → Configuraciones → Backups → Restaurar.");
