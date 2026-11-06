#!/usr/bin/env bash
# Instala o flowkta nesta máquina: builda o engine, liga a skill no Claude Code e registra o MCP.
# Uso: git clone <repo> ~/dev/flowkta && ~/dev/flowkta/scripts/instalar.sh
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILLS="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

cd "$RAIZ"
npm install
npm run build

mkdir -p "$SKILLS"
if [ -e "$SKILLS/flowkta" ] && [ ! -L "$SKILLS/flowkta" ]; then
  echo "erro: $SKILLS/flowkta já existe e não é symlink; remova antes de instalar" >&2
  exit 1
fi
ln -sfn "$RAIZ/skill" "$SKILLS/flowkta"

npm run mcp:install

echo "flowkta instalado: engine em $RAIZ/dist, skill em $SKILLS/flowkta, MCP registrado."
echo "Lembre: 'codex login' (imagem) e 'uv tool install gflow-cli' (vídeo) são por máquina."
