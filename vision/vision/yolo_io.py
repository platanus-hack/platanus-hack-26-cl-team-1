"""YOLO label files and the labelled-dataset layout shared by autolabel, the reviewer and make_dataset.

Layout of a labelled dataset (default `<CV_DATA>/yolo/labeled`):

    images/<session>/<epoch_ms>_<seq>.jpg
    labels/<session>/<epoch_ms>_<seq>.txt   # YOLO: "cls cx cy w h" normalised, one box per line
    reviewed.json                           # images accepted in the reviewer (relative paths)
    deleted.json                            # images deleted in the reviewer (autolabel never re-adds them)
"""

from __future__ import annotations

import json
import os
import shutil
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path

from .classes import NC

IMAGE_EXTS = {".jpg", ".jpeg", ".png"}
REVIEWED = "reviewed.json"
DELETED = "deleted.json"


def data_dir() -> Path:
    return Path(os.environ.get("CV_DATA", "data")).expanduser()


@dataclass(frozen=True)
class Box:
    """Axis-aligned box in image pixels."""

    cls: int
    x1: float
    y1: float
    x2: float
    y2: float

    def clamped(self, w: int, h: int) -> Box | None:
        """Ordered and clipped to the image; None if degenerate (< 1 px) or of an unknown class."""
        if not 0 <= self.cls < NC:
            return None
        x1, x2 = sorted((min(max(self.x1, 0.0), w), min(max(self.x2, 0.0), w)))
        y1, y2 = sorted((min(max(self.y1, 0.0), h), min(max(self.y2, 0.0), h)))
        if x2 - x1 < 1 or y2 - y1 < 1:
            return None
        return Box(self.cls, x1, y1, x2, y2)


def parse_yolo(text: str, w: int, h: int) -> list[Box]:
    """YOLO txt → pixel boxes. Malformed lines and unknown classes are skipped."""
    out: list[Box] = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) != 5:
            continue
        try:
            cls = int(parts[0])
            cx, cy, bw, bh = (float(v) for v in parts[1:])
        except ValueError:
            continue
        b = Box(cls, (cx - bw / 2) * w, (cy - bh / 2) * h, (cx + bw / 2) * w, (cy + bh / 2) * h).clamped(w, h)
        if b:
            out.append(b)
    return out


def format_yolo(boxes: Iterable[Box], w: int, h: int) -> str:
    """Pixel boxes → YOLO txt (clamped; degenerate boxes dropped)."""
    lines = []
    for raw in boxes:
        b = raw.clamped(w, h)
        if b:
            cx, cy = (b.x1 + b.x2) / 2 / w, (b.y1 + b.y2) / 2 / h
            lines.append(f"{b.cls} {cx:.6f} {cy:.6f} {(b.x2 - b.x1) / w:.6f} {(b.y2 - b.y1) / h:.6f}")
    return "".join(line + "\n" for line in lines)


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def link_or_copy(src: Path, dst: Path) -> None:
    """Hard link (free; later atomic rewrites of `src` don't touch `dst`), else copy. Keeps an existing `dst`."""
    if dst.exists():
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def label_path(root: Path, rel: str | Path) -> Path:
    """`<root>/labels/<rel>.txt` for the image `<root>/images/<rel>`."""
    return (root / "labels" / rel).with_suffix(".txt")


def iter_images(images_dir: Path) -> Iterator[Path]:
    """Image files under `images_dir`, recursively, in sorted (= chronological per session) order."""
    if images_dir.is_dir():
        yield from sorted(p for p in images_dir.rglob("*") if p.suffix.lower() in IMAGE_EXTS and p.is_file())


def class_counts(boxes: Iterable[Box]) -> list[int]:
    counts = [0] * NC
    for b in boxes:
        counts[b.cls] += 1
    return counts


def read_label_counts(path: Path) -> list[int]:
    """Per-class histogram of a label file without needing the image size."""
    counts = [0] * NC
    if path.is_file():
        for line in path.read_text().splitlines():
            parts = line.split()
            if len(parts) == 5 and parts[0].isdigit() and int(parts[0]) < NC:
                counts[int(parts[0])] += 1
    return counts


def format_table(headers: list[str], rows: list[list[object]]) -> str:
    """Plain-text table, first column left-aligned and the rest right-aligned."""
    cells = [headers] + [[str(c) for c in r] for r in rows]
    widths = [max(len(r[i]) for r in cells) for i in range(len(headers))]
    fmt = [lambda s, w=w, i=i: s.ljust(w) if i == 0 else s.rjust(w) for i, w in enumerate(widths)]
    lines = ["  ".join(f(c) for f, c in zip(fmt, r, strict=True)) for r in cells]
    lines.insert(1, "  ".join("-" * w for w in widths))
    return "\n".join(lines)


def read_set(path: Path) -> set[str]:
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return set()
    return {str(x) for x in data} if isinstance(data, list) else set()


def write_set(path: Path, items: set[str]) -> None:
    write_atomic(path, json.dumps(sorted(items), indent=0))
