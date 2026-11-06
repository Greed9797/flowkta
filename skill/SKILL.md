---
name: flowkta
description: Use quando o usuário pedir para gerar imagem — hero de landing page, imagem de site, thumbnail, packshot de produto, mockup, fundo — ou para montar um hero com vídeo dirigido pelo scroll a partir de um mp4 existente. Gera imagem SÓ pelo Codex CLI (GPT Image na assinatura ChatGPT) através do MCP flowkta, com `provider: 'codex'`. NUNCA usa o gflow/Google Flow (Veo/Imagen). Não use para editar vídeo já existente (ffmpeg direto), nem para ícones/logos vetoriais (SVG à mão é melhor).
---

# flowkta — gerar imagem pelo Codex CLI

O runtime é o MCP `flowkta`. Esta skill não gera nada sozinha: ela decide **quando** e **com quais
argumentos** chamar as capabilities, que é onde os erros caros acontecem.

## Regra fixa: nunca gflow

Decisão do Vitor (2026-09-25): **nunca mais usar o gflow**. Isso vale para tudo:

- `imagem-gerar` sempre com `provider: 'codex'`. Nunca `provider: 'gflow'`, nem "só pra testar".
- **Não chame `video-iniciar`, `video-status` nem `video-cancelar`.** As três rodam no gflow
  (Google Flow / Veo); não existe caminho de vídeo pelo Codex.
- Não rode `gflow` no shell (`gflow auth login`, `gflow data ...`, `gflow mcp run`) nem registre o
  MCP do gflow.
- Se `midia-diagnostico` reclamar da sessão do Flow, **ignore**: só importa o bloco do Codex.

Pediram vídeo? Diga que o flowkta não gera vídeo (o único caminho era o gflow, vetado) e peça o mp4
ao usuário. Com o mp4 em mãos, o hero dirigido pelo scroll abaixo funciona igual.

Arquivos de apoio, para não reescrever o mesmo código a cada projeto:

| Arquivo | Uso |
|---|---|
| `scripts/invocar.mjs` | chamar uma capability e escrever o resultado em arquivo |
| `scripts/fazer-frames.sh` | mp4 → frames JPEG + manifesto, para hero dirigido pelo scroll |
| `references/scrub.js` | motor de scroll-scrub pronto (canvas + fila de decodificação) |
| `references/receitas.md` | fluxos completos já validados, com os comandos na ordem |

## Antes da primeira geração da sessão

Chame `midia-diagnostico`. É gratuito. Olhe só o que diz respeito ao Codex (binário, login,
modelo disponível na conta); bloqueio do Flow/gflow não importa e não deve ser "resolvido".

**Armadilha já medida:** codex-cli desatualizado não conhece o modelo configurado e toda chamada
volta 400 (*"model is not supported when using Codex with a ChatGPT account"*). O diagnóstico avisa
quando o modelo não está na conta. Correção: `npm i -g @openai/codex@latest` e conferir em
`codex debug models`. Mudança no engine só chega ao MCP da sessão depois de reconectar (`/mcp`).

## Imagem

`imagem-gerar` com `provider: 'codex'`, sempre. **Consome cota da assinatura ChatGPT**, então não
gere em laço à toa: acerte o prompt antes.

Serve para tudo: texto legível na imagem, mockup de UI, packshot, diagrama, e também cena,
ambiente, atmosfera, fundo abstrato e hero decorativo.

### Escrever o prompt de imagem

Medido nesta stack, não deduzido:

- **Proíba vetor explicitamente.** A skill `imagegen` do próprio Codex manda preferir SVG para
  ícone, logo e UI — exatamente os casos de uso de web. Sem "bitmap PNG, NÃO SVG, NÃO HTML, NÃO
  código de desenho", ele devolve markup.
- **Termine com as negativas**: `no text, no letters, no numbers, no labels, no watermark`. Modelo
  de imagem adora escrever palavra errada na arte.
- **Separe assunto e estilo em duas frases.** Assunto primeiro, estilo depois; um bloco de estilo
  reutilizado entre as peças mantém a série coerente.
- O aspecto é respeitado: `16:9` saiu 1672×941 de verdade.
- O PNG vem grande (1–2 MB). Converta para web: `cwebp -q 82 in.png -o out.webp` derrubou 2 MB para
  184 KB sem diferença visível.

## Hero dirigido pelo scroll

O padrão mais pedido, e o motivo de `scripts/` existir: **vídeo cortado em frames, desenhado em
`<canvas>`, com a posição escolhida pelo scroll.** Nunca `<video>` com `currentTime`: seek em mp4
comprimido decodifica até o keyframe anterior a cada mexida da roda do mouse e engasga.

O mp4 vem do usuário (o flowkta não gera vídeo). Receita completa em `references/receitas.md`. O
motor pronto está em `references/scrub.js` — copie, não reescreva.

## Rodar o engine sem perder a saída

Hooks de pós-processamento (distill, RTK) reescrevem o stdout de comandos comuns, e você acaba
depurando a alucinação do hook em vez do seu código. Dois contornos, ambos validados:

- Use `scripts/invocar.mjs`, que escreve o resultado num arquivo em vez de imprimir.
- Envolva em `sh -c '...'` quando precisar de stdout mesmo.

## Concatenar clipes

O engine não concatena. Com os mp4 do usuário, use `ffmpeg` direto no shell.
