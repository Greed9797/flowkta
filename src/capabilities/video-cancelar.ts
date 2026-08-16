import { EngineError, defineCapability } from "@invokta/core";
import { z } from "zod";

import type { Deps } from "../deps.js";

const ID_DE_JOB = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mata o processo do gflow e libera o lock do Chrome.
 *
 * Existe porque o `context.signal` do Invokta apenas rejeita a Promise da chamada: ele não
 * alcança um processo externo que continua rodando. Sem esta capability, um timeout do host
 * deixaria um Chrome órfão segurando o profile para sempre, e toda geração seguinte falharia
 * com ProfileLockedError.
 */
export function videoCancelar(deps: Deps) {
  return defineCapability({
    title: "Cancelar geração de vídeo",
    description:
      "Interrompe um job em andamento e libera o Chrome para a próxima geração. ATENÇÃO: cancelar NÃO estorna — se o Flow já aceitou o job, o crédito foi consumido.",
    input: z
      .object({
        jobId: z.string().regex(ID_DE_JOB, "jobId inválido"),
        motivo: z.string().max(500).optional(),
      })
      .strict(),
    output: z.object({
      cancelado: z.boolean(),
      lockLiberado: z.boolean(),
      creditoProvavelmenteGasto: z.boolean(),
    }),
    access: "public",
    annotations: {
      readOnly: false,
      destructive: true,
      idempotent: true,
      openWorld: false,
    },
    async run({ input, context }) {
      const job = deps.jobs.obter(input.jobId);
      if (job === undefined) {
        throw new EngineError({
          code: "CAPABILITY_NOT_FOUND",
          message: `job desconhecido: ${input.jobId}`,
        });
      }

      const estavaRodando = job.estado === "rodando";
      if (estavaRodando) {
        context.logger.warn("cancelando job de vídeo", { jobId: job.id, motivo: input.motivo });
        job.estado = "cancelado";
        job.controller?.abort();
      }

      await deps.lock.liberar();

      return {
        cancelado: estavaRodando,
        lockLiberado: true,
        // Se o processo já tinha nascido, a submissão pode ter chegado ao Flow.
        creditoProvavelmenteGasto: estavaRodando && job.pid !== undefined,
      };
    },
  });
}
