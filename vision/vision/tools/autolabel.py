"""Auto-label raw captures with a zero-shot detector, as a first draft for the reviewer (/review).

    uv run python -m vision.tools.autolabel [--raw <CV_DATA>/yolo/raw] [--out <CV_DATA>/yolo/labeled]
        [--engine world|qwen] [--conf 0.15] [--force] [--limit N]

Engines (GPU server only, `uv sync --extra gpu`):
  world  ultralytics YOLO-World (yolov8s-worldv2.pt) with the class prompts of `vision.classes`.
  qwen   Qwen3-VL served by vLLM ($VLLM_URL, model "qwen3vl"), grounding JSON in 0–1000 coordinates.

Each `<raw>/<session>/<file>.jpg` becomes `<out>/images/<session>/<file>.jpg` (hard link, or a copy) plus
`<out>/labels/<session>/<file>.txt`. Images that already have a label file are skipped unless --force;
images accepted or deleted in the reviewer are never touched again.
"""

from __future__ import annotations

import argparse
import base64
import itertools
import json
import os
import re
import sys
import unicodedata
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

from PIL import Image

from ..classes import CLASS_SPECS, CLASSES, NC
from ..yolo_io import (
    DELETED,
    REVIEWED,
    Box,
    data_dir,
    format_table,
    format_yolo,
    iter_images,
    label_path,
    link_or_copy,
    read_label_counts,
    read_set,
    write_atomic,
)

Result = tuple[list[Box], int, int] | None  # (boxes in px, width, height); None = failed, retry next run
EngineOut = Iterator[tuple[Path, Result]]

# --- Qwen3-VL grounding --------------------------------------------------------------------------

QWEN_PROMPT = (
    "Detect every instance of the following objects in this photo of an electronics kit on a breadboard:\n"
    + "\n".join(f"- {c.name}: {c.prompt_en} ({c.prompt_es})" for c in CLASS_SPECS)
    + "\nFor wire_end, box only the small plug at the end of each jumper wire where it enters the breadboard or "
    "the Arduino header, never the whole wire. Box each LED, resistor, etc. tightly, including its legs.\n"
    'Answer ONLY with a JSON array like [{"label": "led_red", "bbox_2d": [x1, y1, x2, y2]}], where label is one '
    "of the names above and the coordinates are normalised to 0-1000. Answer [] if none are visible."
)


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


_ALIASES: dict[str, int] = {
    "arduino": 0,
    "pushbutton": 5,
    "boton": 5,
    "piezo": 7,
    "wire_tip": 8,
    "jumper_wire_end": 8,
    "jumper_end": 8,
    "hands": 9,
}
for _i, _c in enumerate(CLASS_SPECS):
    for _s in (_c.name, _c.es, _c.prompt_en, _c.prompt_es):
        _ALIASES[_norm(_s)] = _i


def match_class(label: Any) -> int | None:
    return _ALIASES.get(_norm(str(label))) if label is not None else None


_FENCE = re.compile(r"```(?:json)?\s*(.*?)(?:```|$)", re.S)
_FLAT_OBJ = re.compile(r"\{[^{}]*\}")
_LOOSE_LABEL = re.compile(r"""["']?(?:label|name|class)["']?\s*:\s*["']([^"']+)["']""")
_LOOSE_BBOX = re.compile(r"""["']?(?:bbox_2d|bbox|box)["']?\s*:\s*\[([^\]]*)\]""")
_NUM = re.compile(r"-?\d+(?:\.\d+)?")


def _objects(text: str) -> list[dict]:
    """Objects of a grounding answer: plain or fenced JSON, wrapped in a dict, truncated or sloppy."""
    m = _FENCE.search(text)
    body = m.group(1) if m else text
    try:
        data = json.loads(body)
    except ValueError:
        data = None
    if isinstance(data, dict):
        lists = [v for v in data.values() if isinstance(v, list) and v and all(isinstance(o, dict) for o in v)]
        data = lists[0] if lists else [data]
    if isinstance(data, list):
        return [o for o in data if isinstance(o, dict)]
    out = []  # partial output (cut by max_tokens) or not quite JSON: salvage every flat {...}
    for chunk in _FLAT_OBJ.findall(body):
        try:
            o = json.loads(chunk)
        except ValueError:
            lab, box = _LOOSE_LABEL.search(chunk), _LOOSE_BBOX.search(chunk)
            o = {"label": lab.group(1), "bbox_2d": _NUM.findall(box.group(1))} if lab and box else None
        if isinstance(o, dict):
            out.append(o)
    return out


