"""Trajectories over a task's automaton: correct runs, injected mistakes with their correction, and
noisy simulated perception.

A run is first built as a true timeline of `Segment`s (what the person really does, with idle gaps),
then sampled at the perception cadence: each sample is one `TrajectoryEvent` with the ground truth at
that instant and a noisy report of what was happening `delay` ms earlier.

Seeds: run `i` of base seed `s` uses `s * 1_000_003 + i` for its timeline, so the same run has the same
timeline (and split) at every noise level; the noise has its own stream.
"""

from __future__ import annotations

import random
from collections.abc import Iterator
from dataclasses import dataclass

from contracts import (
    MistakeKind,
    Ontology,
    Outcome,
    Quality,
    Split,
    Task,
    TaskAutomaton,
    Trajectory,
    TrajectoryEvent,
)

from .noise import NoiseParams, observe, similar_actions

SPLIT_WEIGHTS = ((Split.TRAIN, 0.8), (Split.VAL, 0.1), (Split.TEST, 0.1))
OBS_PERIOD_MS = (1000, 2000)  # perception cadence (one VLM answer every 1-2 s)
DEFAULT_STEP_S = 3.0
P_TRUNCATE = 0.1  # the run stops before the task is complete
MISTAKE_COUNT_WEIGHTS = (0.35, 0.4, 0.25)  # P(0, 1, 2 mistakes in a run)


@dataclass(frozen=True)
class Segment:
    """One stretch of the true timeline. `action=None` is idle."""

    start_ms: int
    end_ms: int
    action: str | None = None
    step: str | None = None
    quality: Quality = Quality.OK
    mistake_kind: MistakeKind | None = None
    mistake_id: str | None = None
    completes: str | None = None  # the step this segment completes (correct, legal, well done)


def run_seed(seed: int, index: int) -> int:
    return seed * 1_000_003 + index


def split_for(seed: int, index: int) -> Split:
    """Per run, never per event: every event of a run shares it."""
    r = random.Random(f"split-{seed}-{index}").random()
    acc = 0.0
    for split, weight in SPLIT_WEIGHTS:
        acc += weight
        if r < acc:
            return split
    return Split.TEST


def _step_ms(rng: random.Random, task: Task, step_id: str) -> int:
    step = task.step(step_id)
    base = max(DEFAULT_STEP_S, 1.5 * step.min_duration_s) if step.min_duration_s else DEFAULT_STEP_S
    return int(base * rng.uniform(0.7, 1.6) * 1000)


def _idle_ms(rng: random.Random) -> int:
    if rng.random() < 0.08:  # sometimes the person gets stuck (exercises reminders)
        return rng.randint(8_000, 25_000)
    return rng.randint(300, 3_000)


def _foreign_actions(task: Task) -> list[str]:
    """Task actions that complete no step: what a `wrong_action` can look like to perception."""
    step_actions = {s.action for s in task.steps}
    return [a for a in task.actions if a not in step_actions]


def true_timeline(task: Task, rng: random.Random) -> tuple[list[Segment], bool]:
    """Build one run's true timeline. Returns (segments, completed)."""
    automaton = TaskAutomaton(task)
    n_steps = len(task.steps)
    n_mistakes = rng.choices(range(len(MISTAKE_COUNT_WEIGHTS)), MISTAKE_COUNT_WEIGHTS)[0]
    mistake_at = {rng.randrange(n_steps): rng.choice(list(MistakeKind)) for _ in range(n_mistakes)}
    stop_after = rng.randrange(1, n_steps) if n_steps > 1 and rng.random() < P_TRUNCATE else None

    segments: list[Segment] = []
    done: frozenset[str] = automaton.start
    t = rng.randint(500, 2_500)
    forced: str | None = None  # after an `incomplete`, the same step is redone

    def add(duration: int, **fields) -> None:
        nonlocal t
        segments.append(Segment(start_ms=t, end_ms=t + duration, **fields))
        t += duration + _idle_ms(rng)

    while not automaton.is_complete(done):
        position = len(done)
        if stop_after is not None and position >= stop_after:
            break
        kind = mistake_at.pop(position, None)
        if kind is not None and forced is None:
            injected = _inject(task, automaton, done, kind, rng)
            if injected is not None:
                fields, duration = injected
                add(duration, **fields)
                if fields["mistake_kind"] is MistakeKind.INCOMPLETE:
                    forced = fields["step"]
                continue  # the correction: the run goes on with a legal step
        legal = automaton.legal_next(done)
        step_id = forced or rng.choice(legal)
        forced = None
        transition = automaton.apply(done, task.step(step_id).action)
        assert transition.outcome is not Outcome.MISTAKE, (step_id, done)
        add(_step_ms(rng, task, step_id), action=task.step(step_id).action, step=step_id, completes=step_id)
        done = transition.done

    if segments:  # trailing idle so the last action is observed for a while
        segments.append(Segment(start_ms=segments[-1].end_ms, end_ms=segments[-1].end_ms + 3_000))
    return segments, automaton.is_complete(done)


