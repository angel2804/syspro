// ============================================================================
// Limpieza OPT-IN: borra los usuarios anónimos (y sus perfiles) que quedaron de
// pruebas anteriores, ya que el flujo de trabajador ahora usa una cuenta
// COMPARTIDA (no anónimos). ⚠️ BORRA DATOS. Corre solo cuando lo decidas:
//   node scripts/limpiar-anonimos.mjs
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

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

let borrados = 0;
for (let page = 1; ; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw new Error(error.message);
  for (const u of data.users.filter((x) => x.is_anonymous)) {
    await sb.from("profiles").delete().eq("id", u.id);
    await sb.auth.admin.deleteUser(u.id);
    borrados++;
  }
  if (data.users.length < 200) break;
}
console.log(`🧹 Usuarios anónimos eliminados: ${borrados}`);