def parse_qwen_boxes(text: str, w: int, h: int, scale: float = 1000.0) -> list[Box]:
    """Qwen3-VL grounding answer (coordinates in 0..scale) → clamped pixel boxes of known classes."""
    boxes = []
    for o in _objects(text):
        cls = match_class(o.get("label", o.get("name", o.get("class"))))
        bbox = o.get("bbox_2d", o.get("bbox", o.get("box")))
        if cls is None or not isinstance(bbox, list) or len(bbox) < 4:
            continue
        try:
            x1, y1, x2, y2 = (float(v) for v in bbox[:4])
        except (TypeError, ValueError):
            continue
        b = Box(cls, x1 / scale * w, y1 / scale * h, x2 / scale * w, y2 / scale * h).clamped(w, h)
        if b:
            boxes.append(b)
    return clean_boxes(boxes, w, h)


# Qwen grounding sometimes loops, emitting a grid of near-duplicate boxes until max_tokens.
MAX_PER_CLASS = {"wire_end": 24, "hand": 4, "arduino_uno": 2}
MAX_OTHER = 10


def _iou(a: Box, b: Box) -> float:
    ix = max(0.0, min(a.x2, b.x2) - max(a.x1, b.x1))
    iy = max(0.0, min(a.y2, b.y2) - max(a.y1, b.y1))
    inter = ix * iy
    union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
    return inter / union if union > 0 else 0.0


def clean_boxes(boxes: list[Box], w: int, h: int) -> list[Box]:
    """Drop duplicates (IoU > 0.6, same class), implausibly large boxes and the tail of repetition loops."""
    out: list[Box] = []
    count: dict[int, int] = {}
    for b in boxes:
        name = CLASSES[b.cls]
        area = (b.x2 - b.x1) * (b.y2 - b.y1) / (w * h)
        if area > 0.6 and name != "arduino_uno":
            continue
        if any(o.cls == b.cls and _iou(o, b) > 0.6 for o in out):
            continue
        if count.get(b.cls, 0) >= MAX_PER_CLASS.get(name, MAX_OTHER):
            continue
        count[b.cls] = count.get(b.cls, 0) + 1
        out.append(b)
    return out


def run_qwen(paths: list[Path], args: argparse.Namespace) -> EngineOut:
    from openai import OpenAI  # GPU extra

    client = OpenAI(base_url=args.vllm_url.rstrip("/") + "/v1", api_key="local", timeout=120)

    def one(p: Path) -> Result:
        try:
            mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
            url = f"data:{mime};base64,{base64.b64encode(p.read_bytes()).decode()}"
            r = client.chat.completions.create(
                model=args.model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "image_url", "image_url": {"url": url}},
                            {"type": "text", "text": QWEN_PROMPT},
                        ],
                    }
                ],
                temperature=0,
                max_tokens=1200,
                extra_body={"repetition_penalty": 1.05},  # damp the box-repetition loops
            )
            with Image.open(p) as im:
                w, h = im.size
            return parse_qwen_boxes(r.choices[0].message.content or "", w, h), w, h
        except Exception as e:  # noqa: BLE001 — one bad request must not kill a 400-image run
            print(f"  ! {p.name}: {e}", file=sys.stderr)
            return None

    with ThreadPoolExecutor(args.workers) as ex:
        yield from zip(paths, ex.map(one, paths), strict=True)


# --- YOLO-World ----------------------------------------------------------------------------------


def run_world(paths: list[Path], args: argparse.Namespace) -> EngineOut:
    from ultralytics import YOLOWorld  # GPU extra

    model = YOLOWorld(args.weights)
    model.set_classes([c.prompt_en for c in CLASS_SPECS])  # prompt order == class id
    results = model.predict(
        [str(p) for p in paths],
        conf=args.conf,
        iou=0.6,
        agnostic_nms=args.agnostic,
        imgsz=640,
        device=args.device,
        stream=True,
        verbose=False,
    )
    by_name = {str(p): p for p in paths}
    for r in results:
        h, w = r.orig_shape
        xyxy, cls = r.boxes.xyxy.tolist(), r.boxes.cls.tolist()
        yield by_name.get(r.path, Path(r.path)), ([Box(int(c), *xy) for c, xy in zip(cls, xyxy, strict=True)], w, h)


