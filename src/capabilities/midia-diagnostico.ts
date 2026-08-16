import { access, constants, mkdir } from "node:fs/promises";
import { defineCapability } from "@invokta/core";
import { z } from "zod";

import { executar } from "../adapters/executar.js";
import type { Deps } from "../deps.js";

/**
 * Pré-flight gratuito. É a única capability chamável em laço e a única honesta sobre o estado real.
 *
 * A sessão do Flow é sondada de verdade: no gflow ≥0.56 o próprio `auth status` faz um probe HTTP
 * contra a API do Flow em vez de só conferir se o arquivo de cookie existe. Um health check que
 * responde "ok" olhando para um cookie expirado é pior que health check nenhum — foi exatamente
 * assim que uma sessão morta passou por boa neste projeto.
 */

const VERSAO_MINIMA = [0, 50, 0] as const;

function versaoSuportada(bruto: string): boolean {
  const achado = bruto.match(/(\d+)\.(\d+)\.(\d+)/);
  if (achado === null) return false;
  const [maior, menor, correcao] = achado.slice(1, 4).map(Number) as [number, number, number];
  if (maior !== VERSAO_MINIMA[0]) return maior > VERSAO_MINIMA[0];
  if (menor !== VERSAO_MINIMA[1]) return menor > VERSAO_MINIMA[1];
  return correcao >= VERSAO_MINIMA[2];
}

export function midiaDiagnostico(deps: Deps) {
  return defineCapability({
    title: "Diagnóstico de mídia",
    description:
      "Confere se a geração de imagem e vídeo está pronta para uso: versão do gflow, sessão do Google Flow, autenticação do Codex, lock do Chrome e diretório de trabalho. Gratuito e sem efeito colateral — chame antes da primeira geração da sessão.",
    input: z.object({}).strict(),
    output: z.object({
      pronto: z.boolean(),
      bloqueios: z.array(z.string()),
      gflowVersao: z.string(),
      versaoSuportada: z.boolean(),
      sessaoFlow: z.enum(["viva", "morta", "indeterminada"]),
      lockLivre: z.boolean(),
      codexAuthMode: z.enum(["chatgpt", "apikey", "ausente"]),
      avisos: z.array(z.string()),
    }),
    access: "public",
    timeoutMs: 120_000,
    annotations: {
      readOnly: true,
      destructive: false,
      idempotent: true,
      openWorld: true,
    },
    async run({ context }) {
      const bloqueios: string[] = [];
      const avisos: string[] = [];

      const versao = await executar(deps.config.gflowBin, ["--version"], { signal: context.signal })
        .then((r) => r.stdout.trim() || r.stderr.trim())
        .catch(() => "");
      const gflowVersao = versao || "ausente";
      const suportada = versao !== "" && versaoSuportada(versao);
      if (versao === "") {
        bloqueios.push(`gflow não encontrado em ${deps.config.gflowBin} (instale com \`uv tool install gflow-cli\`)`);
      } else if (!suportada) {
        bloqueios.push(
          `gflow ${gflowVersao} é antigo demais; atualize para ≥0.50.0 (\`uv tool upgrade gflow-cli\`) — versões anteriores não têm o lease de kernel que impede dois Chromes concorrentes`,
        );
      }

      let sessaoFlow: "viva" | "morta" | "indeterminada" = "indeterminada";
      if (versao !== "") {
        const status = await executar(
          deps.config.gflowBin,
          ["auth", "status", "--profile", deps.config.gflowProfile],
          { signal: context.signal },
        ).catch(() => null);
        const texto = `${status?.stdout ?? ""}\n${status?.stderr ?? ""}`;
        if (/session[_ ]?(is )?(alive|valid|ok)|Flow session looks good|signed in/i.test(texto)) {
          sessaoFlow = "viva";
        } else if (/AuthExpired|expired|401|re-login|auth login/i.test(texto)) {
          sessaoFlow = "morta";
        }
        if (sessaoFlow === "morta") {
          bloqueios.push(
            "sessão do Google Flow expirada; rode `gflow auth login` num terminal interativo (exige janela do Chrome e login na conta Google)",
          );
        } else if (sessaoFlow === "indeterminada") {
          avisos.push(
            "não foi possível confirmar a sessão do Flow; a primeira geração dirá a verdade — se falhar com exit 3, rode `gflow auth login`",
          );
        }
      }

      const lockLivre = await deps.lock.estaLivre();
      if (!lockLivre) {
        const dono = await deps.lock.lerDono();
        bloqueios.push(
          `o Chrome do gflow está ocupado pelo job ${dono?.jobId ?? "?"}; aguarde ou use video-cancelar`,
        );
      }

      const codexAuthMode = await (async (): Promise<"chatgpt" | "apikey" | "ausente"> => {
        const existe = await access(`${deps.config.codexHome}/auth.json`, constants.R_OK)
          .then(() => true)
          .catch(() => false);
        if (!existe) return "ausente";
        return process.env.OPENAI_API_KEY ? "apikey" : "chatgpt";
      })();
      if (codexAuthMode === "ausente") {
        avisos.push(
          "Codex CLI sem sessão; provider='codex' em imagem-gerar vai falhar. Rode `codex login`. provider='gflow' continua funcionando.",
        );
      } else if (codexAuthMode === "apikey") {
        avisos.push(
          "OPENAI_API_KEY presente no ambiente: a geração pelo Codex pode ser cobrada na API em vez da assinatura ChatGPT",
        );
      }

      const gravavel = await mkdir(deps.config.workdir, { recursive: true })
        .then(() => true)
        .catch(() => false);
      if (!gravavel) bloqueios.push(`diretório de trabalho não gravável: ${deps.config.workdir}`);

      if (!deps.config.permiteGastar) {
        avisos.push(
          "gasto bloqueado: video-iniciar vai recusar até FLOWKTA_ALLOW_SPEND=true estar no ambiente do servidor MCP. imagem-gerar não é afetado.",
        );
      }

      return {
        pronto: bloqueios.length === 0,
        bloqueios,
        gflowVersao,
        versaoSuportada: suportada,
        sessaoFlow,
        lockLivre,
        codexAuthMode,
        avisos,
      };
    },
  });
}
