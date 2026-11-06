/**
 * Motor de scroll-scrub por frames — copie para o projeto e importe.
 *
 * Por que frames e não `<video currentTime>`: seek em vídeo comprimido precisa decodificar até o
 * keyframe anterior a cada mexida do scroll, e engasga em qualquer roda de mouse. Frames já
 * decodificados para ImageBitmap desenham em tempo constante.
 *
 * Quatro regras que mantêm isso liso, todas medidas:
 *   - um único rAF desenha; o scroll só anota a posição
 *   - decodifica fora da main thread (createImageBitmap) e nunca redecodifica
 *   - o primeiro frame é prioridade; o resto entra em fila com concorrência limitada
 *   - nunca espera: desenha o frame mais próximo já carregado
 *
 * Uso mínimo:
 *
 *   import { montarScrub } from "./scrub.js";
 *   const scrub = await montarScrub({
 *     canvas: document.getElementById("scrub"),
 *     manifesto: "frames/manifest.json",
 *     poster: "hero.jpg",              // opcional: usado quando não há frames
 *     aoProgredir: (p) => { ... },     // opcional: barra, contador, o que for
 *   });
 *   // Com GSAP:  ScrollTrigger.create({ ..., scrub: true, onUpdate: s => scrub.definir(s.progress) })
 *   // Sem GSAP:  addEventListener("scroll", () => scrub.definir(medirProgresso()), { passive: true })
 *
 * Retorna { definir(progresso0a1), temFrames, total, redimensionar() }.
 * Quando `temFrames` é false o pôster assume: a página tem que continuar inteira sem a sequência.
 */

const CONCORRENCIA = 6;

export async function montarScrub({ canvas, manifesto = "frames/manifest.json", poster, aoProgredir }) {
  const ctx = canvas?.getContext("2d", { alpha: false });
  const quadros = [];
  let total = 0;
  let ultimoDesenhado = -1;
  let progresso = 0;
  let precisaDesenhar = true;

  function redimensionar() {
    if (!canvas) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const l = canvas.clientWidth;
    const a = canvas.clientHeight;
    if (l === 0 || a === 0) return;
    canvas.width = Math.round(l * dpr);
    canvas.height = Math.round(a * dpr);
    precisaDesenhar = true;
    ultimoDesenhado = -1;
  }

  /** object-fit: cover na mão — canvas não tem. */
  function desenhar(bitmap) {
    if (!ctx || !canvas) return;
    const cw = canvas.width;
    const ch = canvas.height;
    const escala = Math.max(cw / bitmap.width, ch / bitmap.height);
    const l = bitmap.width * escala;
    const a = bitmap.height * escala;
    ctx.drawImage(bitmap, (cw - l) / 2, (ch - a) / 2, l, a);
  }

  async function carregarBitmap(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url);
    return await createImageBitmap(await r.blob());
  }

  async function carregarFrames() {
    let dados;
    try {
      const r = await fetch(manifesto, { cache: "no-cache" });
      if (!r.ok) throw new Error("sem manifesto");
      dados = await r.json();
    } catch {
      return false;
    }

    const arquivos = dados?.frames ?? [];
    if (arquivos.length === 0) return false;
    total = arquivos.length;

    const base = manifesto.replace(/[^/]+$/, "");
    try {
      quadros[0] = await carregarBitmap(base + arquivos[0]);
      precisaDesenhar = true;
    } catch {
      return false;
    }

    let proximo = 1;
    const trabalhador = async () => {
      while (proximo < arquivos.length) {
        const i = proximo++;
        try {
          quadros[i] = await carregarBitmap(base + arquivos[i]);
        } catch {
          /* um frame faltando não derruba a sequência: o anterior continua valendo */
        }
      }
    };
    void Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));
    return true;
  }

  function frameDisponivel(alvo) {
    if (quadros[alvo]) return quadros[alvo];
    for (let d = 1; d < total; d++) {
      if (quadros[alvo - d]) return quadros[alvo - d];
      if (quadros[alvo + d]) return quadros[alvo + d];
    }
    return null;
  }

  function laco() {
    if (precisaDesenhar) {
      precisaDesenhar = false;
      if (total > 0) {
        const alvo = Math.min(total - 1, Math.round(progresso * (total - 1)));
        if (alvo !== ultimoDesenhado) {
          const bitmap = frameDisponivel(alvo);
          if (bitmap) {
            desenhar(bitmap);
            ultimoDesenhado = alvo;
          }
        }
      }
      aoProgredir?.(progresso);
    }
    requestAnimationFrame(laco);
  }

  redimensionar();
  addEventListener("resize", redimensionar);

  const temFrames = await carregarFrames();
  if (!temFrames && poster) {
    const img = new Image();
    img.onload = () => {
      redimensionar();
      createImageBitmap(img).then((b) => {
        quadros[0] = b;
        total = 1;
        precisaDesenhar = true;
      });
    };
    img.src = poster;
  }

  requestAnimationFrame(laco);

  return {
    temFrames,
    get total() {
      return total;
    },
    redimensionar,
    definir(p) {
      progresso = Math.min(1, Math.max(0, p));
      precisaDesenhar = true;
    },
  };
}
