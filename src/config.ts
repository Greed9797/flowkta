import { homedir } from "node:os";
import { z } from "zod";

/**
 * Ambiente validado no boot. Nada de credencial ou identidade entra por schema de capability:
 * quem controla o ambiente do processo controla o gasto, e isso é deliberado.
 */

/** Uma variável definida como string vazia é ausente, não "vazia". */
function semVazios(bruto: NodeJS.ProcessEnv): Record<string, string> {
  const limpo: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (typeof valor === "string" && valor.trim() !== "") limpo[chave] = valor;
  }
  return limpo;
}

const esquema = z.object({
  /** Onde os artefatos finais vivem. O engine copia tudo para cá antes de devolver caminho. */
  FLOWKTA_WORKDIR: z.string().default(`${homedir()}/.flowkta`),
  /** Onde fica o lock do Chrome. Separado do workdir para poder ficar em disco local. */
  FLOWKTA_STATE: z.string().optional(),
  /** Gate de gasto: sem isto em "true", nenhuma capability que queima crédito executa. */
  FLOWKTA_ALLOW_SPEND: z.string().optional(),
  /** Teto de clipes por hora. Backstop para agente em laço. */
  FLOWKTA_MAX_CLIPES_POR_HORA: z.coerce.number().int().positive().default(5),
  FLOWKTA_GFLOW_BIN: z.string().default(`${homedir()}/.local/bin/gflow`),
  FLOWKTA_CODEX_BIN: z.string().default("/opt/homebrew/bin/codex"),
  /**
   * why: sem `-m`, o `codex exec` herda o `model` do ~/.codex/config.toml global, que muda por
   * fora do engine. Em 2026-09 ele apontava para `gpt-6-sol` com o CLI 0.154 instalado, que ainda
   * não conhecia a família gpt-6: a conta recusava com 400 e toda geração falhava. Aqui o modelo
   * só orquestra a chamada da tool `image_gen` — o mais leve basta.
   */
  FLOWKTA_CODEX_MODEL: z.string().default("gpt-6-luna"),
  /**
   * Perfil do gflow. Quando ausente, respeitamos o perfil default que o próprio gflow tem
   * registrado — que é uma escolha deliberada do usuário (`gflow auth use <nome>`). Forçar a
   * string "default" aqui parecia mais explícito e estava errado: quem loga com um perfil
   * nomeado tem a sessão viva nele, e o engine ia bater num perfil morto que ninguém usa.
   */
  FLOWKTA_GFLOW_PROFILE: z.string().optional(),
  CODEX_HOME: z.string().default(`${homedir()}/.codex`),
});

export interface Config {
  readonly workdir: string;
  readonly stateDir: string;
  readonly permiteGastar: boolean;
  readonly maxClipesPorHora: number;
  readonly gflowBin: string;
  readonly codexBin: string;
  readonly codexModel: string;
  /** undefined = usar o perfil default registrado no gflow. */
  readonly gflowProfile: string | undefined;
  readonly codexHome: string;
}

export function lerConfig(bruto: NodeJS.ProcessEnv = process.env): Config {
  const env = esquema.parse(semVazios(bruto));
  const workdir = env.FLOWKTA_WORKDIR;
  return {
    workdir,
    stateDir: env.FLOWKTA_STATE ?? `${workdir}/state`,
    permiteGastar: env.FLOWKTA_ALLOW_SPEND === "true",
    maxClipesPorHora: env.FLOWKTA_MAX_CLIPES_POR_HORA,
    gflowBin: env.FLOWKTA_GFLOW_BIN,
    codexBin: env.FLOWKTA_CODEX_BIN,
    codexModel: env.FLOWKTA_CODEX_MODEL,
    gflowProfile: env.FLOWKTA_GFLOW_PROFILE ?? undefined,
    codexHome: env.CODEX_HOME,
  };
}
