import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

/**
 * Registro de jobs e custódia de artefatos.
 *
 * Regra central: o engine NUNCA devolve o caminho onde a ferramenta externa escreveu. Ele copia
 * para o diretório do job, calcula sha256, confere que o arquivo existe e não está vazio, e só
 * então devolve. Motivo: o diretório de saída do gflow varia por versão e o PNG do Codex nasce
 * obrigatoriamente em $CODEX_HOME/generated_images (a tool image_gen não aceita destino).
 */

export type EstadoDoJob = "rodando" | "concluido" | "parcial" | "falhou" | "cancelado";

export type ClasseDeFalha =
  | "moderacao"
  | "cota"
  | "sessao-expirada"
  | "ui-drift"
  | "indeterminada";

export interface Falha {
  readonly classe: ClasseDeFalha;
  /** Se true, o Flow pode ter aceitado e cobrado o job mesmo sem entregar arquivo. */
  readonly creditoProvavelmenteGasto: boolean;
  readonly oQueFazer: string;
}

export interface Artefato {
  readonly id: string;
  readonly caminho: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface Job {
  estado: EstadoDoJob;
  readonly id: string;
  readonly dir: string;
  readonly total: number;
  readonly iniciadoEm: number;
  artefatos: Artefato[];
  falha?: Falha | undefined;
  /** PID do processo externo em execução, para o cancelamento poder matá-lo. */
  pid?: number | undefined;
  /**
   * Cancelamento próprio do job. Não dá para usar o `context.signal` do Invokta: ele pertence à
   * chamada que apenas ENFILEIRA, e é abortado assim que ela retorna — o trabalho continua
   * depois disso.
   */
  controller?: AbortController;
}

/** Um PNG/MP4 vazio ou inexistente é falha, nunca sucesso com lista vazia. */
async function conferirArquivo(caminho: string): Promise<number> {
  const info = await stat(caminho).catch(() => null);
  if (info === null || !info.isFile()) throw new Error(`artefato ausente: ${caminho}`);
  if (info.size === 0) throw new Error(`artefato vazio: ${caminho}`);
  return info.size;
}

export class RegistroDeJobs {
  private readonly jobs = new Map<string, Job>();

  constructor(private readonly workdir: string) {}

  private dirDoDia(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async criar(total: number): Promise<Job> {
    const id = randomUUID();
    const dir = join(this.workdir, "jobs", this.dirDoDia(), id);
    await mkdir(dir, { recursive: true });
    const job: Job = { id, dir, total, estado: "rodando", iniciadoEm: Date.now(), artefatos: [] };
    this.jobs.set(id, job);
    return job;
  }

  obter(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /**
   * Copia um arquivo produzido por ferramenta externa para dentro do job e o registra.
   * Devolve o artefato com sha256 — o id é estável e serve de referência para outras chamadas.
   */
  async adotarArtefato(job: Job, origem: string): Promise<Artefato> {
    await conferirArquivo(origem);
    const indice = job.artefatos.length + 1;
    const nome = `${String(indice).padStart(3, "0")}${extname(origem) || extname(basename(origem))}`;
    const destino = join(job.dir, nome);
    await copyFile(origem, destino);
    const bytes = await conferirArquivo(destino);
    const sha256 = createHash("sha256").update(await readFile(destino)).digest("hex");
    const artefato: Artefato = { id: `${job.id}:${nome}`, caminho: destino, bytes, sha256 };
    job.artefatos.push(artefato);
    return artefato;
  }

  /** Resolve um id de artefato de volta para caminho em disco. Nunca aceitar path cru do modelo. */
  resolverArtefato(artefatoId: string): string | null {
    const [jobId] = artefatoId.split(":");
    const job = jobId ? this.jobs.get(jobId) : undefined;
    return job?.artefatos.find((a) => a.id === artefatoId)?.caminho ?? null;
  }

  /**
   * Conta clipes de vídeo produzidos na última hora, lendo o disco — sobrevive a restart do
   * processo MCP, que é justamente quando um contador em memória falharia como backstop.
   */
  async contarClipesNaUltimaHora(agora: number = Date.now()): Promise<number> {
    const raiz = join(this.workdir, "jobs");
    const corte = agora - 60 * 60 * 1000;
    let total = 0;
    const dias = await readdir(raiz).catch(() => [] as string[]);
    for (const dia of dias) {
      const jobsDoDia = await readdir(join(raiz, dia)).catch(() => [] as string[]);
      for (const jobId of jobsDoDia) {
        const arquivos = await readdir(join(raiz, dia, jobId)).catch(() => [] as string[]);
        for (const arquivo of arquivos) {
          if (!arquivo.endsWith(".mp4")) continue;
          const info = await stat(join(raiz, dia, jobId, arquivo)).catch(() => null);
          if (info && info.mtimeMs >= corte) total += 1;
        }
      }
    }
    return total;
  }
}
