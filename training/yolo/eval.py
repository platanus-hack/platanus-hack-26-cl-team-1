"""Before/after table for the pitch (F5): YOLO11s base (COCO), YOLO-World zero-shot and the
fine-tuned YOLO11s on the held-out TEST split (split by session) → training/results/yolo.md

    cd ~/cv/app/vision && .venv/bin/python ../training/yolo/eval.py \
        --data ~/cv/data/yolo/v1/data.yaml --finetuned ~/cv/models/yolo-armado-v1.pt
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vision"))


def speed_ms(model, images: list[Path], imgsz: int) -> float:
    if not images:
        return float("nan")
    model.predict(str(images[0]), imgsz=imgsz, verbose=False)  # warm-up
    t = time.perf_counter()
    for p in images[:50]:
        model.predict(str(p), imgsz=imgsz, verbose=False)
    return (time.perf_counter() - t) * 1000 / min(50, len(images))


def evaluate(model, data: str, imgsz: int) -> dict:
    m = model.val(data=data, split="test", imgsz=imgsz, batch=16, plots=False, verbose=False)
    names = m.names
    per = {names[int(c)]: float(ap) for c, ap in zip(m.box.ap_class_index, m.box.ap50, strict=True)}
    return {"map50": float(m.box.map50), "map": float(m.box.map), "per_class": per}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--finetuned", required=True)
    ap.add_argument("--base", default=str(Path.home() / "cv/models/yolo11s.pt"))
    ap.add_argument("--world", default="yolov8s-worldv2.pt")
    ap.add_argument("--imgsz", type=int, default=640)
    ap.add_argument("--out", default=str(ROOT / "training/results/yolo.md"))
    a = ap.parse_args()

    from ultralytics import YOLO, YOLOWorld

    from vision.classes import CLASSES, PROMPTS

    cfg = yaml.safe_load(Path(a.data).read_text())
    test_dir = Path(cfg["path"]) / cfg.get("test", "images/test")
    images = sorted(p for p in test_dir.rglob("*") if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    names = cfg["names"] if isinstance(cfg["names"], list) else [cfg["names"][i] for i in sorted(cfg["names"])]
    assert list(names) == list(CLASSES), f"data.yaml names {names} != vision.classes {CLASSES}"

    rows = []
    world = YOLOWorld(a.world)
    world.set_classes([PROMPTS[c] for c in CLASSES])
    rows.append(("YOLO-World v2-s, zero-shot (prompts)", evaluate(world, a.data, a.imgsz), speed_ms(world, images, a.imgsz)))
    ft = YOLO(a.finetuned)
    rows.append((f"YOLO11s fine-tuned ({Path(a.finetuned).name})", evaluate(ft, a.data, a.imgsz), speed_ms(ft, images, a.imgsz)))
    base = YOLO(a.base)
    base_speed = speed_ms(base, images, a.imgsz)

    lines = [
        "# YOLO: base vs. fine-tuned",
        "",
        f"Test split: {len(images)} imágenes de sesiones que el modelo nunca vio (split por sesión). "
        f"Generado {datetime.now():%Y-%m-%d %H:%M}.",
        "",
        "| Modelo | mAP50 | mAP50-95 | ms/img (3090) |",
        "|---|---|---|---|",
        f"| YOLO11s base (COCO) | 0,000 | 0,000 | {base_speed:.1f} |",
    ]
    for name, r, ms in rows:
        lines.append(f"| {name} | {r['map50']:.3f} | {r['map']:.3f} | {ms:.1f} |")
    lines += [
        "",
        "YOLO11s base no tiene ninguna de estas clases (COCO no incluye LEDs, resistencias ni cables): "
        "su mAP es 0 por construcción. La comparación real es contra YOLO-World zero-shot con las mismas clases en texto.",
        "",
        "## AP50 por clase",
        "",
        "| Clase | " + " | ".join(n for n, _, _ in rows) + " |",
        "|---|" + "---|" * len(rows),
    ]
    for c in CLASSES:
        vals = " | ".join(f"{r['per_class'].get(c, 0.0):.3f}" for _, r, _ in rows)
        lines.append(f"| `{c}` | {vals} |")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
    print(f"\n→ {out}")


if __name__ == "__main__":
    main()
