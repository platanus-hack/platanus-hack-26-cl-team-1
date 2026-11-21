"""Fine-tune YOLO11s on the Modo Armado dataset (F5).

On the 3090 (vision venv has ultralytics + CUDA):
    cd ~/cv/app/vision && .venv/bin/python ../training/yolo/train.py --data ~/cv/data/yolo/v1/data.yaml

vLLM can stay up (YOLO11s at 640 uses < 6 GB); on OOM lower --batch or stop cv-vllm.
The best weights are copied to ~/cv/models/yolo-armado-<name>.pt; point CV_YOLO at them.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--model", default=str(Path.home() / "cv/models/yolo11s.pt"))
    ap.add_argument("--epochs", type=int, default=80)
    ap.add_argument("--patience", type=int, default=20)
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--name", default="v1")
    ap.add_argument("--project", default=str(Path.home() / "cv/runs/yolo"))
    a = ap.parse_args()

    from ultralytics import YOLO

    model = YOLO(a.model)
    model.train(
        data=a.data,
        epochs=a.epochs,
        patience=a.patience,
        imgsz=a.imgsz,
        batch=a.batch,
        project=a.project,
        name=a.name,
        exist_ok=True,
        seed=0,
        # the camera is fixed and colour IS the class (led_red vs led_yellow): no hue shifts,
        # mild geometry, keep mosaic for small objects and turn it off for the last epochs.
        hsv_h=0.0,
        hsv_s=0.3,
        hsv_v=0.3,
        degrees=3.0,
        translate=0.05,
        scale=0.25,
        fliplr=0.5,
        mosaic=1.0,
        close_mosaic=10,
        plots=True,
    )
    best = Path(a.project) / a.name / "weights" / "best.pt"
    out = Path.home() / "cv/models" / f"yolo-armado-{a.name}.pt"
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(best, out)
    print(f"best → {out}\nCV_YOLO={out}  (en ~/cv/env, luego systemctl --user restart cv-vision)")


if __name__ == "__main__":
    main()
