import { describe, expect, it } from "vitest";

import {
  type DuracaoSegundos,
  RotaImpossivelError,
  escolherRota,
} from "../src/rota.js";

const DURACOES: readonly DuracaoSegundos[] = [4, 6, 8, 10];

describe("escolherRota — tabela exaustiva", () => {
  const casos = [
    { modo: "clipe", temAncora: false, duracaoSegundos: 10, subcomando: "t2v", modelo: "omni-flash" },
    { modo: "clipe", temAncora: false, duracaoSegundos: 8, subcomando: "t2v", modelo: "veo-lite" },
    { modo: "clipe", temAncora: false, duracaoSegundos: 6, subcomando: "t2v", modelo: "veo-lite" },
    { modo: "clipe", temAncora: false, duracaoSegundos: 4, subcomando: "t2v", modelo: "veo-lite" },
    { modo: "clipe", temAncora: true, duracaoSegundos: 10, subcomando: "r2v", modelo: "omni-flash" },
    { modo: "clipe", temAncora: true, duracaoSegundos: 8, subcomando: "i2v", modelo: "veo-lite" },
    { modo: "clipe", temAncora: true, duracaoSegundos: 6, subcomando: "i2v", modelo: "veo-lite" },
    { modo: "clipe", temAncora: true, duracaoSegundos: 4, subcomando: "i2v", modelo: "veo-lite" },
    { modo: "sequencia", temAncora: false, duracaoSegundos: 8, subcomando: "chain", modelo: "veo-lite" },
    { modo: "sequencia", temAncora: true, duracaoSegundos: 4, subcomando: "chain", modelo: "veo-lite" },
  ] as const;

  for (const caso of casos) {
    it(`${caso.modo} âncora=${caso.temAncora} ${caso.duracaoSegundos}s → ${caso.subcomando}/${caso.modelo}`, () => {
      const rota = escolherRota(caso);
      expect(rota.subcomando).toBe(caso.subcomando);
      expect(rota.modelo).toBe(caso.modelo);
      expect(rota.duracaoSegundos).toBe(caso.duracaoSegundos);
      expect(rota.motivo).not.toHaveLength(0);
    });
  }

  it("cobre toda a matriz clipe × âncora × duração", () => {
    // Se alguém adicionar uma duração nova, este teste falha antes de a rota virar undefined.
    const combinacoes = DURACOES.flatMap((d) => [true, false].map((a) => ({ d, a })));
    for (const { d, a } of combinacoes) {
      expect(() => escolherRota({ modo: "clipe", temAncora: a, duracaoSegundos: d })).not.toThrow();
    }
    expect(combinacoes).toHaveLength(casos.filter((c) => c.modo === "clipe").length);
  });
});

describe("escolherRota — recusas que economizam crédito", () => {
  it("recusa sequência de 10s antes de gastar", () => {
    expect(() => escolherRota({ modo: "sequencia", temAncora: false, duracaoSegundos: 10 })).toThrow(
      RotaImpossivelError,
    );
  });

  it("explica por que a sequência de 10s é impossível", () => {
    expect(() => escolherRota({ modo: "sequencia", temAncora: false, duracaoSegundos: 10 })).toThrow(
      /chain.*proíbe omni-flash|omni-flash/i,
    );
  });
});

describe("escolherRota — invariantes que protegem crédito", () => {
  it("nunca combina i2v com omni-flash (o Flow descarta o frame e cobra assim mesmo)", () => {
    for (const d of DURACOES) {
      for (const temAncora of [true, false]) {
        const rota = escolherRota({ modo: "clipe", temAncora, duracaoSegundos: d });
        expect(rota.subcomando === "i2v" && rota.modelo === "omni-flash").toBe(false);
      }
    }
  });

  it("só usa omni-flash quando a duração exige (é o único modelo com --duration)", () => {
    for (const d of DURACOES) {
      for (const temAncora of [true, false]) {
        const rota = escolherRota({ modo: "clipe", temAncora, duracaoSegundos: d });
        if (rota.modelo === "omni-flash") expect(d).toBe(10);
      }
    }
  });

  it("nunca usa omni-flash em chain", () => {
    for (const d of [4, 6, 8] as const) {
      expect(escolherRota({ modo: "sequencia", temAncora: false, duracaoSegundos: d }).modelo).not.toBe(
        "omni-flash",
      );
    }
  });

  it("declara limite de referências coerente com o modelo", () => {
    expect(escolherRota({ modo: "clipe", temAncora: true, duracaoSegundos: 10 }).limiteDeReferencias).toBe(7);
    expect(escolherRota({ modo: "clipe", temAncora: true, duracaoSegundos: 8 }).limiteDeReferencias).toBe(3);
  });
});
