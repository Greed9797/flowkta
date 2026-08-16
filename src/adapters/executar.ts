import { spawn } from "node:child_process";

/**
 * Spawn com `shell: false` SEMPRE.
 *
 * Não é preferência de estilo: sob `shell: true`, um caminho contendo `&` (o repo do CreativeOS
 * mora em `~/V&OB/...`) faz o shell backgroundar o comando e interpretar o resto como outro
 * comando. Prompts também vão como elemento de argv, nunca interpolados.
 */

export interface ResultadoDoProcesso {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface OpcoesDeExecucao {
  readonly cwd?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly signal: AbortSignal;
  readonly aoNascer?: ((pid: number) => void) | undefined;
  /** Limite de bytes retidos de stdout. Protege contra payload gordo (base64 de imagem). */
  readonly maxStdoutBytes?: number;
}

const MAX_STDOUT_PADRAO = 256 * 1024;

export async function executar(
  binario: string,
  argv: readonly string[],
  opcoes: OpcoesDeExecucao,
): Promise<ResultadoDoProcesso> {
  const limite = opcoes.maxStdoutBytes ?? MAX_STDOUT_PADRAO;

  return await new Promise<ResultadoDoProcesso>((resolver, rejeitar) => {
    const filho = spawn(binario, [...argv], {
      shell: false,
      cwd: opcoes.cwd,
      env: opcoes.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (filho.pid !== undefined) opcoes.aoNascer?.(filho.pid);

    let stdout = "";
    let stderr = "";
    let truncado = false;

    filho.stdout.on("data", (pedaco: Buffer) => {
      if (stdout.length >= limite) {
        truncado = true;
        return;
      }
      stdout += pedaco.toString("utf8");
    });
    filho.stderr.on("data", (pedaco: Buffer) => {
      // stderr é diagnóstico: fica com os últimos KB, nunca cresce sem limite.
      stderr = (stderr + pedaco.toString("utf8")).slice(-16 * 1024);
    });

    const aoAbortar = (): void => {
      filho.kill("SIGTERM");
      setTimeout(() => filho.kill("SIGKILL"), 5000).unref();
    };
    opcoes.signal.addEventListener("abort", aoAbortar, { once: true });

    filho.on("error", (erro) => {
      opcoes.signal.removeEventListener("abort", aoAbortar);
      rejeitar(erro);
    });

    filho.on("close", (code) => {
      opcoes.signal.removeEventListener("abort", aoAbortar);
      resolver({ code, stdout: truncado ? `${stdout}\n…(truncado)` : stdout, stderr });
    });
  });
}
