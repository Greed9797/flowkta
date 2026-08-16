import { EngineError, defineCapability } from "@invokta/core";
import { z } from "zod";

import type { Deps } from "../deps.js";

const ID_DE_JOB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Acompanha um job de vídeo.
 *
 * O campo que importa numa falha não é a mensagem, é `creditoProvavelmenteGasto`: ele decide se
 * regerar é grátis ou é pagar duas vezes.
 *
 * `stderr` do processo externo vai INTEIRO para o logger e ZERO para o output — saída de
 * ferramenta é diagnóstico do operador, não payload para o modelo.
 */
export function videoStatus(deps: Deps) {
  return defineCapability({
    title: "Status da geração de vídeo",
    description:
      "Consulta o andamento de um job criado por video-iniciar. É gratuito e idempotente — mas consulte no máximo a cada 20 segundos; a geração leva 30–90s por clipe.",
    input: z.object({ jobId: z.string().regex(ID_DE_JOB, "jobId inválido") }).strict(),
    output: z.object({
      estado: z.enum(["rodando", "concluido", "parcial", "falhou", "cancelado"]),
      clipesProntos: z.number(),
      total: z.number(),
      artefatos: z.array(
        z.object({ id: z.string(), caminho: z.string(), bytes: z.number(), sha256: z.string() }),
      ),
      falha: z
        .object({
          classe: z.enum(["moderacao", "cota", "sessao-expirada", "ui-drift", "indeterminada"]),
          creditoProvavelmenteGasto: z.boolean(),
          oQueFazer: z.string(),
        })
        .optional(),
      decorridoS: z.number(),
    }),
    access: "public",
    annotations: {
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: false,
    },
    async run({ input }) {
      const job = deps.jobs.obter(input.jobId);
      if (job === undefined) {
        throw new EngineError({
          code: "CAPABILITY_NOT_FOUND",
          message: `job desconhecido: ${input.jobId}. O registro vive na memória do servidor MCP e não sobrevive a um restart — os arquivos, sim.`,
        });
      }

      // `falha` é OMITIDA quando não há falha, nunca enviada como undefined: o Invokta valida a
      // saída contra o modelo de dados JSON, onde undefined não existe, e rejeitaria a resposta
      // inteira de um job saudável.
      return {
        estado: job.estado,
        clipesProntos: job.artefatos.length,
        total: job.total,
        artefatos: job.artefatos,
        ...(job.falha === undefined ? {} : { falha: job.falha }),
        decorridoS: Math.round((Date.now() - job.iniciadoEm) / 1000),
      };
    },
  });
}
