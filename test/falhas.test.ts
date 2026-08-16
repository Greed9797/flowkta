import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { classificarFalhaGflow, ehFalha, ehParcial, parseSaidaGflow } from "../src/falhas.js";

/** Fixtures capturadas de execuções reais do gflow 0.58.0, não inventadas. */
function fixture(nome: string): string {
  return readFileSync(new URL(`./fixtures/${nome}`, import.meta.url), "utf8");
}

describe("classificação de falha do gflow", () => {
  it("reconhece sessão expirada e afirma que o crédito NÃO foi gasto", () => {
    const saida = parseSaidaGflow(fixture("gflow-auth-expirada.json"));
    expect(ehFalha(saida, 3)).toBe(true);
    const falha = classificarFalhaGflow(saida, 3);
    expect(falha.classe).toBe("sessao-expirada");
    expect(falha.creditoProvavelmenteGasto).toBe(false);
    expect(falha.oQueFazer).toMatch(/auth login/i);
  });

  it("trata erro genérico (exit 1) como indeterminado e assume que o crédito PODE ter sido gasto", () => {
    const saida = parseSaidaGflow(fixture("gflow-erro-inesperado.json"));
    const falha = classificarFalhaGflow(saida, 1);
    expect(falha.classe).toBe("indeterminada");
    // Conservador de propósito: mandar conferir antes de regerar é mais barato que pagar duas vezes.
    expect(falha.creditoProvavelmenteGasto).toBe(true);
    expect(falha.oQueFazer).toMatch(/data list videos/i);
  });

  it("classifica cota e ui-drift sem acusar gasto", () => {
    for (const [code, classe] of [
      [4, "cota"],
      [28, "ui-drift"],
    ] as const) {
      const falha = classificarFalhaGflow({ status: "fail", error: { exit_code: code } }, code);
      expect(falha.classe).toBe(classe);
      expect(falha.creditoProvavelmenteGasto).toBe(false);
    }
  });

  it("profile ocupado não é gasto: falha antes de submeter, repetir é seguro", () => {
    // Aconteceu de verdade: o Chrome de um `gflow auth login` ficou aberto segurando o lease.
    const falha = classificarFalhaGflow(
      {
        status: "fail",
        error: {
          class: "UnexpectedError",
          exit_code: 1,
          remediation_hint: "A live process still holds this profile — commonly a prior gflow command",
        },
      },
      1,
    );
    expect(falha.creditoProvavelmenteGasto).toBe(false);
    expect(falha.oQueFazer).toMatch(/profile|pkill/i);
  });

  it("classifica moderação como gasto consumado e desencoraja repetir igual", () => {
    const falha = classificarFalhaGflow(
      { status: "fail", error: { class: "ModerationError", exit_code: 1 } },
      1,
    );
    expect(falha.classe).toBe("moderacao");
    expect(falha.creditoProvavelmenteGasto).toBe(true);
    expect(falha.oQueFazer).toMatch(/NÃO repita/i);
  });

  it("reconhece sequência parcial, que não deve descartar clipes já pagos", () => {
    expect(ehParcial({ status: "fail", error: { class: "ChainPartialError" } }, 21)).toBe(true);
    expect(ehParcial(null, 21)).toBe(true);
    expect(ehParcial(null, 0)).toBe(false);
  });

  it("não confunde sucesso com falha", () => {
    expect(ehFalha(parseSaidaGflow('{"status":"ok"}'), 0)).toBe(false);
    expect(ehFalha(null, 0)).toBe(false);
  });

  it("sobrevive a stdout que não é JSON", () => {
    expect(parseSaidaGflow("tabela Rich bonita aqui")).toBeNull();
    expect(parseSaidaGflow("{quebrado")).toBeNull();
  });
});
