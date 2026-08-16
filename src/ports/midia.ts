import type { Rota } from "../rota.js";

/**
 * Portas de geração.
 *
 * Ponytail normalmente proíbe interface com uma implementação. Aqui ela se paga: a implementação
 * real custa dinheiro e 90 segundos, então a porta é o seam que faz a suíte inteira rodar contra
 * objetos literais, sem queimar um crédito sequer.
 */

export interface PedidoDeImagem {
  readonly prompt: string;
  readonly modelo?: string | undefined;
  readonly aspecto: string;
  readonly quantidade: number;
  /** Caminhos absolutos já resolvidos pelo registro de jobs — nunca path vindo do modelo. */
  readonly referencias: readonly string[];
  readonly dirDoJob: string;
  readonly signal: AbortSignal;
}

export interface PedidoDeVideo {
  readonly rota: Rota;
  readonly prompt?: string | undefined;
  readonly cenas?: readonly string[] | undefined;
  readonly ancora?: string | undefined;
  readonly aspecto: string;
  readonly dirDoJob: string;
  readonly signal: AbortSignal;
  /** Chamado assim que o processo externo nasce, para o cancelamento saber quem matar. */
  readonly aoNascer?: ((pid: number) => void) | undefined;
}

export interface ResultadoDeGeracao {
  /** Caminhos absolutos dos arquivos produzidos, ainda no diretório da ferramenta. */
  readonly arquivos: readonly string[];
}

export interface GeradorDeImagem {
  gerar(pedido: PedidoDeImagem): Promise<ResultadoDeGeracao>;
}

export interface GeradorDeVideo {
  gerar(pedido: PedidoDeVideo): Promise<ResultadoDeGeracao>;
}
