import type { ClasseDeFalha, Falha } from "./jobs.js";

/**
 * Traduz a saída `--json` do gflow numa falha acionável.
 *
 * A pergunta que importa não é "deu erro?", é "o crédito foi gasto?". Uma falha de moderação
 * acontece DEPOIS de o Flow aceitar o job: o arquivo não vem, o crédito vai. Já uma sessão
 * expirada falha antes de qualquer submissão. Confundir as duas faz o agente regerar e pagar
 * duas vezes — por isso `creditoProvavelmenteGasto` é campo de primeira classe.
 */

export interface SaidaDeErroGflow {
  readonly status?: string;
  readonly error?: {
    readonly class?: string;
    readonly exit_code?: number;
    readonly retryable?: boolean;
    readonly remediation_hint?: string;
    readonly title?: string;
    readonly route?: string;
  };
}

export function parseSaidaGflow(stdout: string): SaidaDeErroGflow | null {
  const texto = stdout.trim();
  if (!texto.startsWith("{")) return null;
  try {
    return JSON.parse(texto) as SaidaDeErroGflow;
  } catch {
    return null;
  }
}

export function ehFalha(saida: SaidaDeErroGflow | null, code: number | null): boolean {
  if (saida?.status === "fail") return true;
  return code !== 0;
}

/**
 * Exit 21 (ChainPartialError) não é falha total: alguns clipes da sequência saíram.
 * Quem chama trata como estado 'parcial' e devolve o que existe.
 */
export function ehParcial(saida: SaidaDeErroGflow | null, code: number | null): boolean {
  return saida?.error?.class === "ChainPartialError" || code === 21;
}

export function classificarFalhaGflow(saida: SaidaDeErroGflow | null, code: number | null): Falha {
  const classe = saida?.error?.class ?? "";
  const exit = saida?.error?.exit_code ?? code;
  const dica = saida?.error?.remediation_hint;

  const montar = (
    classeDeFalha: ClasseDeFalha,
    creditoProvavelmenteGasto: boolean,
    oQueFazer: string,
  ): Falha => ({ classe: classeDeFalha, creditoProvavelmenteGasto, oQueFazer: dica ?? oQueFazer });

  if (classe === "AuthExpiredError" || exit === 3) {
    return montar(
      "sessao-expirada",
      false,
      "sessão do Google Flow expirada; rode `gflow auth login` num terminal interativo e tente de novo",
    );
  }

  if (classe === "RateLimitError" || exit === 4) {
    return montar("cota", false, "cota do Google AI Ultra atingida; aguarde a janela e tente de novo");
  }

  // Exit 28: a UI do Flow que o gflow precisa não foi alcançada. Ele aborta ANTES de submeter,
  // exatamente para não queimar crédito quando o Flow muda de layout.
  if (exit === 28) {
    return montar(
      "ui-drift",
      false,
      "o gflow não alcançou a UI esperada do Flow (possível mudança de layout); tente de novo e, se persistir, atualize o gflow-cli",
    );
  }

  if (/moderation|blocked|MEDIA_GENERATION_STATUS_FAILED/i.test(`${classe} ${saida?.error?.title ?? ""}`)) {
    return montar(
      "moderacao",
      true,
      "o Flow bloqueou o conteúdo (crianças realistas e marcas registradas são recusadas); reescreva o prompt — NÃO repita igual, o crédito já foi consumido",
    );
  }

  // Exit 1 é o balde genérico do gflow e NÃO é retryable: pode ter falhado depois da submissão.
  return montar(
    "indeterminada",
    true,
    "falha indeterminada; rode `gflow data list videos` para conferir se o clipe existe ANTES de regerar — o crédito pode já ter sido consumido",
  );
}
