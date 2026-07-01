import { describe, expect, it } from "vitest";
import {
  normalizar,
  resolverCliente,
  similitud,
  sugerirClientes,
  planificarFusion,
  type AliasRef,
  type ClienteRef,
} from "./clientes";

function cli(nombre: string, id = nombre): ClienteRef {
  return { id, nombre, nombreNormalizado: normalizar(nombre), estado: "activo" };
}

describe("normalizar", () => {
  it("minúsculas, sin acentos ni puntuación", () => {
    expect(normalizar("Belquér, S.A.C.")).toBe("belquer");
    expect(normalizar("  José   Pérez  ")).toBe("jose perez");
  });
  it("quita sufijos societarios", () => {
    expect(normalizar("Belquer SAC")).toBe("belquer");
    expect(normalizar("Transportes EIRL")).toBe("transportes");
    expect(normalizar("Grifo SRL")).toBe("grifo");
  });
});

describe("similitud difusa detecta typos de Belquer", () => {
  it("belqer ≈ belquer", () => {
    expect(similitud("belqer", "Belquer")).toBeGreaterThan(0.7);
  });
  it("beqer ≈ belquer", () => {
    expect(similitud("beqer", "Belquer")).toBeGreaterThan(0.55);
  });
  it("belker ≈ belquer", () => {
    expect(similitud("belker", "Belquer")).toBeGreaterThan(0.6);
  });
  it("nombres distintos NO se parecen", () => {
    expect(similitud("Miguel", "Belquer")).toBeLessThan(0.4);
  });
});

describe("resolverCliente", () => {
  const clientes = [cli("Belquer"), cli("Miguel Torres")];

  it("match exacto por nombre normalizado", () => {
    const r = resolverCliente("belquer", clientes);
    expect(r.tipo).toBe("exacto");
    if (r.tipo === "exacto") expect(r.cliente.nombre).toBe("Belquer");
  });

  it("match exacto por alias", () => {
    const alias: AliasRef[] = [
      { clienteId: "Belquer", alias: "Belker", aliasNormalizado: normalizar("Belker") },
    ];
    const r = resolverCliente("belker", clientes, alias);
    expect(r.tipo).toBe("exacto");
    if (r.tipo === "exacto") expect(r.cliente.id).toBe("Belquer");
  });

  it("pide confirmación ante typo fuerte (belqer)", () => {
    const r = resolverCliente("belqer", clientes);
    expect(r.tipo).toBe("confirmar");
    if (r.tipo === "confirmar") {
      expect(r.sugerencias[0].cliente.nombre).toBe("Belquer");
    }
  });

  it("nombre claramente nuevo se permite crear", () => {
    const r = resolverCliente("Estacion Norte", clientes);
    expect(r.tipo).toBe("nuevo");
  });

  it("ignora clientes fusionados como candidatos", () => {
    const conFusionado = [
      { id: "viejo", nombre: "Belquer", nombreNormalizado: normalizar("Belquer"), estado: "fusionado" as const },
      cli("Otro Cliente"),
    ];
    const r = resolverCliente("belquer", conFusionado);
    expect(r.tipo).not.toBe("exacto");
  });
});

describe("sugerirClientes", () => {
  it("ordena por similitud y respeta el límite", () => {
    const clientes = [cli("Belquer"), cli("Belker"), cli("Beltran"), cli("Zeta Gas")];
    const s = sugerirClientes("belqer", clientes, [], { limite: 2 });
    expect(s.length).toBeLessThanOrEqual(2);
    expect(s[0].cliente.nombre).toBe("Belquer");
  });
  it("encuentra por alias e indica viaAlias", () => {
    const clientes = [cli("Estación Belquer", "id1")];
    const alias: AliasRef[] = [
      { clienteId: "id1", alias: "Belquer", aliasNormalizado: normalizar("Belquer") },
    ];
    const s = sugerirClientes("belquer", clientes, alias);
    expect(s[0].viaAlias).toBe("Belquer");
  });
});

describe("planificarFusion", () => {
  it("reapunta créditos/pagos/alias y crea alias con el nombre del origen", () => {
    const plan = planificarFusion(cli("Belker", "origen"), cli("Belquer", "destino"));
    expect(plan.origenId).toBe("origen");
    expect(plan.destinoId).toBe("destino");
    expect(plan.reapuntarCreditos).toEqual({ de: "origen", a: "destino" });
    expect(plan.nuevoAlias).toBe("Belker");
  });
  it("no permite fusionar consigo mismo", () => {
    expect(() => planificarFusion(cli("X", "a"), cli("X", "a"))).toThrow();
  });
});
