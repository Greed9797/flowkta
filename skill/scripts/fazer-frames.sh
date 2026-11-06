#!/usr/bin/env bash
# Corta um mp4 em frames JPEG e escreve o manifesto que references/scrub.js consome.
#
#   fazer-frames.sh <video.mp4> <dir-de-saida> [fps] [largura]
#
# O <dir-de-saida> é onde a página busca: normalmente <raiz-do-site>/frames.
#
# Por que JPEG e não PNG: são ~120 arquivos que o navegador precisa buscar e decodificar. PNG
# nesta resolução passa de 1 MB cada; JPEG q=6 fica em ~35 KB sem diferença visível em movimento.
# Medido: 10s a 12fps em 1280x720 = 120 frames, 4–5 MB no total.
set -euo pipefail

VIDEO="${1:?uso: fazer-frames.sh <video.mp4> <dir-de-saida> [fps] [largura]}"
DESTINO="${2:?uso: fazer-frames.sh <video.mp4> <dir-de-saida> [fps] [largura]}"
FPS="${3:-12}"
LARGURA="${4:-1280}"

rm -rf "$DESTINO"
mkdir -p "$DESTINO"

ffmpeg -loglevel error -i "$VIDEO" \
  -vf "fps=${FPS},scale=${LARGURA}:-2:flags=lanczos" \
  -q:v 6 \
  "$DESTINO/f%04d.jpg"

CONTAGEM=$(find "$DESTINO" -name 'f*.jpg' | wc -l | tr -d ' ')
if [ "$CONTAGEM" -eq 0 ]; then
  echo "nenhum frame extraído de $VIDEO" >&2
  exit 1
fi

DIMENSOES=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
  -of csv=p=0:s=x "$DESTINO/f0001.jpg")

python3 - "$DESTINO" "${DIMENSOES%x*}" "${DIMENSOES#*x}" <<'PY'
import json, os, sys
destino, largura, altura = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
frames = sorted(f for f in os.listdir(destino) if f.endswith(".jpg"))
with open(os.path.join(destino, "manifest.json"), "w") as fp:
    json.dump({"frames": frames, "largura": largura, "altura": altura}, fp)
print(f"{len(frames)} frames · {largura}x{altura}")
PY

du -sh "$DESTINO" | awk '{print "peso total: " $1}'
