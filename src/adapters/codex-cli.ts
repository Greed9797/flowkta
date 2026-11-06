import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Config } from "../config.js";
import type { GeradorDeImagem, PedidoDeImagem, ResultadoDeGeracao } from "../ports/midia.js";
import { executar } from "./executar.js";

/**
 * Adapter do Codex CLI usando a tool nativa `image_gen`.
 *
 * Roda na assinatura ChatGPT do usuário — nenhuma OPENAI_API_KEY é lida ou exigida.
 *
 * Descoberta do arquivo, validada por probe real:
 *   camada 1 (principal) — `--output-schema` força a resposta final a ser JSON com forma
 *     conhecida, escrita em `--output-last-message`. Determinístico, sem parsing de prosa.
 *   camada 2 (fallback)  — `$CODEX_HOME/generated_images/<session_id>/exec-*.png`. O Codex
 *     particiona por sessão, então não há corrida por mtime com outros originadores.
 *
 * O prompt precisa proibir vetor explicitamente: a skill `imagegen` do próprio Codex manda
 * preferir SVG para ícone/logo/UI, que é exatamente o nosso caso de uso.
 */

const ESQUEMA_DA_RESPOSTA = {
  type: "object",
  additionalProperties: false,
  required: ["caminhoAbsoluto", "gerou"],
  properties: {
    caminhoAbsoluto: {
      type: "string",
      description: "caminho absoluto do PNG final copiado para o diretório de trabalho",
    },
    gerou: { type: "boolean", description: "true se image_gen produziu um bitmap novo" },
  },
} as const;

const PNG_MAGICO = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function ehPng(caminho: string): Promise<boolean> {
  const conteudo = await readFile(caminho).catch(() => null);
  return conteudo !== null && conteudo.subarray(0, 4).equals(PNG_MAGICO);
}

/**
 * why: falha de turno (modelo recusado, cota, auth) chega como evento no stream `--json` do
 * stdout; o stderr só carrega log de ruído. Ler só o stderr escondeu a causa real.
 * Eventos `item.completed` com item de erro são avisos não fatais e ficam de fora.
 */
export function erroDoStream(stdout: string): string | undefined {
  for (const linha of stdout.split("\n").reverse()) {
    if (!linha.includes('"turn.failed"') && !linha.includes('"type":"error"')) continue;
    try {
      const evento = JSON.parse(linha) as { type?: string; message?: string; error?: { message?: string } };
      if (evento.type === "turn.failed" && evento.error?.message) return evento.error.message;
      if (evento.type === "error" && evento.message) return evento.message;
    } catch {
      // hazard: linha cortada pelo limite de stdout não é JSON; segue para a anterior.
    }
  }
  return undefined;
}

function montarPrompt(pedido: PedidoDeImagem, destino: string): string {
  const partes = [
    `Use a ferramenta nativa image_gen para gerar ${pedido.quantidade} imagem(ns) bitmap PNG.`,
    `Proporção desejada: ${pedido.aspecto}.`,
    `Conteúdo: ${pedido.prompt}`,
    "NÃO produza SVG, NÃO produza HTML, NÃO escreva código de desenho — precisa ser bitmap da image_gen.",
    `Copie o PNG resultante para ${destino} e responda no schema JSON pedido com o caminho absoluto final.`,
  ];
  if (pedido.referencias.length > 0) {
    partes.splice(2, 0, `Use como referência visual: ${pedido.referencias.join(", ")}.`);
  }
  return partes.join(" ");
}

export class CodexAdapter implements GeradorDeImagem {
  constructor(private readonly config: Config) {}

  async gerar(pedido: PedidoDeImagem): Promise<ResultadoDeGeracao> {
    const raizGeradas = join(this.config.codexHome, "generated_images");
    const sessoesAntes = new Set(await readdir(raizGeradas).catch(() => [] as string[]));

    const esquemaPath = join(pedido.dirDoJob, "codex-schema.json");
    const ultimaMensagem = join(pedido.dirDoJob, "codex-last.json");
    const destino = join(pedido.dirDoJob, "codex.png");
    await writeFile(esquemaPath, JSON.stringify(ESQUEMA_DA_RESPOSTA), "utf8");

    const argv = [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-C",
      pedido.dirDoJob,
      "-s",
      "workspace-write",
      "-m",
      this.config.codexModel,
      "-c",
      'model_reasoning_effort="medium"',
      "--output-schema",
      esquemaPath,
      "-o",
      ultimaMensagem,
      montarPrompt(pedido, destino),
    ];

    const resultado = await executar(this.config.codexBin, argv, {
      cwd: pedido.dirDoJob,
      signal: pedido.signal,
      // O stream do codex carrega a imagem em base64: reter tudo custaria megabytes de memória
      // por chamada, e não precisamos do payload — o arquivo já está em disco.
      maxStdoutBytes: 64 * 1024,
    });

    const erroDoTurno = erroDoStream(resultado.stdout);
    if (resultado.code !== 0) {
      throw new Error(
        `codex exec falhou (exit ${resultado.code}, modelo ${this.config.codexModel}): ${erroDoTurno ?? resultado.stderr.slice(-500)}`,
      );
    }

    const encontrados: string[] = [];

    // Camada 1 — resposta estruturada.
    const bruto = await readFile(ultimaMensagem, "utf8").catch(() => "");
    if (bruto.trim().startsWith("{")) {
      try {
        const resposta = JSON.parse(bruto) as { caminhoAbsoluto?: string };
        if (resposta.caminhoAbsoluto && (await ehPng(resposta.caminhoAbsoluto))) {
          encontrados.push(resposta.caminhoAbsoluto);
        }
      } catch {
        // cai para a camada 2
      }
    }

    // Camada 2 — diretório da sessão nova em generated_images.
    if (encontrados.length === 0) {
      const sessoes = await readdir(raizGeradas).catch(() => [] as string[]);
      for (const sessao of sessoes.filter((s) => !sessoesAntes.has(s))) {
        const arquivos = await readdir(join(raizGeradas, sessao)).catch(() => [] as string[]);
        for (const arquivo of arquivos.filter((a) => a.toLowerCase().endsWith(".png")).sort()) {
          const caminho = join(raizGeradas, sessao, arquivo);
          if (await ehPng(caminho)) encontrados.push(caminho);
        }
      }
    }

    if (encontrados.length === 0) {
      // Zero arquivo produzido é falha explícita, nunca sucesso com lista vazia. O caso comum
      // aqui é o Codex ter respondido com SVG ou com código em vez de chamar image_gen.
      throw new Error(
        erroDoTurno === undefined
          ? "codex não produziu nenhum PNG válido (verifique se a resposta veio como SVG/código em vez de bitmap da image_gen)"
          : `codex não produziu nenhum PNG válido: ${erroDoTurno}`,
      );
    }

    return { arquivos: encontrados };
  }
}
