#!/usr/bin/env node
// Chama uma capability do flowkta e escreve o resultado num arquivo.
//
//   node invocar.mjs <capabilityId> '<json>' <arquivo-de-saida>
//
// Escreve em arquivo em vez de stdout de propósito: em harnesses com hooks de pós-processamento
// de saída (distill, RTK), o stdout de `node ...` pode ser reescrito antes de você lê-lo — e aí
// você depura uma alucinação do hook em vez do seu código.
//
// Requer o engine buildado (`npm run check` no repo do flowkta).
import { writeFileSync } from "node:fs";

// A skill mora em <repo>/skill, então o engine buildado fica dois níveis acima deste script.
const ENGINE = process.env.FLOWKTA_ENGINE ?? new URL("../../dist/engine.js", import.meta.url).href;
const { engine } = await import(ENGINE);

const [id, entradaBruta = "{}", saida = "resultado.json"] = process.argv.slice(2);
if (!id) {
  console.error("uso: invocar.mjs <capabilityId> '<json>' <arquivo-de-saida>");
  process.exit(2);
}

try {
  const resultado = await engine.invoke(id, JSON.parse(entradaBruta), { principal: null });
  writeFileSync(saida, JSON.stringify({ ok: true, resultado }, null, 2));
} catch (erro) {
  writeFileSync(
    saida,
    JSON.stringify({ ok: false, code: erro?.code ?? null, message: erro?.message ?? String(erro) }, null, 2),
  );
  process.exitCode = 1;
}
