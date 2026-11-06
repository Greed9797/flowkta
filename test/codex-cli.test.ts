import { describe, expect, it } from "vitest";

import { erroDoStream } from "../src/adapters/codex-cli.js";

// why: trecho real do stdout `--json` do codex-cli 0.154.0 com modelo recusado pela conta ChatGPT.
const STREAM_MODELO_RECUSADO = [
  '{"type":"thread.started","thread_id":"01a0cf99-6c7f-7762-851b-eca4b504aac8"}',
  '{"type":"item.completed","item":{"id":"item_1","type":"error","message":"Model metadata for `gpt-6-sol` not found."}}',
  '{"type":"turn.started"}',
  '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"message\\":\\"The \'gpt-6-sol\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
  '{"type":"turn.failed","error":{"message":"The \'gpt-6-sol\' model is not supported when using Codex with a ChatGPT account."}}',
].join("\n");

describe("erroDoStream", () => {
  it("devolve a mensagem do turn.failed quando o turno falha", () => {
    expect(erroDoStream(STREAM_MODELO_RECUSADO)).toBe(
      "The 'gpt-6-sol' model is not supported when using Codex with a ChatGPT account.",
    );
  });

  it("ignora avisos item.completed e devolve undefined quando o turno completa", () => {
    const stream = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Skill descriptions were shortened"}}',
      '{"type":"turn.completed","usage":{}}',
    ].join("\n");
    expect(erroDoStream(stream)).toBeUndefined();
  });

  it("pula linha truncada e usa o evento de erro anterior", () => {
    const stream = '{"type":"error","message":"cota esgotada"}\n{"type":"turn.failed","error":{"mess\n…(truncado)';
    expect(erroDoStream(stream)).toBe("cota esgotada");
  });
});
