import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Config } from "../config.js";
import { classificarFalhaGflow, ehFalha, ehParcial, parseSaidaGflow } from "../falhas.js";
import type {
  GeradorDeImagem,
  GeradorDeVideo,
  PedidoDeImagem,
  PedidoDeVideo,
  ResultadoDeGeracao,
} from "../ports/midia.js";
import { executar } from "./executar.js";

/**
 * Adapter do gflow-cli (Google Flow via automação de browser).
 *
 * Decisão que evita depender de fixture de sucesso: cada job recebe um diretório de saída
 * EXCLUSIVO e vazio, e a descoberta dos arquivos é feita listando esse diretório. O `--json`
 * é usado para detectar e CLASSIFICAR falha, não para localizar arquivo — assim o adapter não
 * quebra quando o gflow muda o shape do payload de sucesso entre minors.
 *
 * Cuidado de flags: `image` usa `--out DIRECTORY`, `video` usa `--out-dir DIRECTORY`. Não são
 * intercambiáveis.
 */

export class ErroDoGflow extends Error {
  constructor(
    message: string,
    readonly falha: ReturnType<typeof classificarFalhaGflow>,
    readonly parcial: boolean,
  ) {
    super(message);
    this.name = "ErroDoGflow";
  }
}

const EXTENSOES_DE_IMAGEM = new Set([".png", ".jpg", ".jpeg", ".webp"]);

async function listarProduzidos(dir: string, extensoes: ReadonlySet<string>): Promise<string[]> {
  const entradas = await readdir(dir).catch(() => [] as string[]);
  return entradas
    .filter((nome) => extensoes.has(nome.slice(nome.lastIndexOf(".")).toLowerCase()))
    .sort()
    .map((nome) => join(dir, nome));
}

function ambiente(config: Config, dirDoJob: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    // Sempre explícito: nunca depender do default implícito da CLI, que já mudou entre versões.
    GFLOW_CLI_PROFILE: config.gflowProfile,
    GFLOW_CLI_OUTPUT_DIR: dirDoJob,
  };
}

export class GflowAdapter implements GeradorDeImagem, GeradorDeVideo {
  constructor(private readonly config: Config) {}

  async gerar(pedido: PedidoDeImagem | PedidoDeVideo): Promise<ResultadoDeGeracao> {
    return "rota" in pedido ? await this.gerarVideo(pedido) : await this.gerarImagem(pedido);
  }

  private async gerarImagem(pedido: PedidoDeImagem): Promise<ResultadoDeGeracao> {
    const saidaDeImagens = join(pedido.dirDoJob, "gflow");
    const subcomando = pedido.referencias.length > 0 ? "i2i" : "t2i";
    const argv = [
      "image",
      subcomando,
      pedido.prompt,
      "--model",
      pedido.modelo ?? "nano2",
      "--aspect",
      pedido.aspecto,
      "-n",
      String(pedido.quantidade),
      "--out",
      saidaDeImagens,
      "--profile",
      this.config.gflowProfile,
      "--json",
    ];
    for (const ref of pedido.referencias) argv.push("--ref", ref);

    await this.rodar(argv, pedido.dirDoJob, pedido.signal);
    return { arquivos: await listarProduzidos(saidaDeImagens, EXTENSOES_DE_IMAGEM) };
  }

  private async gerarVideo(pedido: PedidoDeVideo): Promise<ResultadoDeGeracao> {
    const saidaDeVideos = join(pedido.dirDoJob, "gflow");
    const { rota } = pedido;
    const argv: string[] = ["video", rota.subcomando];

    if (rota.subcomando === "chain") {
      // `chain` consome um manifesto, não uma lista de prompts em argv.
      const manifesto = join(pedido.dirDoJob, "chain.jsonl");
      const linhas = (pedido.cenas ?? []).map((cena) => JSON.stringify({ prompt: cena }));
      await writeFile(manifesto, `${linhas.join("\n")}\n`, "utf8");
      argv.push(manifesto, "--max-links", String(linhas.length), "-y");
    } else if (rota.subcomando === "i2v") {
      argv.push("--initial-frame", pedido.ancora ?? "", pedido.prompt ?? "");
    } else {
      argv.push(pedido.prompt ?? "");
      if (rota.subcomando === "r2v" && pedido.ancora !== undefined) argv.push("--ref", pedido.ancora);
    }

    argv.push("--model", rota.modelo, "--aspect", pedido.aspecto);
    // Só omni-flash renderiza a linha de duração no Flow; mandar --duration nos Veo 3.1 é erro.
    if (rota.modelo === "omni-flash") argv.push("--duration", String(rota.duracaoSegundos));
    argv.push("--out-dir", saidaDeVideos, "--profile", this.config.gflowProfile, "--json");

    await this.rodar(argv, pedido.dirDoJob, pedido.signal, pedido.aoNascer);
    return { arquivos: await listarProduzidos(saidaDeVideos, new Set([".mp4"])) };
  }

  private async rodar(
    argv: readonly string[],
    dirDoJob: string,
    signal: AbortSignal,
    aoNascer?: (pid: number) => void,
  ): Promise<void> {
    const resultado = await executar(this.config.gflowBin, argv, {
      cwd: dirDoJob,
      env: ambiente(this.config, dirDoJob),
      signal,
      aoNascer,
    });

    const saida = parseSaidaGflow(resultado.stdout);
    if (!ehFalha(saida, resultado.code)) return;

    const parcial = ehParcial(saida, resultado.code);
    const falha = classificarFalhaGflow(saida, resultado.code);
    throw new ErroDoGflow(
      `gflow ${argv[0]} ${argv[1]} falhou (exit ${resultado.code}): ${falha.classe}`,
      falha,
      parcial,
    );
  }
}
