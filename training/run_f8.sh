#!/usr/bin/env bash
# F8 in one command, on the 3090: dataset → base eval → QLoRA → serve the adapter → LoRA eval →
# SUMMARY.md → production uses whichever model wins.
#   bash ~/cv/app/training/run_f8.sh [name=v1]
#   time plan B (after 00:30):  EPOCHS=1 R=8 LIMIT=600 bash ~/cv/app/training/run_f8.sh v1
# vLLM is stopped while training (QLoRA does not fit next to it) and always restarted.
set -euo pipefail
NAME="${1:-v1}"
EPOCHS="${EPOCHS:-2}"
R="${R:-16}"
LIMIT="${LIMIT:-}"
SESSIONS="${SESSIONS:-$HOME/cv/data/vlm/sessions}"
MAX_STEPS="${MAX_STEPS:--1}"   # smoke tests only
cd ~/cv/app/vision
PY=.venv/bin/python
DATA=~/cv/data/vlm/$NAME
RUN=~/cv/runs/vlm/$NAME
say() { printf '\n=== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
wait_vllm() {  # $1 = model id that must be served
  for _ in $(seq 300); do
    curl -fsS 127.0.0.1:8001/v1/models 2>/dev/null | grep -q "\"$1\"" && return 0
    sleep 2
  done
  echo "vLLM no sirve '$1'" >&2
  return 1
}

say "dataset → $DATA"
$PY ../training/vlm/build_dataset.py --sessions "$SESSIONS" --out "$DATA"

say "ANTES: modelo base"
wait_vllm qwen3vl
$PY ../training/vlm/eval.py --data "$DATA/test.jsonl" --model qwen3vl --name base | tail -12

say "QLoRA (epochs=$EPOCHS r=$R ${LIMIT:+limit=$LIMIT}) — vLLM detenido mientras entrena"
systemctl --user stop cv-vllm
trap 'systemctl --user start cv-vllm' EXIT
~/cv/venvs/train/bin/python ../training/vlm/train.py --data "$DATA/train.jsonl" --out "$RUN" \
  --epochs "$EPOCHS" --r "$R" --alpha $((R * 2)) --max-steps "$MAX_STEPS" ${LIMIT:+--limit "$LIMIT"}
trap - EXIT

say "sirviendo base + LoRA ('armado')"
touch ~/cv/env
sed -i '/^VLM_LORA=/d' ~/cv/env
echo "VLM_LORA=$RUN/adapter" >> ~/cv/env
systemctl --user start cv-vllm
wait_vllm armado

say "DESPUÉS: LoRA"
$PY ../training/vlm/eval.py --data "$DATA/test.jsonl" --model armado --name lora | tail -12
python3 ../training/summary.py

say "¿cuál sirve producción?"
winner=$(python3 - <<'PY'
import json, pathlib
r = pathlib.Path.home() / "cv/app/training/results"
b, l = (json.loads((r / f"vlm_{n}.json").read_text()) for n in ("base", "lora"))
better = (l["f1_error"], l["acc_estado"]) > (b["f1_error"], b["acc_estado"])
print("armado" if better else "qwen3vl")
PY
)
sed -i '/^VLM_SERVED=/d' ~/cv/env
echo "VLM_SERVED=$winner" >> ~/cv/env
systemctl --user restart cv-vision
echo "Producción usa: $winner  (si es qwen3vl, la LoRA no mejoró: se dice tal cual en el pitch)"
echo "Desde el PC:  scp '172.16.0.204:cv/app/training/results/*' training/results/"
