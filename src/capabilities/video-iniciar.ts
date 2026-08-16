import { EngineError, defineCapability } from "@invokta/core";
import { z } from "zod";

import type { Deps } from "../deps.js";
import { LockOcupadoError } from "../lock.js";
import { gastoPermitido, motivoDaRecusa } from "../principal.js";
import { RotaImpossivelError, escolherRota } from "../rota.js";
import { dispararJobDeVideo } from "../worker.js";

/**
 * Enfileira UMA geração de vídeo e devolve um jobId. Nunca devolve o vídeo.
 *
 * Não existe `modelo` na entrada de propósito: se o agente escolhe o modelo, este engine vira
 * `gflow mcp run` com outro nome. A escolha de subcomando e modelo é do roteador, que conhece as
 * armadilhas que custam crédito.
 */
export function videoIniciar(deps: Deps) {
  return defineCapability({
    title: "Iniciar geração de vídeo",
    description: [
      "CUSTA CRÉDITO REAL da conta Google AI Ultra — uma chamada = um ou mais créditos, e uma falha de moderação pode gastar sem devolver arquivo.",
      "Chame UMA vez e acompanhe com video-status. NUNCA repita em laço.",
      "Retorna em menos de um segundo com um jobId; a geração leva 30–90s por clipe.",
      "modo='clipe' gera um vídeo a partir de um prompt; modo='sequencia' encadeia de 2 a 8 cenas.",
      "Passe `ancora` com o id de um artefato de imagem-gerar para travar o visual do primeiro frame.",
    ].join(" "),
    input: z
      .object({
        modo: z.enum(["clipe", "sequencia"]),
        prompt: z.string().trim().min(1).max(2000).optional(),
        cenas: z.array(z.string().trim().min(1).max(2000)).min(2).max(8).optional(),
        ancora: z.string().optional(),
        duracaoSegundos: z
          .union([z.literal(4), z.literal(6), z.literal(8), z.literal(10)])
          .default(8),
        aspecto: z.enum(["16:9", "9:16"]).default("16:9"),
      })
      .strict()
      .superRefine((valor, ctx) => {
        if (valor.modo === "clipe" && valor.prompt === undefined) {
          ctx.addIssue({ code: "custom", message: "modo='clipe' exige `prompt`", path: ["prompt"] });
        }
        if (valor.modo === "sequencia") {
          if (valor.cenas === undefined) {
            ctx.addIssue({ code: "custom", message: "modo='sequencia' exige `cenas`", path: ["cenas"] });
          }
          // Recusado aqui, de graça: `gflow video chain` proíbe omni-flash, e sem omni-flash não
          // existe controle de duração. Descobrir isso depois custaria crédito.
          if (valor.duracaoSegundos === 10) {
            ctx.addIssue({
              code: "custom",
              message: "sequência não suporta 10s (chain proíbe omni-flash, o único modelo com --duration). Use 8s.",
              path: ["duracaoSegundos"],
            });
          }
        }
      }),
    output: z.object({
      jobId: z.string(),
      clipesPrevistos: z.number(),
      rota: z.object({
        subcomando: z.string(),
        modelo: z.string(),
        duracaoSegundos: z.number(),
      }),
      motivoDaRota: z.string(),
      estimativaSegundos: z.number(),
    }),
    // "public" e não um AccessRule-função: no Invokta 0.6 uma regra em forma de função exige
    // principal não-nulo, e o adapter MCP stdio serve com `principal: null` — a regra nunca
    // chegaria a rodar, e todo mundo levaria UNAUTHENTICATED em vez do motivo real. O gate de
    // gasto mora no `run`, antes de qualquer spawn (o teste prova que o gerador não é tocado).
    access: "public",
    timeoutMs: 15_000,
    annotations: {
      readOnly: false,
      destructive: false,
      // Sem `idempotent`: repetir gasta de novo.
      openWorld: true,
    },
    async run({ input, context }) {
      // Primeira instrução do run, antes de criar job, adquirir lock ou spawnar qualquer coisa.
      const liberado = await gastoPermitido(deps.config, deps.jobs);
      if (!liberado) {
        throw new EngineError({
          code: "FORBIDDEN",
          message: await motivoDaRecusa(deps.config, deps.jobs),
        });
      }

      const temAncora = input.ancora !== undefined;
      let ancoraCaminho: string | undefined;
      if (input.ancora !== undefined) {
        const caminho = deps.jobs.resolverArtefato(input.ancora);
        if (caminho === null) {
          throw new EngineError({
            code: "INPUT_INVALID",
            message: `âncora desconhecida: ${input.ancora}. Use um id devolvido por imagem-gerar nesta sessão.`,
          });
        }
        ancoraCaminho = caminho;
      }

      let rota;
      try {
        rota = escolherRota({ modo: input.modo, temAncora, duracaoSegundos: input.duracaoSegundos });
      } catch (erro) {
        if (erro instanceof RotaImpossivelError) {
          throw new EngineError({ code: "INPUT_INVALID", message: erro.message });
        }
        throw erro;
      }

      const clipesPrevistos = input.modo === "sequencia" ? (input.cenas?.length ?? 0) : 1;
      const job = await deps.jobs.criar(clipesPrevistos);

      // O lock é adquirido ANTES de retornar: se o Chrome já está ocupado, recusamos de imediato
      // em vez de enfileirar. Profundidade zero é deliberada — fila real só quando existir um
      // segundo produtor concorrente medido.
      try {
        await deps.lock.adquirir(job.id);
      } catch (erro) {
        if (erro instanceof LockOcupadoError) {
          throw new EngineError({
            code: "EXECUTION_FAILED",
            message: `${erro.message}. Acompanhe com video-status ou libere com video-cancelar.`,
            publicDetails: { jobIdEmAndamento: erro.dono.jobId },
          });
        }
        throw erro;
      }

      dispararJobDeVideo(deps, job, {
        rota,
        prompt: input.prompt,
        cenas: input.cenas,
        ancora: ancoraCaminho,
        aspecto: input.aspecto,
      });

      return {
        jobId: job.id,
        clipesPrevistos,
        rota: {
          subcomando: rota.subcomando,
          modelo: rota.modelo,
          duracaoSegundos: rota.duracaoSegundos,
        },
        motivoDaRota: rota.motivo,
        estimativaSegundos: 60 * clipesPrevistos,
      };
    },
  });
}
