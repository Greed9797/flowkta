# flowkta

Action Engine ([Invokta](https://github.com/vinilana/invokta)) para gerar **imagem e vídeo para web** —
hero de landing page, imagens de site, vídeo cinematográfico curto — sobre dois provedores:

- **Google Flow** (Veo / Imagen) via [`gflow-cli`](https://github.com/ffroliva/gflow-cli), na conta Google AI Ultra
- **GPT Image** via a tool nativa `image_gen` do **Codex CLI**, na assinatura ChatGPT (sem `OPENAI_API_KEY`)

Exposto por **MCP stdio** e **CLI**, a partir de uma única definição de capability.

## Por que existir, se o gflow já tem MCP próprio

O `gflow mcp run` expõe a CLI. Este engine expõe o **domínio**, e só se justifica pelas quatro coisas
que aquele não faz:

1. **Roteador de domínio** — você pede um resultado, não um subcomando. Ver `src/rota.ts`.
2. **Lock serial do Chrome** — o gflow dirige um único profile; dois processos se derrubam.
3. **Gate de gasto** — vídeo queima crédito real, e um agente em laço queima em série.
4. **Classificação de falha com `creditoProvavelmenteGasto`** — decide se regerar é grátis ou é pagar duas vezes.

Se uma futura versão do gflow entregar as quatro, este engine perde a razão de ser e deve ser aposentado.

## As armadilhas que o roteador esconde

Foram medidas, não deduzidas:

| Situação | Comportamento real |
|---|---|
| `--duration` | só `omni-flash` aceita; os Veo 3.1 não renderizam controle de duração |
| `omni-flash` + `i2v` | o Flow **descarta o frame inicial em silêncio**, cai para t2v e cobra igual |
| 10s ancorado em imagem | precisa ser `r2v --ref` (cap de 7 refs), nunca `i2v` |
| `video chain` | recusa `omni-flash` por contrato → sequência não suporta 10s |
| saída | `image` usa `--out DIRECTORY`, `video` usa `--out-dir DIRECTORY` |

`src/rota.ts` é função pura, sem I/O, com tabela de teste exaustiva. É o arquivo que você lê primeiro.

## Capabilities

| id | o que faz | custo |
|---|---|---|
| `midia-diagnostico` | pré-flight honesto: versão, sessão do Flow, lock, auth do Codex | grátis |
| `imagem-gerar` | PNG por `provider: 'gflow' \| 'codex'` | gflow ~grátis; codex consome cota da assinatura |
| `video-iniciar` | enfileira e devolve `jobId` em <1s | **crédito Google AI Ultra** |
| `video-status` | acompanha o job | grátis |
| `video-cancelar` | mata o processo e libera o Chrome | grátis (não estorna) |

Ids sem ponto: o adapter MCP troca caracteres fora de `[a-zA-Z0-9_-]` por underscore, então um id com
ponto apareceria diferente na CLI e no MCP.

## Decisões

**Vídeo não é chamada síncrona.** Gerar leva 30–90s por clipe, o Invokta não tem notificação de
progresso e o adapter MCP nunca emite `sendNotification`. Modelar isso como uma tool que espera seria
apostar num timeout de host que não controlamos. Daí o trio iniciar/status/cancelar.

**`video-cancelar` existe porque `context.signal` não basta.** O signal do Invokta rejeita a Promise da
chamada; ele não alcança um processo externo que continua rodando. Sem essa capability, um timeout do
host deixaria um Chrome órfão segurando o profile para sempre.

**O gate de gasto mora no `run`, não no `access`.** No Invokta 0.6 um `AccessRule` em forma de função
exige principal não-nulo, e o adapter MCP stdio serve com `principal: null` — a regra nunca rodaria e
todo mundo levaria `UNAUTHENTICATED` em vez do motivo real. O gate é a primeira instrução do `run`,
antes de criar job, adquirir lock ou spawnar qualquer coisa; o teste prova que o gerador não é tocado.

**Nenhum campo de gasto no schema.** Um `confirmarGasto: true` na entrada seria preenchido pelo próprio
modelo — autorização no lugar errado. A permissão vem do ambiente do processo, de quem instalou o MCP.

**Nada de MCP HTTP.** Abrir porta HTTP sem autenticação para algo que gasta dinheiro real da conta
Google do usuário não se paga. O canal é stdio local.

**`shell: false` sempre.** Não é estilo: sob `shell: true`, um caminho contendo `&` faz o shell
backgroundar o comando e interpretar o resto como outro comando.

**Custódia de artefato.** O engine nunca devolve o caminho onde a ferramenta externa escreveu: copia
para o diretório do job, calcula sha256, confere que existe e não está vazio, e só então devolve. O
diretório de saída do gflow varia entre versões, e o PNG do Codex nasce obrigatoriamente em
`$CODEX_HOME/generated_images` (a `image_gen` não aceita destino).

**Estado em memória.** `Map` no processo MCP + diretório do job em disco. Um restart perde o status,
não perde o arquivo. O contador do teto horário lê o disco justamente por isso.

## Limites conhecidos

- O lock cobre os spawns **deste engine**. Um `gflow` rodado à mão no terminal não passa por ele — o
  backstop nesse caso é o lease de kernel do próprio gflow, que só existe em ≥0.50.0. Por isso a versão
  mínima é checada no diagnóstico.
- Sem Higgsfield e sem OpenAI API: quando o Flow bloquear conteúdo, **não há fallback**. A falha é terminal.
- `midia-diagnostico` classifica a sessão do Flow como `indeterminada` quando o probe do `auth status`
  não é conclusivo. A primeira geração dirá a verdade.
- Um `gflow auth login` deixa o Chrome aberto segurando o lease do perfil. A próxima geração falha
  até esse Chrome fechar (`pkill -f profile_<nome>`). O engine classifica isso como falha antes da
  submissão, então repetir não custa crédito.

## Instalar em outra máquina

```bash
git clone https://github.com/Greed9797/flowkta ~/dev/flowkta
~/dev/flowkta/scripts/instalar.sh
```

O script builda o engine, cria o symlink `~/.claude/skills/flowkta -> <repo>/skill` (a skill do
Claude Code vive em `skill/` neste repo) e registra o MCP nos clientes locais. Credenciais são
por máquina: `codex login` para imagem e os pré-requisitos do gflow abaixo para vídeo.

## Uso

```bash
npm run check                  # typecheck + testes + build + validação do manifesto MCP
npm run direct                 # roda midia-diagnostico pelo canal direto
npm run devtools               # inspector em http://127.0.0.1:4100
npm run mcp:install            # registra como MCP nos clientes locais
npm run mcp:uninstall
```

Smoke manual contra o engine buildado (escreve em arquivo para não ser reescrito por hooks de saída):

```bash
node scripts/invocar.mjs midia-diagnostico '{}' /tmp/diag.json
node scripts/invocar.mjs imagem-gerar '{"prompt":"...","provider":"codex"}' /tmp/img.json
```

### Ambiente

| variável | efeito |
|---|---|
| `FLOWKTA_ALLOW_SPEND` | `true` libera geração de vídeo. Sem isso, `video-iniciar` responde `FORBIDDEN`. |
| `FLOWKTA_MAX_CLIPES_POR_HORA` | teto por hora (padrão 5) |
| `FLOWKTA_WORKDIR` | onde os artefatos vivem (padrão `~/.flowkta`) |
| `FLOWKTA_GFLOW_PROFILE` | perfil do gflow. Ausente = usa o perfil que o próprio gflow tem como default (`gflow auth use <nome>`). Só defina para fixar outro. |

### Pré-requisitos

```bash
uv tool install gflow-cli                                  # ≥0.50.0
uv tool run --from gflow-cli playwright install chromium   # necessário após reinstalar
gflow auth login                                           # interativo, abre Chrome
codex login                                                # para provider='codex'
```

A skill correspondente do Claude Code vive em `~/.claude/skills/flowkta/SKILL.md`: ela ensina o agente
**quando** invocar; este pacote é **o que** ele invoca.