ENGINES = {"world": run_world, "qwen": run_qwen}

# --- pipeline ------------------------------------------------------------------------------------


def pending(raw: Path, out: Path, force: bool) -> tuple[list[tuple[Path, Path]], int]:
    """(source, relative path) of the images to label, and how many were skipped."""
    reviewed, deleted = read_set(out / REVIEWED), read_set(out / DELETED)
    todo, skipped = [], 0
    for src in iter_images(raw):
        rel = src.relative_to(raw)
        if len(rel.parts) == 1:  # --raw pointed at a single session folder
            rel = Path(raw.resolve().name) / rel
        key = rel.as_posix()
        if key in deleted or key in reviewed or (label_path(out, rel).exists() and not force):
            skipped += 1
        else:
            todo.append((src, rel))
    return todo, skipped


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Auto-etiquetado zero-shot de las capturas para YOLO")
    ap.add_argument("--raw", type=Path, default=data_dir() / "yolo" / "raw")
    ap.add_argument("--out", type=Path, default=data_dir() / "yolo" / "labeled")
    ap.add_argument("--engine", choices=sorted(ENGINES), default="world")
    ap.add_argument("--conf", type=float, default=0.15, help="confianza mínima (solo world)")
    ap.add_argument("--force", action="store_true", help="re-etiquetar aunque ya exista el .txt (nunca las revisadas)")
    ap.add_argument("--limit", type=int, default=0, help="etiquetar como máximo N imágenes (prueba rápida)")
    ap.add_argument("--weights", default="yolov8s-worldv2.pt")
    ap.add_argument("--device", default=None, help="p. ej. 0 o cpu (world)")
    ap.add_argument("--agnostic", action=argparse.BooleanOptionalAction, default=True, help="NMS entre clases (world)")
    ap.add_argument("--vllm-url", default=os.environ.get("VLLM_URL", "http://127.0.0.1:8001"))
    ap.add_argument("--model", default=os.environ.get("VLM_SERVED", "qwen3vl"))
    ap.add_argument("--workers", type=int, default=4, help="peticiones simultáneas a vLLM (qwen)")
    args = ap.parse_args(argv)

    todo, skipped = pending(args.raw, args.out, args.force)
    if args.limit:
        todo = todo[: args.limit]
    print(
        f"{len(todo)} imágenes por etiquetar con {args.engine} ({skipped} omitidas: ya etiquetadas, revisadas o borradas)"
    )
    run = [0] * NC
    done = empty = failed = 0
    if todo:
        rel_of = dict(todo)
        try:
            results = ENGINES[args.engine](list(rel_of), args)
            first = next(results, None)  # imports the GPU extras before anything is written
        except ImportError as e:
            raise SystemExit(f"Falta {e.name}: en el servidor GPU, `uv sync --extra gpu`") from e
        for src, res in itertools.chain([first] if first else [], results):
            rel = rel_of.get(src)
            if res is None or rel is None:
                failed += 1
                continue
            boxes, w, h = res
            link_or_copy(src, args.out / "images" / rel)
            write_atomic(label_path(args.out, rel), format_yolo(boxes, w, h))
            for b in boxes:
                run[b.cls] += 1
            done += 1
            empty += not boxes
            if done % 50 == 0:
                print(f"  {done}/{len(todo)}")

    total = [0] * NC
    for lbl in (args.out / "labels").rglob("*.txt"):
        total = [a + b for a, b in zip(total, read_label_counts(lbl), strict=True)]
    rows = [[name, run[i], total[i]] for i, name in enumerate(CLASSES)]
    rows.append(["TOTAL", sum(run), sum(total)])
    print(format_table(["clase", "esta corrida", "dataset"], rows))
    print(f"{done} etiquetadas ({empty} sin cajas), {failed} con error → {args.out}")


if __name__ == "__main__":
    main()
