/**
 * Roteador de domínio: traduz o RESULTADO pedido no subcomando e modelo corretos do gflow.
 *
 * É a única peça que justifica este engine existir ao lado de `gflow mcp run`: sem ela, o agente
 * escolheria `--model` e `--duration` sozinho e cairia em todas as armadilhas abaixo.
 *
 * Função pura, zero I/O — testável por tabela exaustiva em milissegundos.
 */

export type ModoDeGeracao = "clipe" | "sequencia";
export type SubcomandoGflow = "t2v" | "i2v" | "r2v" | "chain";
export type ModeloDeVideo = "omni-flash" | "veo-lite";
export type DuracaoSegundos = 4 | 6 | 8 | 10;
export type Aspecto = "16:9" | "9:16";

export interface PedidoDeRota {
  readonly modo: ModoDeGeracao;
  readonly temAncora: boolean;
  readonly duracaoSegundos: DuracaoSegundos;
}

export interface Rota {
  readonly subcomando: SubcomandoGflow;
  readonly modelo: ModeloDeVideo;
  readonly duracaoSegundos: DuracaoSegundos;
  /** Quantas imagens de referência este par (subcomando, modelo) aceita. 0 = não aceita. */
  readonly limiteDeReferencias: number;
  /** Por que esta rota foi escolhida — vai no output para o agente entender a decisão. */
  readonly motivo: string;
}

export class RotaImpossivelError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "RotaImpossivelError";
  }
}

/** Só omni-flash renderiza a linha 4s/6s/8s/10s no popover de settings do Flow. */
const DURACAO_EXIGE_OMNI_FLASH: DuracaoSegundos = 10;

/** Cap de `--ref` por modelo, imposto pelo próprio gflow. */
const LIMITE_DE_REFERENCIAS: Record<ModeloDeVideo, number> = {
  "omni-flash": 7,
  "veo-lite": 3,
};

export function escolherRota(pedido: PedidoDeRota): Rota {
  const { modo, temAncora, duracaoSegundos } = pedido;

  if (modo === "sequencia") {
    // `gflow video chain` recusa omni-flash por contrato do CLI, e sem omni-flash não há
    // controle de duração — então 10s é impossível numa sequência. Recusamos aqui, de graça,
    // em vez de descobrir depois de o Flow já ter aceitado o job e cobrado.
    if (duracaoSegundos === DURACAO_EXIGE_OMNI_FLASH) {
      throw new RotaImpossivelError(
        "sequência não suporta 10s: `gflow video chain` proíbe omni-flash, e só omni-flash expõe --duration. Use 8s ou gere clipes avulsos.",
      );
    }
    return {
      subcomando: "chain",
      modelo: "veo-lite",
      duracaoSegundos,
      limiteDeReferencias: LIMITE_DE_REFERENCIAS["veo-lite"],
      motivo: "sequência encadeada usa `video chain`, que só aceita os modelos Veo 3.1",
    };
  }

  if (duracaoSegundos === DURACAO_EXIGE_OMNI_FLASH) {
    if (temAncora) {
      // Armadilha central: com omni-flash, `i2v` faz o Flow dropar o initial frame e cair
      // para t2v SEM AVISAR — o crédito é gasto e o vídeo ignora a imagem. `r2v --ref` é a
      // única forma de ancorar em imagem mantendo 10s.
      return {
        subcomando: "r2v",
        modelo: "omni-flash",
        duracaoSegundos,
        limiteDeReferencias: LIMITE_DE_REFERENCIAS["omni-flash"],
        motivo:
          "10s exige omni-flash, e omni-flash em i2v descarta o frame inicial silenciosamente; r2v --ref preserva a âncora",
      };
    }
    return {
      subcomando: "t2v",
      modelo: "omni-flash",
      duracaoSegundos,
      limiteDeReferencias: 0,
      motivo: "10s só existe no omni-flash; sem âncora, t2v direto",
    };
  }

  if (temAncora) {
    return {
      subcomando: "i2v",
      modelo: "veo-lite",
      duracaoSegundos,
      limiteDeReferencias: LIMITE_DE_REFERENCIAS["veo-lite"],
      motivo: "âncora com duração ≤8s roda em Veo 3.1 via i2v --initial-frame",
    };
  }

  return {
    subcomando: "t2v",
    modelo: "veo-lite",
    duracaoSegundos,
    limiteDeReferencias: 0,
    motivo: "clipe sem âncora até 8s roda em Veo 3.1 via t2v",
  };
}
