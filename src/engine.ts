import { createEngine } from "@invokta/core";

import { CodexAdapter } from "./adapters/codex-cli.js";
import { GflowAdapter } from "./adapters/gflow-cli.js";
import { imagemGerar } from "./capabilities/imagem-gerar.js";
import { midiaDiagnostico } from "./capabilities/midia-diagnostico.js";
import { videoCancelar } from "./capabilities/video-cancelar.js";
import { videoIniciar } from "./capabilities/video-iniciar.js";
import { videoStatus } from "./capabilities/video-status.js";
import { type Config, lerConfig } from "./config.js";
import type { Deps } from "./deps.js";
import { RegistroDeJobs } from "./jobs.js";
import { LockDoGflow } from "./lock.js";

/**
 * Raiz de composição.
 *
 * Ids sem ponto: o adapter MCP troca caracteres fora de [a-zA-Z0-9_-] por underscore, então um id
 * com ponto apareceria diferente na CLI e no MCP. Hífen sobrevive idêntico nos dois canais.
 */
export function criarFlowktaEngine(deps: Deps) {
  return createEngine({
    name: "flowkta",
    version: "0.1.0",
    capabilities: {
      "midia-diagnostico": midiaDiagnostico(deps),
      "imagem-gerar": imagemGerar(deps),
      "video-iniciar": videoIniciar(deps),
      "video-status": videoStatus(deps),
      "video-cancelar": videoCancelar(deps),
    },
  });
}

export function montarDeps(config: Config = lerConfig()): Deps {
  const gflow = new GflowAdapter(config);
  return {
    config,
    jobs: new RegistroDeJobs(config.workdir),
    lock: new LockDoGflow(`${config.stateDir}/gflow.lock`),
    imagemGflow: gflow,
    imagemCodex: new CodexAdapter(config),
    video: gflow,
  };
}

export const engine = criarFlowktaEngine(montarDeps());
