import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Config } from "../src/config.js";
import type { Deps } from "../src/deps.js";
import { criarFlowktaEngine } from "../src/engine.js";
import { RegistroDeJobs } from "../src/jobs.js";
import { LockDoGflow } from "../src/lock.js";
import type { GeradorDeImagem, GeradorDeVideo } from "../src/ports/midia.js";

/**
 * Toda a suíte roda contra geradores falsos: nenhum crédito é consumido, nenhum Chrome sobe.
 * É exatamente para isso que as portas existem.
 */

class GeradorFalso implements GeradorDeImagem, GeradorDeVideo {
  chamadas = 0;
  /** Quando true, a geração fica pendente para sempre — simula um clipe ainda renderizando. */
  travar = false;

  async gerar(): Promise<{ arquivos: readonly string[] }> {
    this.chamadas += 1;
    if (this.travar) await new Promise(() => {});
    return { arquivos: [] };
  }
}

let raiz: string;
let deps: Deps;
let gerador: GeradorFalso;

function montar(sobrepor: Partial<Config> = {}): Deps {
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
    ...sobrepor,
  };
  gerador = new GeradorFalso();
  return {
    config,
    jobs: new RegistroDeJobs(config.workdir),
    lock: new LockDoGflow(join(config.stateDir, "gflow.lock")),
    imagemGflow: gerador,
    imagemCodex: gerador,
    video: gerador,
  };
}

beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), "flowkta-test-"));
  deps = montar();
});

afterEach(async () => {
  await rm(raiz, { recursive: true, force: true });
});

