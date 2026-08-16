import { EngineError, defineCapability } from "@invokta/core";
import { z } from "zod";

import type { Deps } from "../deps.js";

/**
 * Geração de imagem, síncrona (10–30s cabe em qualquer host).
 *
 * `provider` é obrigatório e não tem `'auto'` de propósito: escolher entre o gflow (grátis, na
 * conta Google) e o Codex (consome cota da assinatura ChatGPT) é uma decisão de custo. Heurística
 * escondida no engine seria gasto escondido — a heurística mora na Skill, onde o usuário a vê.
 */
export function imagemGerar(deps: Deps) {
  return defineCapability({
    title: "Gerar imagem",
    description: [
      "Gera imagens PNG por um de dois provedores.",
      "provider='gflow' usa o Google Flow (modelos nano2/nano-pro/image4) — praticamente sem custo, melhor para cena, estilo e composição.",
      "provider='codex' usa a tool nativa image_gen do Codex CLI na assinatura ChatGPT — CONSOME COTA DA ASSINATURA, e é melhor para texto legível dentro da imagem, UI e packshot de produto.",
      "O caminho devolvido já está sob custódia deste engine; use o id do artefato como âncora em video-iniciar.",
    ].join(" "),
    input: z
      .object({
        prompt: z.string().trim().min(1).max(2000),
        provider: z.enum(["gflow", "codex"]),
        modelo: z.enum(["nano2", "nano-pro", "image4"]).optional(),
        aspecto: z.enum(["16:9", "9:16", "1:1", "4:3", "3:4"]).default("16:9"),
        quantidade: z.number().int().min(1).max(4).default(1),
        referencias: z.array(z.string()).max(7).default([]),
      })
      .strict(),
    output: z.object({
      artefatos: z.array(
        z.object({
          id: z.string(),
          caminho: z.string(),
          bytes: z.number(),
          sha256: z.string(),
        }),
      ),
      provider: z.string(),
      modelo: z.string().nullable(),
    }),
    access: "public",
    timeoutMs: 180_000,
    annotations: {
      readOnly: false,
      destructive: false,
      // Sem `idempotent`: cada chamada produz arte nova e, no provider codex, consome cota.
      openWorld: true,
    },
    async run({ input, context }) {
      const referencias: string[] = [];
      for (const ref of input.referencias) {
        const caminho = deps.jobs.resolverArtefato(ref);
        if (caminho === null) {
          throw new EngineError({
            code: "INPUT_INVALID",
            message: `referência desconhecida: ${ref}. Use um id devolvido por imagem-gerar nesta sessão.`,
          });
        }
        referencias.push(caminho);
      }

      const job = await deps.jobs.criar(input.quantidade);
      const gerador = input.provider === "codex" ? deps.imagemCodex : deps.imagemGflow;

      let arquivos: readonly string[];
      try {
        ({ arquivos } = await gerador.gerar({
          prompt: input.prompt,
          modelo: input.modelo,
          aspecto: input.aspecto,
          quantidade: input.quantidade,
          referencias,
          dirDoJob: job.dir,
          signal: context.signal,
        }));
      } catch (erro) {
        context.logger.error("falha ao gerar imagem", {
          provider: input.provider,
          detalhe: erro instanceof Error ? erro.message : String(erro),
        });
        throw new EngineError({
          code: "EXECUTION_FAILED",
          message: erro instanceof Error ? erro.message : "falha ao gerar imagem",
          cause: erro,
        });
      }

      if (arquivos.length === 0) {
        throw new EngineError({
          code: "EXECUTION_FAILED",
          message: "o provedor terminou sem erro mas não produziu nenhuma imagem",
        });
      }

      const artefatos = [];
      for (const arquivo of arquivos) artefatos.push(await deps.jobs.adotarArtefato(job, arquivo));
      job.estado = "concluido";

      return {
        artefatos,
        provider: input.provider,
        modelo: input.provider === "codex" ? "gpt-image (image_gen)" : (input.modelo ?? "nano2"),
      };
    },
  });
}
