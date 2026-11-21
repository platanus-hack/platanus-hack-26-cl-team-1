"""Trajectories → training tensors."""

from __future__ import annotations

import numpy as np
from app.controller.learned import MISTAKE_CLASSES, features
from contracts import Task, Trajectory


def true_done_after(task: Task, trajectory: Trajectory) -> list[frozenset[str]]:
    """The true set of done steps after each event: a step is done once its action is really happening
    without a mistake (the simulator only produces those when the step is legal)."""
    by_action = {s.action: s.id for s in task.steps}
    done: set[str] = set()
    out = []
    for e in trajectory.events:
        if e.true_action in by_action and e.mistake_kind is None:
            done.add(by_action[e.true_action])
        out.append(frozenset(done))
    return out


def encode(task: Task, trajectory: Trajectory) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(X [T, F], done targets [T, S], mistake class [T])."""
    after = true_done_after(task, trajectory)
    xs, ys, ms = [], [], []
    prev_t, prev_action = None, None
    for i, e in enumerate(trajectory.events):
        dt = 0 if prev_t is None else e.t_ms - prev_t
        xs.append(
            features(
                task,
                e.observed_action,
                e.observed_confidence,
                e.observed_quality,
                dt,
                prev_action,
            )
        )
        prev_t, prev_action = e.t_ms, e.observed_action
        ys.append([s.id in after[i] for s in task.steps])
        ms.append(MISTAKE_CLASSES.index(e.mistake_kind))
    return np.stack(xs), np.asarray(ys, dtype=np.float32), np.asarray(ms, dtype=np.int64)
