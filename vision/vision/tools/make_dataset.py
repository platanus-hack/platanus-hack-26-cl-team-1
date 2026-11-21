"""Build the YOLO training set from the labelled dataset, split 80/10/10 by capture session.

    uv run python -m vision.tools.make_dataset [--src <CV_DATA>/yolo/labeled] [--out <CV_DATA>/yolo/v1]
        [--only-reviewed] [--seed 0] [--block-s SECONDS]

Consecutive frames are near-duplicates, so whole sessions (`images/<session>/`) go to one split; never
single frames. Sessions are assigned greedily, largest first, to the split furthest below its target
image count (val and test first get the session that best fits them). With fewer than 3 sessions that is
impossible, so each session is cut into contiguous time blocks (`--block-s`, default 60 s) instead.

Output: `<out>/images/{train,val,test}/<session>/…`, `<out>/labels/…`, `data.yaml`, `splits.json`.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from ..classes import CLASSES, NC
from ..yolo_io import (
    REVIEWED,
    data_dir,
    format_table,
    iter_images,
    label_path,
    link_or_copy,
    read_label_counts,
    read_set,
    write_atomic,
)

SPLITS = ("train", "val", "test")
RATIOS = (0.8, 0.1, 0.1)
MIN_INSTANCES = 80  # F4 target per class
DEFAULT_BLOCK_S = 60.0


def assign_splits(sizes: dict[str, int], ratios: tuple[float, ...] = RATIOS, seed: int = 0) -> dict[str, str]:
    """Group → split, hitting `ratios` by image count without ever splitting a group. Deterministic per seed."""
    groups = sorted(sizes)
    random.Random(seed).shuffle(groups)
    groups.sort(key=lambda g: -sizes[g])  # largest first; ties keep the seeded order
    total = sum(sizes.values())
    target = {s: r * total for s, r in zip(SPLITS, ratios, strict=True)}
    count = dict.fromkeys(SPLITS, 0)
    out: dict[str, str] = {}
    if len(groups) >= len(SPLITS):  # make sure val and test are not empty: give each its best-fitting group
        for s in sorted((s for s in SPLITS[1:] if target[s] > 0), key=lambda s: target[s]):
            g = min((g for g in groups if g not in out), key=lambda g: abs(sizes[g] - target[s]))
            out[g], count[s] = s, count[s] + sizes[g]
    for g in groups:
        if g not in out:
            s = max(SPLITS, key=lambda s: target[s] - count[s])
            out[g], count[s] = s, count[s] + sizes[g]
    return out


def frame_time_s(rel: str, fallback: float) -> float:
    """Capture time from '<epoch_ms>_<seq>.jpg' (see Session.after_frame); else the frame index."""
    head = Path(rel).stem.split("_")[0]
    return int(head) / 1000 if head.isdigit() else fallback


def time_blocks(rels: list[str], block_s: float) -> list[list[str]]:
    """Contiguous blocks of at most `block_s` seconds of capture (input in chronological order)."""
    blocks: list[list[str]] = []
    start = None
    for i, rel in enumerate(rels):
        t = frame_time_s(rel, float(i))
        if start is None or t - start >= block_s or t < start:
            blocks.append([])
            start = t
        blocks[-1].append(rel)
    return blocks


def make_groups(rels: list[str], block_s: float | None) -> dict[str, list[str]]:
    """Session folder → its images; cut into time blocks if asked or if there are fewer than 3 sessions."""
    sessions: dict[str, list[str]] = defaultdict(list)
    for rel in sorted(rels):
        sessions[rel.split("/")[0] if "/" in rel else "_"].append(rel)
    if block_s is None and len(sessions) >= len(SPLITS):
        return dict(sessions)
    block_s = block_s or DEFAULT_BLOCK_S
    if len(sessions) < len(SPLITS):
        print(
            f"AVISO: solo {len(sessions)} sesión(es); se dividen en bloques de {block_s:g} s para poder separar "
            "train/val/test. Mejor: capturar más sesiones.",
            file=sys.stderr,
        )
    return {
        f"{s}#{k:03d}": block for s, items in sessions.items() for k, block in enumerate(time_blocks(items, block_s))
    }


def build(src: Path, out: Path, only_reviewed: bool = False, seed: int = 0, block_s: float | None = None) -> dict:
    src, out = src.resolve(), out.resolve()
    if out == src or any(src.is_relative_to(out / d) for d in ("images", "labels")):
        raise SystemExit("--out no puede ser --src ni contenerlo")
    images_dir = src / "images"
    reviewed = read_set(src / REVIEWED)
    rels, unlabeled, unreviewed = [], 0, 0
    for img in iter_images(images_dir):
        rel = img.relative_to(images_dir).as_posix()
        if not label_path(src, rel).is_file():
            unlabeled += 1
        elif only_reviewed and rel not in reviewed:
            unreviewed += 1
        else:
            rels.append(rel)
    if not rels:
        raise SystemExit(f"No hay imágenes etiquetadas{' y revisadas' if only_reviewed else ''} en {src}")

    groups = make_groups(rels, block_s)
    split_of = assign_splits({g: len(v) for g, v in groups.items()}, seed=seed)
    for d in ("images", "labels"):
        shutil.rmtree(out / d, ignore_errors=True)
    inst = {s: [0] * NC for s in SPLITS}
    n_img = dict.fromkeys(SPLITS, 0)
    for g, items in groups.items():
        s = split_of[g]
        for rel in items:
            link_or_copy(images_dir / rel, out / "images" / s / rel)
            link_or_copy(label_path(src, rel), label_path(out, Path(s) / rel))
            inst[s] = [a + b for a, b in zip(inst[s], read_label_counts(label_path(src, rel)), strict=True)]
            n_img[s] += 1

    val = "images/val"
    if not n_img["val"]:
        print("AVISO: val quedó vacío; data.yaml usa train como val.", file=sys.stderr)
        val = "images/train"
    names = "".join(f"  {i}: {n}\n" for i, n in enumerate(CLASSES))
    write_atomic(
        out / "data.yaml",
        f"path: {json.dumps(str(out))}\ntrain: images/train\nval: {val}\ntest: images/test\nnc: {NC}\nnames:\n{names}",
    )
    summary = {
        "src": str(src),
        "seed": seed,
        "only_reviewed": only_reviewed,
        "groups": dict(sorted(split_of.items())),
        "images": n_img,
        "instances": {s: dict(zip(CLASSES, inst[s], strict=True)) for s in SPLITS},
        "skipped": {"unlabeled": unlabeled, "unreviewed": unreviewed},
    }
    write_atomic(out / "splits.json", json.dumps(summary, indent=1, ensure_ascii=False))
    return summary


def report(summary: dict) -> None:
    inst, n_img = summary["instances"], summary["images"]
    total_img = sum(n_img.values())
    rows = []
    for c in CLASSES:
        per = [inst[s][c] for s in SPLITS]
        rows.append([c, *per, sum(per)])
    rows.append(["TOTAL cajas", *[sum(inst[s].values()) for s in SPLITS], sum(sum(v.values()) for v in inst.values())])
    rows.append(["imágenes", *[n_img[s] for s in SPLITS], total_img])
    rows.append(["% imágenes", *[f"{100 * n_img[s] / total_img:.0f}%" for s in SPLITS], "100%"])
    n_groups = {s: sum(v == s for v in summary["groups"].values()) for s in SPLITS}
    rows.append(["grupos", *[n_groups[s] for s in SPLITS], sum(n_groups.values())])
    print(format_table(["clase", *SPLITS, "total"], rows))
    sk = summary["skipped"]
    if sk["unlabeled"] or sk["unreviewed"]:
        print(f"Omitidas: {sk['unlabeled']} sin etiqueta, {sk['unreviewed']} sin revisar")
    low = [r[0] for r in rows[:NC] if r[-1] < MIN_INSTANCES]
    if low:
        print(f"AVISO: menos de {MIN_INSTANCES} instancias en: {', '.join(low)} → capturar más (meta F4)")
    missing = [f"{c} ({s})" for c in CLASSES for s in ("val", "test") if n_img[s] and not inst[s][c]]
    if missing:
        print(f"AVISO: clases sin ejemplos en val/test: {', '.join(missing)}")
    for s, r in zip(SPLITS, RATIOS, strict=True):
        if abs(n_img[s] / total_img - r) > r / 2:
            print(f"AVISO: {s} tiene {100 * n_img[s] / total_img:.0f}% de las imágenes (meta {100 * r:.0f}%)")


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Arma el dataset YOLO (train/val/test por sesión) + data.yaml")
    ap.add_argument("--src", type=Path, default=data_dir() / "yolo" / "labeled")
    ap.add_argument("--out", type=Path, default=data_dir() / "yolo" / "v1")
    ap.add_argument("--only-reviewed", action="store_true", help="solo imágenes aceptadas en /review")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--block-s", type=float, default=None, help="cortar cada sesión en bloques de N s")
    args = ap.parse_args(argv)
    summary = build(args.src, args.out, args.only_reviewed, args.seed, args.block_s)
    report(summary)
    print(f"→ {args.out.resolve() / 'data.yaml'}")


if __name__ == "__main__":
    main()
