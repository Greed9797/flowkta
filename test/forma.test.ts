import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Config } from "../src/config.js";
import { criarFlowktaEngine } from "../src/engine.js";
import { RegistroDeJobs } from "../src/jobs.js";
import { LockDoGflow } from "../src/lock.js";
import type { GeradorDeImagem, GeradorDeVideo } from "../src/ports/midia.js";

/**
 * Invariantes de DESENHO, não de comportamento.
 *
 * Estes testes existem para que uma capability futura não desfaça em silêncio as decisões que
 * este engine tomou. Cada um deles corresponde a um jeito conhecido de o design apodrecer.
 */

const IDS_ESPERADOS = [
  "midia-diagnostico",
  "imagem-gerar",
  "video-iniciar",
  "video-status",
  "video-cancelar",
] as const;

type IdDeCapability = (typeof IDS_ESPERADOS)[number];

/** `engine.list()` devolve id como string; `describe()` exige o literal. */
function descrever(engine: ReturnType<typeof criarFlowktaEngine>, id: string) {
  return engine.describe(id as IdDeCapability);
}

function propriedadesDeEntrada(engine: ReturnType<typeof criarFlowktaEngine>, id: string): string[] {
  const schema = descrever(engine, id).inputSchema as { properties?: Record<string, unknown> };
  return Object.keys(schema.properties ?? {});
}

const QUE_GASTAM = new Set(["video-iniciar", "imagem-gerar"]);

class Nulo implements GeradorDeImagem, GeradorDeVideo {
  async gerar(): Promise<{ arquivos: readonly string[] }> {
    return { arquivos: [] };
  }
}

let raiz: string;
let engine: ReturnType<typeof criarFlowktaEngine>;

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "flowkta-forma-"));
  const config: Config = {
    workdir: raiz,
    stateDir: join(raiz, "state"),
    permiteGastar: false,
    maxClipesPorHora: 5,
    gflowBin: "/bin/false",
    codexBin: "/bin/false",
    codexModel: "modelo-de-teste",
    gflowProfile: undefined,
    codexHome: join(raiz, "codex"),
  };
  const nulo = new Nulo();
  engine = criarFlowktaEngine({
    config,
    jobs: new RegistroDeJobs(config.workdir),
    lock: new LockDoGflow(join(config.stateDir, "gflow.lock")),
    imagemGflow: nulo,
    imagemCodex: nulo,
    video: nulo,
  });
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("invariantes de forma", () => {
  it("expõe exatamente as capabilities previstas", () => {
    expect(engine.list().map((c) => c.id).sort()).toEqual([...IDS_ESPERADOS].sort());
  });

  it("usa ids sem ponto, para CLI e MCP mostrarem o mesmo nome", () => {
    // O adapter MCP troca caracteres fora de [a-zA-Z0-9_-] por underscore. Um id com ponto
    // apareceria como `video_iniciar` no MCP e `video.iniciar` na CLI.
    for (const { id } of engine.list()) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("nenhum input aceita caminho, URL ou host — o modelo não escolhe onde ler ou escrever", () => {
    for (const { id } of engine.list()) {
      const schema = JSON.stringify(descrever(engine, id).inputSchema);
      expect(propriedadesDeEntrada(engine, id).join(" "), `${id} expõe caminho/URL na entrada`).not.toMatch(
        /url|host|origin|endpoint|caminho|path|dir/i,
      );
      expect(schema).not.toMatch(/"format"\s*:\s*"uri"/);
    }
  });

  it("nenhum input aceita modelo, perfil ou credencial — essa escolha é do roteador", () => {
    for (const { id } of engine.list()) {
      if (id === "imagem-gerar") continue; // exceção deliberada: ver teste seguinte
      expect(
        propriedadesDeEntrada(engine, id).join(" "),
        `${id} deixa o agente escolher modelo`,
      ).not.toMatch(/model|modelo|omni|veo|nano|profile|perfil|token|key/i);
    }
  });

  it("imagem-gerar é a única a expor modelo, e ainda assim sem perfil ou credencial", () => {
    const propriedades = propriedadesDeEntrada(engine, "imagem-gerar");
    // Imagem é barata e a escolha de modelo é estética, não de custo — por isso é aceitável aqui.
    expect(propriedades).toContain("modelo");
    expect(propriedades.join(" ")).not.toMatch(/profile|perfil|token|key/i);
  });

  it("capability que gasta nunca se declara idempotente", () => {
    for (const { id, annotations } of engine.list()) {
      if (!QUE_GASTAM.has(id)) continue;
      // Anunciar idempotência convidaria o agente a repetir sob incerteza — e repetir é pagar.
      expect(annotations?.idempotent, `${id} não pode ser idempotente`).not.toBe(true);
    }
  });

  it("a capability que queima crédito avisa disso na primeira linha da description", () => {
    const { description } = engine.describe("video-iniciar");
    expect(description).toMatch(/CUSTA CRÉDITO REAL/);
    expect(description).toMatch(/NUNCA repita em laço/i);
  });

  it("video-cancelar é declarada destrutiva", () => {
    expect(engine.describe("video-cancelar").annotations?.destructive).toBe(true);
  });

  it("o diagnóstico é gratuito, somente leitura e idempotente", () => {
    const { annotations } = engine.describe("midia-diagnostico");
    expect(annotations).toMatchObject({ readOnly: true, idempotent: true, destructive: false });
  });

  it("todo input é fechado: campo desconhecido é recusado", () => {
    for (const { id } of engine.list()) {
      const schema = descrever(engine, id).inputSchema as { additionalProperties?: unknown };
      expect(schema.additionalProperties, `${id} aceita campo desconhecido`).toBe(false);
    }
  });

  it("video-iniciar tem timeout curto — ele enfileira, não espera renderizar", () => {
    const { timeoutMs } = engine.describe("video-iniciar");
    expect(timeoutMs).toBeLessThanOrEqual(30_000);
  });
});
