import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Lock serial do Chrome.
 *
 * O gflow dirige um único profile de Chrome: dois processos simultâneos derrubam um ao outro
 * com ProfileLockedError. Este lock serializa os spawns DESTE engine.
 *
 * Limite declarado: não cobre um `gflow` que o usuário rode direto no terminal dele. O backstop
 * para esse caso é o lease de kernel do próprio gflow (≥0.41.0) — por isso o upgrade é
 * pré-requisito, não melhoria.
 */

export interface DonoDoLock {
  readonly pid: number;
  readonly jobId: string;
  readonly iniciadoEm: string;
}

export class LockOcupadoError extends Error {
  constructor(readonly dono: DonoDoLock) {
    super(`gflow já está em uso pelo job ${dono.jobId} (pid ${dono.pid}, desde ${dono.iniciadoEm})`);
    this.name = "LockOcupadoError";
  }
}

/**
 * Um PID vivo pode estar legitimamente dirigindo o Chrome há 3 minutos — por isso a decisão de
 * "lock morto" NUNCA usa timeout, só liveness do processo.
 */
function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (erro) {
    // EPERM = existe mas é de outro usuário; ainda está vivo.
    return (erro as NodeJS.ErrnoException).code === "EPERM";
  }
}

export class LockDoGflow {
  constructor(private readonly caminho: string) {}

  async lerDono(): Promise<DonoDoLock | null> {
    try {
      const bruto = await readFile(this.caminho, "utf8");
      const dono = JSON.parse(bruto) as DonoDoLock;
      if (typeof dono?.pid !== "number") return null;
      return dono;
    } catch {
      return null;
    }
  }

  /** Livre = sem arquivo, ou com arquivo cujo dono já morreu. */
  async estaLivre(): Promise<boolean> {
    const dono = await this.lerDono();
    return dono === null || !processoVivo(dono.pid);
  }

  async adquirir(jobId: string): Promise<void> {
    await mkdir(dirname(this.caminho), { recursive: true });
    const conteudo = JSON.stringify({
      pid: process.pid,
      jobId,
      iniciadoEm: new Date().toISOString(),
    } satisfies DonoDoLock);

    try {
      // 'wx' → O_EXCL: criação atômica em filesystem local.
      const arquivo = await open(this.caminho, "wx");
      await arquivo.writeFile(conteudo);
      await arquivo.close();
      return;
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code !== "EEXIST") throw erro;
    }

    const dono = await this.lerDono();
    if (dono !== null && processoVivo(dono.pid)) throw new LockOcupadoError(dono);

    // Lock órfão: o dono morreu sem liberar. Reap e tenta uma única vez.
    await unlink(this.caminho).catch(() => {});
    const arquivo = await open(this.caminho, "wx").catch(async () => {
      const atual = await this.lerDono();
      throw atual ? new LockOcupadoError(atual) : new Error("não foi possível adquirir o lock do gflow");
    });
    await arquivo.writeFile(conteudo);
    await arquivo.close();
  }

  async liberar(): Promise<void> {
    await unlink(this.caminho).catch(() => {});
  }
}
