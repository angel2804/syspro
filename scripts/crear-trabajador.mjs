// ============================================================================
// Crea/actualiza la CUENTA COMPARTIDA de trabajador (Supabase Auth) + su perfil
// rol='trabajador'. (La limpieza de usuarios anónimos viejos está en
// `scripts/limpiar-anonimos.mjs`, aparte, porque borra datos.)
//
// Uso (desde la raíz del proyecto):
//   node scripts/crear-trabajador.mjs [email] [password] [nombre]
// Por defecto: trabajador@grifo.local / grifo1234 / "Trabajador"
//
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

const EMAIL = process.argv[2] || "trabajador@grifo.local";
const PASS = process.argv[3] || "grifo1234";
const NOMBRE = process.argv[4] || "Trabajador";

// 1) Crear o actualizar la cuenta compartida.
let userId;
const { data: created, error: cErr } = await sb.auth.admin.createUser({
  email: EMAIL,
  password: PASS,
  email_confirm: true,
});
if (cErr) {
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = list.users.find((u) => u.email === EMAIL);
  if (!found) throw new Error("No se pudo crear ni encontrar la cuenta: " + cErr.message);
  userId = found.id;
  await sb.auth.admin.updateUserById(userId, { password: PASS, email_confirm: true });
  console.log("Cuenta ya existía; contraseña actualizada.");
} else {
  userId = created.user.id;
}

const { data: perfil, error: pErr } = await sb
  .from("profiles")
  .upsert({ id: userId, nombre: NOMBRE, rol: "trabajador", permisos: [], activo: true })
  .select()
  .single();
if (pErr) throw new Error("profiles upsert: " + pErr.message);
if (!perfil) throw new Error("El perfil no quedó escrito; reintenta el script.");
console.log("✅ Cuenta compartida de trabajador lista:", EMAIL, "/", PASS, "id=", userId);
