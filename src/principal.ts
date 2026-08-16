import type { Config } from "./config.js";
import type { RegistroDeJobs } from "./jobs.js";

/**
 * Gate de gasto.
 *
 * Deliberadamente NÃO existe campo `confirmarGasto` no schema de nenhuma capability: quem
 * preencheria esse booleano seria o próprio modelo, o que é autorização no lugar errado. A
 * permissão vem do ambiente do processo — de quem instalou o MCP —, nunca da entrada.
 *
 * Duas condições, ambas obrigatórias:
 *   1. FLOWKTA_ALLOW_SPEND === "true"
 *   2. clipes gerados na última hora < FLOWKTA_MAX_CLIPES_POR_HORA
 *
 * A segunda é o backstop contra agente em laço: a description desencoraja, a ausência de
 * `idempotent` desencoraja, e este contador impede.
 */
export async function gastoPermitido(config: Config, jobs: RegistroDeJobs): Promise<boolean> {
  if (!config.permiteGastar) return false;
  const recentes = await jobs.contarClipesNaUltimaHora();
  return recentes < config.maxClipesPorHora;
}

/** Motivo legível da recusa, para a mensagem de erro não ser um "FORBIDDEN" mudo. */
export async function motivoDaRecusa(config: Config, jobs: RegistroDeJobs): Promise<string> {
  if (!config.permiteGastar) {
    return "gasto bloqueado: defina FLOWKTA_ALLOW_SPEND=true no ambiente do servidor MCP para autorizar geração de vídeo (cada clipe consome crédito real da conta Google AI Ultra)";
  }
  const recentes = await jobs.contarClipesNaUltimaHora();
  return `teto horário atingido: ${recentes} clipes na última hora, limite ${config.maxClipesPorHora} (FLOWKTA_MAX_CLIPES_POR_HORA)`;
}
