"""Learned controller (owner: Cote): a tiny GRU trained from scratch on simulator trajectories.

Training lives in `training/controller/` (PyTorch); the server only runs this numpy forward pass on
exported weights (`<weights_dir>/<task_id>.npz`), so `server/` doesn't depend on torch.

Per observation the network sees the noisy perception output (and the time since the previous one) and
predicts:

- `p_done[s]`: step `s` has really been done by now;
- `p_mistake[k]`: a mistake of kind `k` (or none) is happening now.

Outputs are restricted to the task: a step is marked done only when it is legal next, so the state is
always a valid automaton state, and mistakes are attributed through the automaton. A step is also marked
done only after a confident perception report since the last advance (`armed`): otherwise the GRU's time
prior alone (only null observations) drifts `p_done` past the threshold and completes the first step with
nothing in view. Texts, statuses, reminders and "ya lo hice" are the rule controller's, so both emit the
same `Decision`s.

`features()` is the single definition of the input encoding: training imports it from here.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from contracts import (
    Decision,
    Event,
    MistakeKind,
    Observation,
    Quality,
    SayRequest,
    Task,
)

from .rules import RulesController

FEATURES_VERSION = 1
MISTAKE_CLASSES: tuple[MistakeKind | None, ...] = (None, *MistakeKind)
QUALITIES = tuple(Quality)
DT_SCALE_S = 5.0


def feature_size(task: Task) -> int:
    return (len(task.actions) + 1) + 1 + len(QUALITIES) + 1 + 1


def features(
    task: Task, action: str | None, confidence: float, quality: Quality, dt_ms: int, prev_action: str | None
) -> np.ndarray:
    """One input vector: the perception output only, no controller state.

    Feeding the controller's own state (done/legal steps) made the model trust it: trained on the true
    state, it compounded its own tracking errors at inference (exposure bias), and measured worse under
    noise. The GRU tracks progress from the observation history instead; legality is enforced on its
    outputs.
    """
    a = len(task.actions)
    x = np.zeros(feature_size(task), dtype=np.float32)
    x[task.actions.index(action) if action is not None else a] = 1.0
    i = a + 1
    x[i] = confidence
    x[i + 1 + QUALITIES.index(quality)] = 1.0
    i += 1 + len(QUALITIES)
    x[i] = min(dt_ms / 1000.0, 4 * DT_SCALE_S) / DT_SCALE_S  # feature scale: long gaps all look "long"
    x[i + 1] = action is not None and action == prev_action
    return x


def _sigmoid(v: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-v))


class GruModel:
    """Numpy forward pass of `training/controller`'s model: Linear+tanh → GRU (PyTorch gate order
    r, z, n) → heads `done` (sigmoid per step) and `mistake` (softmax over MISTAKE_CLASSES)."""

    def __init__(self, arrays: dict[str, np.ndarray]) -> None:
        self.w = {k: v.astype(np.float64) for k, v in arrays.items()}
        self.hidden = self.w["gru.weight_hh_l0"].shape[1]

    def step(self, x: np.ndarray, h: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        w = self.w
        e = np.tanh(w["embed.weight"] @ x + w["embed.bias"])
        gi = w["gru.weight_ih_l0"] @ e + w["gru.bias_ih_l0"]
        gh = w["gru.weight_hh_l0"] @ h + w["gru.bias_hh_l0"]
        n_h = self.hidden
        r = _sigmoid(gi[:n_h] + gh[:n_h])
        z = _sigmoid(gi[n_h : 2 * n_h] + gh[n_h : 2 * n_h])
        n = np.tanh(gi[2 * n_h :] + r * gh[2 * n_h :])
        h = (1.0 - z) * n + z * h
        p_done = _sigmoid(w["done.weight"] @ h + w["done.bias"])
        logits = w["mistake.weight"] @ h + w["mistake.bias"]
        p_mistake = np.exp(logits - logits.max())
        return h, p_done, p_mistake / p_mistake.sum()


class LearnedWeights:
    """Weights + metadata for one task, as exported by `training/controller`."""

    def __init__(self, path: Path) -> None:
        with np.load(path) as data:
            self.meta = json.loads(str(data["meta"]))
            self.model = GruModel({k: data[k] for k in data.files if k != "meta"})
        self.path = path

    def check(self, task: Task) -> None:
        m = self.meta
        expected = {
            "features_version": FEATURES_VERSION,
            "task_id": task.id,
            "task_version": task.version,
            "actions": list(task.actions),
            "steps": [s.id for s in task.steps],
        }
        wrong = {k: (m.get(k), v) for k, v in expected.items() if m.get(k) != v}
        if wrong:
            raise ValueError(f"weights {self.path} don't match task {task.id!r} (got, expected): {wrong}")


class LearnedController(RulesController):
    def __init__(self, weights_dir: Path, **kwargs) -> None:
        super().__init__(**kwargs)
        self.weights_dir = weights_dir

    def start(self, task: Task) -> Decision:
        path = self.weights_dir / f"{task.id}.npz"
        if not path.exists():
            raise FileNotFoundError(
                f"no learned-controller weights for task {task.id!r} at {path}: "
                f"train them (training/controller) or use SUP_CONTROLLER=rules"
            )
        self.weights = LearnedWeights(path)
        self.weights.check(task)
        self.done_threshold = float(self.weights.meta["done_threshold"])
        self.mistake_threshold = float(self.weights.meta["mistake_threshold"])
        self.h = np.zeros(self.weights.model.hidden)
        self.prev_t_ms: int | None = None
        self.prev_action: str | None = None
        self.armed = False  # a confident report since the last advance; advancing needs one
        return super().start(task)

    def decide(self, observation: Observation) -> Decision:
        self.seq = observation.seq
        out = observation.output
        dt = 0 if self.prev_t_ms is None else max(0, observation.t_ms - self.prev_t_ms)
        x = features(self.task, out.action, out.confidence, out.quality, dt, self.prev_action)
        self.prev_t_ms, self.prev_action = observation.t_ms, out.action
        self.h, p_done, p_mistake = self.weights.model.step(x, self.h)
        if self.automaton.is_complete(self.done):
            return self._decision(Event.NONE)
        if out.action is not None and out.confidence >= self.min_confidence:
            self.armed = True

        # Mark done every legal step the model believes is done (in task order, re-checking legality),
        # but only on the back of a confident report: never from the time prior alone.
        index = {s.id: j for j, s in enumerate(self.task.steps)}
        advanced: str | None = None
        progress = self.armed
        while progress:
            progress = False
            for step_id in self.automaton.legal_next(self.done):
                if p_done[index[step_id]] >= self.done_threshold:
                    self.done = self.automaton.apply(self.done, self.task.step(step_id).action).done
                    advanced, progress = step_id, True
                    break
        if advanced is not None:
            self.armed = False
            self.mistake_step = None
            self.open_mistake = None
            self.last_progress_ms = observation.t_ms
            if self.automaton.is_complete(self.done):
                return self._decision(
                    Event.TASK_DONE, step=advanced, say=SayRequest(text="¡Listo! Terminaste la tarea.")
                )
            nxt = self.task.step(self.automaton.legal_next(self.done)[0])
            return self._decision(
                Event.STEP_DONE, step=advanced, say=SayRequest(text=f"Bien. {nxt.instruction_es}")
            )

        k = int(np.argmax(p_mistake))
        kind = MISTAKE_CLASSES[k]
        if kind is None or p_mistake[k] < self.mistake_threshold:
            return self._decision(Event.NONE)
        return self._learned_mistake(kind, out.action)

    def _learned_mistake(self, kind: MistakeKind, action: str | None) -> Decision:
        """Attribute a predicted mistake through the automaton (step, the task's MistakeDef, text)."""
        transition = self.automaton.apply(self.done, action) if action is not None else None
        if transition is not None and transition.kind is kind:
            mistake_id = transition.mistake.id if transition.mistake else None
            return self._mistake(transition.step, kind, mistake_id, self._correction_text(transition))
        if kind is MistakeKind.INCOMPLETE:
            legal = self.automaton.legal_next(self.done)
            step = transition.step if transition is not None and transition.step in legal else legal[0]
            mistake = self.automaton.mistake_for(step, kind)
            text = mistake.correction_es if mistake else "Ojo, hazlo con más cuidado y repítelo."
            return self._mistake(step, kind, mistake.id if mistake else None, text)
        step = transition.step if transition is not None else None
        mistake = self.automaton.mistake_for(step, kind) if step is not None else None
        nxt = self.task.step(self.automaton.legal_next(self.done)[0])
        text = mistake.correction_es if mistake else f"Ojo, eso no va ahora. {nxt.instruction_es}"
        return self._mistake(step, kind, mistake.id if mistake else None, text)
