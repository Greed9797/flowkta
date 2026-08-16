#!/usr/bin/env node
// Smoke manual contra o engine buildado, escrevendo o resultado num arquivo.
//
// Escreve em arquivo em vez de stdout de propósito: em harnesses com hooks de pós-processamento
// de saída (distill, RTK), o stdout pode ser reescrito antes de você lê-lo — e aí você depura
// uma alucinação do hook em vez do seu código.
//
//   node scripts/invocar.mjs <capabilityId> '<json>' <arquivo-de-saida>
import { writeFileSync } from "node:fs";

import { engine } from "../dist/engine.js";

const [id, entradaBruta = "{}", saida = "resultado.json"] = process.argv.slice(2);
if (!id) {
  writeFileSync(saida, JSON.stringify({ erro: "uso: invocar.mjs <capabilityId> <json> <saida>" }));
  process.exit(2);
}

try {
  const resultado = await engine.invoke(id, JSON.parse(entradaBruta), { principal: null });
  writeFileSync(saida, JSON.stringify({ ok: true, resultado }, null, 2));
} catch (erro) {
  writeFileSync(
    saida,
    JSON.stringify(
      { ok: false, code: erro?.code ?? null, message: erro?.message ?? String(erro) },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
