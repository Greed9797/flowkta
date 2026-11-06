# Receitas validadas

Fluxos rodados de ponta a ponta, com os números reais. Copie a ordem, não improvise.

---

## 1. Hero com vídeo dirigido pelo scroll

O pedido mais comum: "um vídeo no topo que avança conforme eu rolo, sem travar".

### Ordem

O mp4 vem do usuário: o flowkta não gera vídeo (o único caminho era o gflow, vetado em
2026-09-25). Nunca chame `video-iniciar` nem rode `gflow`.

```bash
# Cortar. 10s a 12fps = 120 frames, 4–5 MB.
~/.claude/skills/flowkta/scripts/fazer-frames.sh <video.mp4> <site>/frames 12 1280
```

Precisa de pôster ou imagens de apoio? Gere pelo Codex (`imagem-gerar` com `provider: "codex"`),
como na receita 2.

### No front

Copie `references/scrub.js`. A pista de scroll é a altura do `<header>`; o `<canvas>` fica `sticky`
dentro dela. Com GSAP:

```js
const scrub = await montarScrub({ canvas, manifesto: "frames/manifest.json", poster: "hero.jpg" });
ScrollTrigger.create({
  trigger: hero, start: "top top", end: "bottom bottom", scrub: true,
  onUpdate: (s) => scrub.definir(s.progress),
});
```

**Sempre trate a ausência de frames.** Enquanto os frames não existem, a
página precisa estar completa: hero vira pôster estático e a pista encolhe para uma tela.

```css
.hero { height: 380vh; }
body[data-sem-frames="true"] .hero { height: 100svh; }
```

---

## 2. Lote de imagens em série coerente

Para 3–6 peças que precisam parecer da mesma família (cards de produto, ícones de seção, aberturas).

**Um bloco de estilo, N assuntos.** O estilo repetido é o que amarra a série:

```js
const ESTILO = [
  "Technical blueprint render on a deep graphite background (#0B0C0E).",
  "Precise thin amber (#E8934A) wireframe linework, faint engineering grid,",
  "subtle depth haze, single directional light, isometric three-quarter view.",
  "No text, no letters, no numbers, no labels, no watermark.",
  "Cinematic, restrained. Centered subject with generous negative space.",
].join(" ");

const PECAS = [
  { nome: "spike",  assunto: "a single slender probe needle piercing a floating volumetric cloud" },
  { nome: "bounded", assunto: "one machined gear held inside a rigid rectangular containment frame" },
];

for (const p of PECAS) {                          // sequencial: mais fácil de depurar
  const r = await engine.invoke("imagem-gerar",
    { prompt: `${p.assunto}. ${ESTILO}`, provider: "codex", aspecto: "16:9" },
    { principal: null });
  console.error(p.nome, r.artefatos[0].caminho);
}
```

Rode **em background** e escreva o CSS enquanto sai. Cada imagem leva dezenas de segundos.

Depois, sempre: `cwebp -q 82 in.png -o out.webp` (2 MB → ~180 KB).

---

## 3. Fotos de peça de branding em vez de imagem gerada

Quando o usuário manda referências de campanha (Behance, deck de marca), **recortar vence gerar**:
a fotografia real tem o produto certo, a luz certa e a marca certa.

```bash
# Contact sheet primeiro: ler 45 imagens uma a uma estoura o contexto à toa.
python3 -c "
from PIL import Image
nomes = [...]
T=300; s=Image.new('RGB',(T*4,T*3),'#111')
for i,n in enumerate(nomes):
    im=Image.open(n); im.thumbnail((T-10,T-10)); s.paste(im,(i%4*T+5,i//4*T+5))
s.save('sheet.jpg',quality=88)"
```

Depois **amostre a paleta dos pixels** em vez de escolher cor a olho — filtre por luminância e
saturação para separar tipografia chapada de sombra de fotografia:

```python
h, l, s = colorsys.rgb_to_hls(r/255, g/255, b/255)
if l < 0.30 and s > 0.25: marrom.append(...)          # tinta
if 0.02 < h < 0.10 and s > 0.65: laranja.append(...)  # acento
```

E recorte **por região da cena**, não por faixa fixa: cada peça põe a headline num lugar. Confira o
resultado num contact sheet dos crops antes de montar a página.

`magick montage` quebra com `unable to read font` em algumas instalações; o loop em PIL acima é o
caminho sem atrito.

---

## 4. Logo recortado de uma peça

O recorte vem com fundo opaco. `filter: brightness(0) invert(1)` no CSS pinta o retângulo inteiro de
branco — foi exatamente o que aconteceu aqui. Remova o fundo por luminância e gere as duas versões:

```python
lum = (0.299*r + 0.587*g + 0.114*b) / 255
alpha = max(0.0, min(1.0, (0.80 - lum) / 0.45))   # proporcional = sem serrilhado
```

Uma versão com o traço escuro (fundo claro), outra com o traço na cor do papel (hero escuro).

---

## Números medidos nesta stack

| | |
|---|---|
| Clipe 10s omni-flash | 60–80s do enfileiramento ao mp4 (2 amostras) |
| Frames de 10s @12fps 1280×720 | 120 arquivos, 4–5 MB |
| Imagem via Codex | 1–2 MB PNG; `cwebp -q 82` derruba para ~180 KB |
| Aspecto 16:9 pedido | saiu 1672×941 de verdade |
| Poll de `video-status` | 20s; abaixo disso é desperdício |
