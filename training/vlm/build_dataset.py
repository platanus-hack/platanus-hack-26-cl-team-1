"""Recorded sessions (F7) → chat examples for the VLM fine-tuning (F8).

    cd ~/cv/app/vision && .venv/bin/python ../training/vlm/build_dataset.py \
        --sessions ~/cv/data/vlm/sessions --out ~/cv/data/vlm/v1 [--test-sessions 2]

Every example is exactly what production sends (vision/vision/vlm_prompt.py): the full frame,
the 2x crop with the expected holes drawn, the step JSON and an optional suspicion; the target
is the strict JSON verdict with a Chilean-Spanish `mensaje` from vision/vision/messages.py.

Labels (no model in the loop):
  error  frames inside an operator error interval [inserted + 0.5 s, fixed − 0.5 s] → that step, that kind
  ok     frames where a step is already `done` (operator said so) and no error is active
  Frames of the step in progress are skipped (part may or may not be in place yet).
Anti-sycophancy: half the ok examples carry a FALSE suspicion (target stays ok); half the error
examples carry the true one. Balanced ~50/50 ok/error, split by session.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "vision"))

from vision import messages as M  # noqa: E402
from vision.assembly import step_info  # noqa: E402
from vision.expected import Expected, build_expected  # noqa: E402
from vision.mat import hole_grid  # noqa: E402
from vision.vlm_prompt import SYSTEM, make_crop, user_text  # noqa: E402

SUSPICION = {
    "missing": "falta la pieza",
    "wrong_hole": "la pieza parece corrida a otra columna",
    "led_reversed": "la polaridad podría estar al revés",
    "wrong_part": "parece otra pieza u otro color",
    "wire_wrong_end": "un extremo del cable parece estar en otro lugar",
    "extra_part": "parece que sobra una pieza en esa zona",
}
MARGIN_S = 0.5


@dataclass
class Example:
    session: str
    t: float
    step: int
    frame: Path
    H: list[float]
    estado: str
    tipo: str
    suspected: str | None = None


def load_session(d: Path) -> tuple[dict, list[dict]]:
    hello = json.loads((d / "hello.json").read_text())
    tl = [json.loads(x) for x in (d / "timeline.jsonl").read_text().splitlines() if x.strip()]
    return hello, sorted(tl, key=lambda r: r["t"])


def label_session(d: Path, exp: Expected, tl: list[dict]) -> list[Example]:
    status: dict[str, str] = {}
    error: dict | None = None  # {"t0", "step", "kind"}
    intervals: list[tuple[float, float, int, str]] = []
    frames = []
    for r in tl:
        if r["type"] == "step":
            status = r["status"]
            if error and r["current"] != error["step"]:  # moved on: close the error interval
                intervals.append((error["t0"], r["t"], error["step"], error["kind"]))
                error = None
        elif r["type"] == "label":
            if r["kind"] == "error_inserted":
                if error:
                    intervals.append((error["t0"], r["t"], error["step"], error["kind"]))
                error = {"t0": r["t"], "step": r["step"], "kind": r["error"]}
            elif r["kind"] == "error_fixed" and error:
                intervals.append((error["t0"], r["t"], error["step"], error["kind"]))
                error = None
        elif r["type"] == "frame" and r.get("calibrated") and r.get("H"):
            frames.append((r, dict(status)))
    if error:
        intervals.append((error["t0"], float("inf"), error["step"], error["kind"]))

    out: list[Example] = []
    for r, st in frames:
        t = r["t"]
        active = [iv for iv in intervals if iv[0] + MARGIN_S <= t <= iv[1] - MARGIN_S]
        blocked = [iv for iv in intervals if iv[0] - MARGIN_S < t < iv[1] + MARGIN_S]
        if active:
            _, _, step, kind = active[-1]
            out.append(Example(d.name, t, step, d / r["file"], r["H"], "error", kind))
            continue
        if blocked:  # too close to an error boundary: ambiguous
            continue
        done = [int(k) for k, v in st.items() if v == "done" and exp.step(int(k)) and exp.step(int(k)).visual]
        if done:
            out.append(Example(d.name, t, max(done), d / r["file"], r["H"], "ok", "ninguno"))
    return out


def holes_px(H: np.ndarray, holes: list[str]) -> dict[str, tuple[float, float]]:
    out = {}
    for h in holes:
        g = hole_grid(h)
        if g:
            p = H @ np.array([g[0], g[1], 1.0])
            out[h] = (float(p[0] / p[2]), float(p[1] / p[2]))
    return out


def pitch(H: np.ndarray) -> float:
    a = H @ np.array([16.0, 9.0, 1.0])
    b = H @ np.array([17.0, 9.0, 1.0])
    return float(np.hypot(*(b[:2] / b[2] - a[:2] / a[2])))


def render(ex: Example, exp: Expected, steps_raw: dict[int, dict], img_dir: Path, rng: random.Random) -> dict | None:
    step = exp.step(ex.step)
    if step is None:
        return None
    img = cv2.imread(str(ex.frame))
    if img is None:
        return None
    H = np.array(ex.H, dtype=np.float64).reshape(3, 3)
    crop = make_crop(img, holes_px(H, step.holes), pitch(H))
    stem = f"{ex.session}_{int(ex.t * 1000)}_{ex.step}"
    frame_p, crop_p = img_dir / f"{stem}_f.jpg", img_dir / f"{stem}_c.jpg"
    cv2.imwrite(str(frame_p), img, [cv2.IMWRITE_JPEG_QUALITY, 80])
    cv2.imwrite(str(crop_p), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
    info = step_info(exp, step, steps_raw.get(ex.step, {}))
    if ex.estado == "error":
        mensaje = M.issue_line(ex.tipo, exp, step, rng=rng)
    else:
        mensaje = M.ok_line(exp, step, rng=rng)
    target = {"estado": ex.estado, "tipo": ex.tipo, "componente": M.component(exp, step)[:40], "mensaje": mensaje}
    return {
        "id": stem,
        "session": ex.session,
        "step": ex.step,
        "images": [str(frame_p), str(crop_p)],
        "system": SYSTEM,
        "user": user_text(info, ex.suspected),
        "suspected": ex.suspected,
        "target": json.dumps(target, ensure_ascii=False),
        "estado": ex.estado,
        "tipo": ex.tipo,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sessions", required=True, nargs="+", help="session dirs or parents of them")
    ap.add_argument("--out", required=True)
    ap.add_argument("--test-sessions", type=int, default=2)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--max-per-session", type=int, default=400)
    a = ap.parse_args()
    rng = random.Random(a.seed)

    dirs: list[Path] = []
    for s in map(Path, a.sessions):
        dirs += (
            [s]
            if (s / "timeline.jsonl").exists()
            else sorted(p for p in s.iterdir() if (p / "timeline.jsonl").exists())
        )
    if not dirs:
        raise SystemExit("no hay sesiones grabadas")

    per_session: dict[str, list[dict]] = defaultdict(list)
    out = Path(a.out)
    img_dir = out / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    for d in dirs:
        hello, tl = load_session(d)
        exp = build_expected(hello)
        raw = {s["index"]: s for s in hello["steps"]}
        exs = label_session(d, exp, tl)
        # every error frame twice: with the true suspicion (issue_candidate) and without (step_candidate)
        errors = []
        for e in (x for x in exs if x.estado == "error"):
            errors += [e, Example(**{**e.__dict__, "suspected": SUSPICION[e.tipo]})]
        oks = [e for e in exs if e.estado == "ok"]
        rng.shuffle(oks)
        oks = oks[: max(len(errors), 1)]  # balance ~50/50 inside every session
        for e in oks:
            e.suspected = SUSPICION[rng.choice(list(SUSPICION))] if rng.random() < 0.5 else None
        chosen = errors + oks
        rng.shuffle(chosen)
        for e in chosen[: a.max_per_session]:
            rec = render(e, exp, raw, img_dir, rng)
            if rec:
                per_session[d.name].append(rec)

    names = sorted(per_session)
    with_errors = [n for n in names if any(r["estado"] == "error" for r in per_session[n])]
    rng.shuffle(with_errors)
    test = set(with_errors[: a.test_sessions]) if len(names) > a.test_sessions else set()
    splits = {
        "train": [r for n in names if n not in test for r in per_session[n]],
        "test": [r for n in sorted(test) for r in per_session[n]],
    }
    for split, recs in splits.items():
        with (out / f"{split}.jsonl").open("w", encoding="utf-8") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"sesiones: {len(names)} (test: {', '.join(sorted(test)) or '—'})")
    for split, recs in splits.items():
        c = Counter(r["tipo"] for r in recs)
        print(
            f"{split}: {len(recs)} ejemplos · ok {c.pop('ninguno', 0)} · "
            + " · ".join(f"{k} {v}" for k, v in sorted(c.items()))
        )
    print(f"→ {out}")


if __name__ == "__main__":
    main()
