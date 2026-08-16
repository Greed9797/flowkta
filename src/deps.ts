import type { Config } from "./config.js";
import type { RegistroDeJobs } from "./jobs.js";
import type { LockDoGflow } from "./lock.js";
import type { GeradorDeImagem, GeradorDeVideo } from "./ports/midia.js";

/** Dependências injetadas na raiz de composição. Nenhuma capability lê o ambiente sozinha. */
export interface Deps {
  readonly config: Config;
  readonly jobs: RegistroDeJobs;
  readonly lock: LockDoGflow;
  readonly imagemGflow: GeradorDeImagem;
  readonly imagemCodex: GeradorDeImagem;
  readonly video: GeradorDeVideo;
}
