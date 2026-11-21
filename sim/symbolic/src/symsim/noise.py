"""Simulated perception noise: what a video-language model gets wrong.

Each observation reports the action that was happening `delay` ms earlier (so an ongoing action is
reported several times, and late), then the noise below is applied in order.
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass

from contracts import Ontology, Quality, Task


@dataclass(frozen=True)
class NoiseParams:
    drop: float = 0.0  # a real action is reported as null (missed detection)
    confuse: float = 0.0  # a real action is reported as a similar action
    spurious: float = 0.0  # idle is reported as some task action (hallucination)
    uncertain: float = 0.0  # any report becomes null (model unsure / invalid JSON)
    delay_ms: float = 0.0  # max report delay; each observation's delay is uniform in [0, delay_ms]
    quality_miss: float = 0.0  # a badly done action is reported with quality ok
    quality_false: float = 0.0  # a well done action is reported with quality bad

    def as_dict(self) -> dict[str, float]:
        return {k: float(v) for k, v in asdict(self).items()}


NOISE_LEVELS: dict[str, NoiseParams] = {
    "clean": NoiseParams(),
    "low": NoiseParams(0.05, 0.03, 0.02, 0.03, 500, 0.1, 0.01),
    "medium": NoiseParams(0.15, 0.08, 0.05, 0.08, 1200, 0.25, 0.03),
    "high": NoiseParams(0.3, 0.15, 0.1, 0.15, 2500, 0.4, 0.06),
}


def similar_actions(task: Task, ontology: Ontology | None) -> dict[str, list[str]]:
    """Actions perception is likely to mix up: same verb or object in the ontology; without an
    ontology, the actions of neighbouring steps. Restricted to the task's action set."""
    similar: dict[str, list[str]] = {}
    if ontology is not None:
        defs = {a.id: a for a in ontology.actions if a.id in task.actions}
        for a in task.actions:
            mine = defs[a]
            similar[a] = [
                b
                for b in task.actions
                if b != a and (defs[b].verb == mine.verb or (mine.object and defs[b].object == mine.object))
            ]
    else:
        order = [s.action for s in task.steps]
        for a in task.actions:
            if a in order:
                i = order.index(a)
                similar[a] = [order[j] for j in (i - 1, i + 1) if 0 <= j < len(order)]
            else:
                similar[a] = []
    for a, others in similar.items():
        if not others:  # fall back to any other action so `confuse` always has somewhere to go
            similar[a] = [b for b in task.actions if b != a]
    return similar


def observe(
    rng: random.Random,
    true_action: str | None,
    true_quality: Quality,
    params: NoiseParams,
    task: Task,
    similar: dict[str, list[str]],
) -> tuple[str | None, float, Quality]:
    """One noisy report of `true_action`: (observed_action, confidence, quality)."""
    action = true_action
    correct = True
    if action is not None and rng.random() < params.drop:
        action = None
    elif action is not None and rng.random() < params.confuse:
        action, correct = rng.choice(similar[action]), False
    elif action is None and rng.random() < params.spurious:
        action, correct = rng.choice(task.actions), False
    if action is not None and rng.random() < params.uncertain:
        action = None

    if action is None:
        return None, round(rng.uniform(0.0, 0.45), 3), Quality.UNKNOWN
    # Wrong reports tend to come with lower confidence, but the ranges overlap.
    confidence = rng.uniform(0.6, 0.99) if correct else rng.uniform(0.35, 0.9)
    if not correct:
        quality = Quality.OK if rng.random() > params.quality_false else Quality.BAD
    elif true_quality is Quality.BAD:
        quality = Quality.OK if rng.random() < params.quality_miss else Quality.BAD
    else:
        quality = Quality.BAD if rng.random() < params.quality_false else Quality.OK
    return action, round(confidence, 3), quality
