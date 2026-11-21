#!/usr/bin/env bash
# Render every part renderer to PNG for visual QA.
#   scripts/render-parts.sh            # all parts
#   ONLY=led,resistor scripts/render-parts.sh
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${OUT:-.renders}"
rm -rf "$OUT" && mkdir -p "$OUT"
RENDER_PARTS=1 RENDER_OUT="$OUT" npx vitest run src/parts/render-gallery.test.tsx >/dev/null
for f in "$OUT"/*.svg; do rsvg-convert "$f" -o "${f%.svg}.png"; done
ls -1 "$OUT"/*.png
