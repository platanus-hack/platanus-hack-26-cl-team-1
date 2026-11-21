#!/usr/bin/env bash
# F5 in one command, on the 3090: split by session → fine-tune YOLO11s → before/after eval → activate.
#   bash ~/cv/app/training/run_f5.sh [name=v1]
# Needs reviewed labels in ~/cv/data/yolo/labeled (autolabel + /review). vLLM can stay up.
set -euo pipefail
NAME="${1:-v1}"
cd ~/cv/app/vision
PY=.venv/bin/python
DATA=~/cv/data/yolo/$NAME
say() { printf '\n=== [%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

say "dataset → $DATA (solo imágenes revisadas)"
$PY -m vision.tools.make_dataset --src ~/cv/data/yolo/labeled --out "$DATA" --only-reviewed

say "fine-tuning YOLO11s ($NAME)"
$PY ../training/yolo/train.py --data "$DATA/data.yaml" --name "$NAME"

say "evaluación en test: YOLO-World zero-shot vs. fine-tuned"
$PY ../training/yolo/eval.py --data "$DATA/data.yaml" --finetuned ~/cv/models/yolo-armado-"$NAME".pt

say "activando el detector en el servidor de visión"
touch ~/cv/env
sed -i '/^CV_YOLO=/d' ~/cv/env
echo "CV_YOLO=$HOME/cv/models/yolo-armado-$NAME.pt" >> ~/cv/env
systemctl --user restart cv-vision
for _ in $(seq 60); do curl -fsS 127.0.0.1:8100/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS 127.0.0.1:8100/health; echo
python3 ../training/summary.py >/dev/null
say "listo. Desde el PC, trae los resultados al repo:"
echo "  scp '172.16.0.204:cv/app/training/results/*' training/results/"
echo "Meta: mAP50 ≥ 0,85. Si no, más fotos de las clases débiles (training/results/yolo.md) y repetir con otro nombre."
