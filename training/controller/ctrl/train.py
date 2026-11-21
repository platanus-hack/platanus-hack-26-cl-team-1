"""Train the learned controller for one task and export it for the server.

uv run python -m ctrl.train --task ../../tasks/hand_hygiene/hand_hygiene_basic.json

Generates simulator runs (all noise levels mixed, split per run), trains on `train`, picks the decision
thresholds on `val`, and writes `training/controller/weights/<task_id>.npz` (numpy arrays + metadata),
which `server/app/controller/learned.py` loads. CPU, a few minutes.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import torch
from app.controller.learned import FEATURES_VERSION, MISTAKE_CLASSES, LearnedController, feature_size
from contracts import Split
from symsim import NOISE_LEVELS, generate_trajectories
from symsim.cli import load_task
from torch import nn

from . import WEIGHTS_DIR
from .data import encode
from .evaluate import DEFAULT_SEED, eval_runs, evaluate
from .model import ControllerNet

MISTAKE_WEIGHT = 4.0  # mistakes are rare events: up-weight them in the loss
THRESHOLDS = (0.3, 0.4, 0.5, 0.6, 0.7, 0.8)


def _batches(data, batch_size: int, rng: np.random.Generator):
    order = rng.permutation(len(data))
    for start in range(0, len(order), batch_size):
        chunk = [data[i] for i in order[start : start + batch_size]]
        t_max = max(len(x) for x, _, _ in chunk)
        f, s = chunk[0][0].shape[1], chunk[0][1].shape[1]
        x = np.zeros((len(chunk), t_max, f), np.float32)
        y = np.zeros((len(chunk), t_max, s), np.float32)
        m = np.full((len(chunk), t_max), -100, np.int64)  # -100: ignored by cross_entropy
        mask = np.zeros((len(chunk), t_max), np.float32)
        for b, (xi, yi, mi) in enumerate(chunk):
            n = len(xi)
            x[b, :n], y[b, :n], m[b, :n], mask[b, :n] = xi, yi, mi, 1.0
        yield torch.from_numpy(x), torch.from_numpy(y), torch.from_numpy(m), torch.from_numpy(mask)


def export(model: ControllerNet, task, path: Path, done_t: float, mistake_t: float, extra: dict) -> None:
    meta = {
        "features_version": FEATURES_VERSION,
        "task_id": task.id,
        "task_version": task.version,
        "actions": list(task.actions),
        "steps": [s.id for s in task.steps],
        "mistake_classes": [k.value if k else None for k in MISTAKE_CLASSES],
        "done_threshold": done_t,
        "mistake_threshold": mistake_t,
        **extra,
    }
    arrays = {k: v.detach().numpy().astype(np.float32) for k, v in model.state_dict().items()}
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, meta=np.array(json.dumps(meta)), **arrays)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--task", type=Path, required=True)
    parser.add_argument("--n", type=int, default=6000, help="simulated runs (all splits)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--hidden", type=int, default=64)
    parser.add_argument("--out", type=Path, default=WEIGHTS_DIR)
    args = parser.parse_args(argv)

    torch.manual_seed(args.seed)
    rng = np.random.default_rng(args.seed)
    task, ontology = load_task(args.task)
    began = time.time()
    runs = list(generate_trajectories(task, args.n, args.seed, NOISE_LEVELS, ontology))
    train = [encode(task, t) for t in runs if t.split is Split.TRAIN]
    print(f"{len(train)} train runs, {sum(len(x) for x, _, _ in train)} observations")

    model = ControllerNet(feature_size(task), len(task.steps), len(MISTAKE_CLASSES), args.hidden)
    optimizer = torch.optim.Adam(model.parameters(), lr=3e-3)
    class_weights = torch.tensor([1.0] + [MISTAKE_WEIGHT] * (len(MISTAKE_CLASSES) - 1))
    for epoch in range(args.epochs):
        total, count = 0.0, 0
        for x, y, m, mask in _batches(train, 32, rng):
            done_logits, mistake_logits = model(x)
            done_loss = (
                nn.functional.binary_cross_entropy_with_logits(done_logits, y, reduction="none").mean(-1)
                * mask
            ).sum() / mask.sum()
            mistake_loss = nn.functional.cross_entropy(
                mistake_logits.reshape(-1, len(MISTAKE_CLASSES)), m.reshape(-1), weight=class_weights
            )
            loss = done_loss + mistake_loss
            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total, count = total + loss.item(), count + 1
        print(f"epoch {epoch + 1}/{args.epochs} loss {total / count:.4f}")

    # Thresholds on the val split (medium noise), by mistake F1 then step tracking.
    path = args.out / f"{task.id}.npz"
    val = eval_runs(task, ontology, "medium", args.seed, args.n, split="val")
    best = None
    for mistake_t in THRESHOLDS:
        export(model, task, path, 0.5, mistake_t, {})
        row = evaluate(lambda: LearnedController(args.out), task, val).row()
        key = (round(row["f1"], 3), row["step_acc"])
        print(f"val mistake_threshold={mistake_t}: f1 {row['f1']:.3f} step_acc {row['step_acc']:.3f}")
        if best is None or key > best[0]:
            best = (key, mistake_t)
    extra = {"seed": args.seed, "runs": args.n, "epochs": args.epochs, "hidden": args.hidden}
    export(model, task, path, 0.5, best[1], extra)
    print(f"wrote {path} (mistake_threshold={best[1]}) in {time.time() - began:.0f}s")


if __name__ == "__main__":
    main()
