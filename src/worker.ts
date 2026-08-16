import type { Deps } from "./deps.js";
import { ErroDoGflow } from "./adapters/gflow-cli.js";
import type { Job } from "./jobs.js";
import type { Rota } from "./rota.js";

/**
 * Executa a geração de vídeo em segundo plano.
 *
 * Motivo de existir separado das capabilities: gerar leva 30–90s por clipe, o Invokta não tem
 * notificação de progresso e o adapter MCP nunca emite `sendNotification`. Modelar isso como
 * chamada síncrona seria apostar num timeout de host que não controlamos. `video-iniciar`
 * enfileira e volta em menos de um segundo; o acompanhamento é por `video-status`.
 */

export interface PedidoDeExecucao {
  readonly rota: Rota;
  readonly prompt?: string | undefined;
  readonly cenas?: readonly string[] | undefined;
  readonly ancora?: string | undefined;
  readonly aspecto: string;
}

export function dispararJobDeVideo(deps: Deps, job: Job, pedido: PedidoDeExecucao): void {
  const controller = new AbortController();
  job.controller = controller;

  void (async () => {
    try {
      const { arquivos } = await deps.video.gerar({
        rota: pedido.rota,
        prompt: pedido.prompt,
        cenas: pedido.cenas,
        ancora: pedido.ancora,
        aspecto: pedido.aspecto,
        dirDoJob: job.dir,
        signal: controller.signal,
        aoNascer: (pid) => {
          job.pid = pid;
        },
      });

      for (const arquivo of arquivos) await deps.jobs.adotarArtefato(job, arquivo);

      if (job.artefatos.length === 0) {
        job.estado = "falhou";
        job.falha = {
          classe: "indeterminada",
          creditoProvavelmenteGasto: true,
          oQueFazer:
            "o gflow terminou sem erro mas não deixou arquivo; rode `gflow data list videos` para conferir antes de regerar",
        };
        return;
      }

      job.estado = job.artefatos.length < job.total ? "parcial" : "concluido";
    } catch (erro) {
      if (job.estado === "cancelado") return;

      if (erro instanceof ErroDoGflow) {
        // Sequência parcial: alguns clipes saíram. Adota o que existe em vez de descartar
        // trabalho já pago.
        if (erro.parcial) {
          job.estado = "parcial";
          job.falha = erro.falha;
          return;
        }
        job.estado = "falhou";
        job.falha = erro.falha;
        return;
      }

      job.estado = "falhou";
      job.falha = {
        classe: "indeterminada",
        creditoProvavelmenteGasto: true,
        oQueFazer: `erro inesperado: ${erro instanceof Error ? erro.message : String(erro)}`,
      };
    } finally {
      job.pid = undefined;
      await deps.lock.liberar();
    }
  })();
}