describe("gate de gasto", () => {
  it("recusa video-iniciar sem FLOWKTA_ALLOW_SPEND e NÃO chega a spawnar nada", async () => {
    const engine = criarFlowktaEngine(deps);

    await expect(
      engine.invoke(
        "video-iniciar",
        { modo: "clipe", prompt: "um cubo girando" },
        { principal: null },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // A prova que importa: o gerador nunca foi tocado, logo nenhum crédito foi arriscado.
    expect(gerador.chamadas).toBe(0);
  });

  it("recusa quando o teto horário já foi atingido", async () => {
    const comTeto = montar({ permiteGastar: true, maxClipesPorHora: 1 });
    // Simula um clipe já produzido nesta hora.
    const jobAnterior = await comTeto.jobs.criar(1);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(jobAnterior.dir, "001.mp4"), "x");

    const engine = criarFlowktaEngine(comTeto);
    await expect(
      engine.invoke("video-iniciar", { modo: "clipe", prompt: "outro" }, { principal: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("não bloqueia imagem-gerar, que não queima crédito da conta Google", async () => {
    const engine = criarFlowktaEngine(deps);
    // Falha por não produzir arquivo (gerador falso), não por FORBIDDEN.
    await expect(
      engine.invoke(
        "imagem-gerar",
        { prompt: "um cubo", provider: "gflow" },
        { principal: null },
      ),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });
    expect(gerador.chamadas).toBe(1);
  });
});

describe("validação de entrada que economiza crédito", () => {
  it("recusa sequência de 10s antes de qualquer spawn", async () => {
    const engine = criarFlowktaEngine(montar({ permiteGastar: true }));
    await expect(
      engine.invoke(
        "video-iniciar",
        { modo: "sequencia", cenas: ["a", "b"], duracaoSegundos: 10 },
        { principal: null },
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(gerador.chamadas).toBe(0);
  });

  it("recusa modo='clipe' sem prompt", async () => {
    const engine = criarFlowktaEngine(montar({ permiteGastar: true }));
    await expect(
      engine.invoke("video-iniciar", { modo: "clipe" }, { principal: null }),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("recusa campo desconhecido — schemas são .strict()", async () => {
    const engine = criarFlowktaEngine(montar({ permiteGastar: true }));
    await expect(
      engine.invoke(
        "video-iniciar",
        // `as never` porque o próprio TypeScript já recusa este campo — o teste garante que o
        // schema em runtime recusa também, para um chamador não-tipado (MCP) não passar batido.
        { modo: "clipe", prompt: "x", modelo: "omni-flash" } as never,
        { principal: null },
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("recusa âncora que não é artefato conhecido (nunca aceitar path do modelo)", async () => {
    const engine = criarFlowktaEngine(montar({ permiteGastar: true }));
    await expect(
      engine.invoke(
        "video-iniciar",
        { modo: "clipe", prompt: "x", ancora: "/etc/passwd" },
        { principal: null },
      ),
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(gerador.chamadas).toBe(0);
  });
});

describe("lock serial do Chrome", () => {
  it("a segunda geração é recusada e o gerador roda uma vez só", async () => {
    const comGasto = montar({ permiteGastar: true });
    // O primeiro job fica renderizando: é assim que o lock existe para valer.
    gerador.travar = true;
    const engine = criarFlowktaEngine(comGasto);

    const primeira = await engine.invoke(
      "video-iniciar",
      { modo: "clipe", prompt: "cena um" },
      { principal: null },
    );
    expect(primeira).toMatchObject({ clipesPrevistos: 1 });

    await expect(
      engine.invoke("video-iniciar", { modo: "clipe", prompt: "cena dois" }, { principal: null }),
    ).rejects.toMatchObject({ code: "EXECUTION_FAILED" });

    expect(gerador.chamadas).toBe(1);
  });

  it("reaproveita lock órfão de um processo morto", async () => {
    const lock = new LockDoGflow(join(raiz, "state", "gflow.lock"));
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(raiz, "state"), { recursive: true });
    // PID altíssimo e inexistente: o dono está morto.
    await writeFile(
      join(raiz, "state", "gflow.lock"),
      JSON.stringify({ pid: 999_999, jobId: "antigo", iniciadoEm: new Date().toISOString() }),
    );

    expect(await lock.estaLivre()).toBe(true);
    await expect(lock.adquirir("novo")).resolves.toBeUndefined();
    expect((await lock.lerDono())?.jobId).toBe("novo");
  });

  it("um lock de processo vivo não é roubado", async () => {
    const lock = new LockDoGflow(join(raiz, "state", "gflow.lock"));
    await lock.adquirir("primeiro");
    await expect(lock.adquirir("segundo")).rejects.toThrow(/já está em uso/);
  });
});

describe("video-status", () => {
  it("um job sem falha passa pela validação de saída (falha omitida, nunca undefined)", async () => {
    const comGasto = montar({ permiteGastar: true });
    gerador.travar = true;
    const engine = criarFlowktaEngine(comGasto);

    const { jobId } = (await engine.invoke(
      "video-iniciar",
      { modo: "clipe", prompt: "cena" },
      { principal: null },
    )) as { jobId: string };

    // O Invokta valida a saída contra o modelo de dados JSON: um `falha: undefined` explícito
    // derrubaria a resposta inteira de um job perfeitamente saudável.
    const status = (await engine.invoke("video-status", { jobId }, { principal: null })) as {
      estado: string;
      falha?: unknown;
    };
    expect(status.estado).toBe("rodando");
    expect("falha" in status).toBe(false);
  });
});

describe("rota devolvida ao chamador", () => {
  it("explica por que escolheu r2v quando há âncora e 10s", async () => {
    const comGasto = montar({ permiteGastar: true });
    const engine = criarFlowktaEngine(comGasto);

    const job = await comGasto.jobs.criar(1);
    const { writeFile } = await import("node:fs/promises");
    const png = join(job.dir, "ref.png");
    await writeFile(png, "conteudo");
    const artefato = await comGasto.jobs.adotarArtefato(job, png);

    const resultado = (await engine.invoke(
      "video-iniciar",
      { modo: "clipe", prompt: "produto girando", ancora: artefato.id, duracaoSegundos: 10 },
      { principal: null },
    )) as { rota: { subcomando: string; modelo: string }; motivoDaRota: string };

    expect(resultado.rota).toMatchObject({ subcomando: "r2v", modelo: "omni-flash" });
    expect(resultado.motivoDaRota).toMatch(/i2v/i);
  });
});