def _inject(
    task: Task, automaton: TaskAutomaton, done: frozenset[str], kind: MistakeKind, rng: random.Random
) -> tuple[dict, int] | None:
    """Segment fields and duration for a mistake of `kind` in state `done`, or None when infeasible."""
    legal = automaton.legal_next(done)
    if kind is MistakeKind.INCOMPLETE:
        preferred = [
            s
            for s in legal
            if automaton.mistake_for(s, kind) is not None or task.step(s).min_duration_s is not None
        ]
        step_id = rng.choice(preferred or legal)
        mistake = automaton.mistake_for(step_id, kind)
        fields = dict(
            action=task.step(step_id).action,
            step=step_id,
            quality=Quality.BAD,
            mistake_kind=kind,
            mistake_id=mistake.id if mistake else None,
        )
        return fields, rng.randint(1_500, 2_500)  # too short / partial, but visible to perception

    if kind is MistakeKind.OUT_OF_ORDER:
        candidates = [s.action for s in task.steps if s.id not in done and s.id not in legal]
    elif kind is MistakeKind.REPEATED:
        candidates = [s.action for s in task.steps if s.id in done]
    else:  # wrong_action: the task's forbidden actions that fit now first, then any foreign action
        contextual = [m.action for m in task.mistakes if m.kind is kind and m.step in legal]
        candidates = contextual or _foreign_actions(task)
    if not candidates:
        return None
    action = rng.choice(candidates)
    transition = automaton.apply(done, action)
    assert transition.kind is kind, (action, kind, transition)
    fields = dict(
        action=action,
        step=transition.step,
        mistake_kind=kind,
        mistake_id=transition.mistake.id if transition.mistake else None,
    )
    return fields, int(DEFAULT_STEP_S * rng.uniform(0.5, 1.2) * 1000)


def _at(segments: list[Segment], t: int) -> Segment | None:
    for seg in segments:
        if seg.start_ms <= t < seg.end_ms:
            return seg if seg.action is not None else None
    return None


def generate_run(
    task: Task,
    seed: int,
    index: int,
    noise: NoiseParams,
    ontology: Ontology | None = None,
    noise_label: str = "custom",
) -> Trajectory:
    rs = run_seed(seed, index)
    segments, completed = true_timeline(task, random.Random(rs))
    nrng = random.Random(f"noise-{rs}-{noise_label}")
    similar = similar_actions(task, ontology)
    end = segments[-1].end_ms if segments else 3_000
    events: list[TrajectoryEvent] = []
    t = nrng.randint(*OBS_PERIOD_MS)
    while t < end:
        truth = _at(segments, t)
        seen = _at(segments, max(0, t - int(nrng.uniform(0, noise.delay_ms))))
        observed, confidence, quality = observe(
            nrng,
            seen.action if seen else None,
            seen.quality if seen else Quality.OK,
            noise,
            task,
            similar,
        )
        events.append(
            TrajectoryEvent(
                t_ms=t,
                true_action=truth.action if truth else None,
                observed_action=observed,
                observed_confidence=confidence,
                observed_quality=quality,
                step=truth.step if truth else None,
                mistake_kind=truth.mistake_kind if truth else None,
                mistake_id=truth.mistake_id if truth else None,
            )
        )
        t += nrng.randint(*OBS_PERIOD_MS)
    return Trajectory(
        id=f"{task.id}_{noise_label}_s{seed}_{index:06d}",
        task_id=task.id,
        task_version=task.version,
        seed=rs,
        split=split_for(seed, index),
        noise=noise.as_dict(),
        events=tuple(events),
        completed=completed,
    )


def generate_trajectories(
    task: Task,
    n: int,
    seed: int,
    levels: dict[str, NoiseParams],
    ontology: Ontology | None = None,
) -> Iterator[Trajectory]:
    """`n` runs; with several levels, each run gets one level picked per run (a training mix)."""
    names = sorted(levels)
    for i in range(n):
        label = names[0] if len(names) == 1 else random.Random(f"level-{seed}-{i}").choice(names)
        yield generate_run(task, seed, i, levels[label], ontology, label)
