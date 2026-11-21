"""Compare controllers on simulator test runs at several noise levels.

uv run python -m ctrl.evaluate --task ../../tasks/hand_hygiene/hand_hygiene_basic.json

Writes `training/results/controller.md`. Every number there comes from this script.

Metrics (per noise level, over the test split):
- step tracking: share of observations after which the controller's done set equals the true one;
- mistakes: a true mistake instance is a run of consecutive events with the same (kind, step) label. A
  `mistake` decision detects it when it comes during the instance or up to GRACE_EVENTS observations
  after it (perception reports late). Precision counts non-duplicate mistake decisions that detect an
  instance; a decision that detects nothing is a false alarm;
- detection delay: decision time minus instance start, over detected instances.
"""

from __future__ import annotations

import argparse
import statistics
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from app.controller.learned import LearnedController
from app.controller.rules import RulesController
from contracts import (
    Controller,
    Event,
    MistakeKind,
    Observation,
    Source,
    StepStatus,
    Task,
    Trajectory,
    VlmOutput,
)
from symsim import NOISE_LEVELS, generate_run
from symsim.cli import load_task
from symsim.generate import split_for

from . import RESULTS_DIR, WEIGHTS_DIR
from .data import true_done_after

GRACE_EVENTS = 2
DEFAULT_SEED = 0  # same base seed as training: test runs are the indices whose split is `test`


def split_indices(seed: int, n: int, split: str = "test") -> list[int]:
    return [i for i in range(n) if split_for(seed, i).value == split]


@dataclass
class Metrics:
    events: int = 0
    tracked: int = 0
    final_ok: int = 0
    runs: int = 0
    instances: Counter = field(default_factory=Counter)  # kind → count
    detected: Counter = field(default_factory=Counter)
    decisions: int = 0
    true_positives: int = 0
    duplicates: int = 0
    false_alarms: int = 0
    delays_ms: list[int] = field(default_factory=list)
    minutes: float = 0.0

    def row(self) -> dict[str, float]:
        n_inst = sum(self.instances.values())
        n_det = sum(self.detected.values())
        counted = self.decisions - self.duplicates
        precision = self.true_positives / counted if counted else 0.0
        recall = n_det / n_inst if n_inst else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        return {
            "step_acc": self.tracked / self.events if self.events else 0.0,
            "final_ok": self.final_ok / self.runs if self.runs else 0.0,
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "fa_per_run": self.false_alarms / self.runs if self.runs else 0.0,
            "fa_per_min": self.false_alarms / self.minutes if self.minutes else 0.0,
            "delay_ms": statistics.median(self.delays_ms) if self.delays_ms else float("nan"),
        }


def _observation(i: int, e) -> Observation:
    output = VlmOutput(action=e.observed_action, confidence=e.observed_confidence, quality=e.observed_quality)
    return Observation(seq=i, t_ms=e.t_ms, source=Source.SIM, model="symsim", latency_ms=0, output=output)


def _instances(trajectory: Trajectory) -> list[tuple[int, int, MistakeKind]]:
    """(first event, last event, kind) of each true mistake instance."""
    out: list[tuple[int, int, MistakeKind]] = []
    prev = None
    for i, e in enumerate(trajectory.events):
        key = (e.mistake_kind, e.step) if e.mistake_kind is not None else None
        if key is not None and key == prev:
            out[-1] = (out[-1][0], i, out[-1][2])
        elif key is not None:
            out.append((i, i, e.mistake_kind))
        prev = key
    return out


def score_run(controller: Controller, task: Task, trajectory: Trajectory, m: Metrics) -> None:
    controller.start(task)
    truth = true_done_after(task, trajectory)
    instances = _instances(trajectory)
    detected: set[int] = set()
    m.runs += 1
    m.minutes += (trajectory.events[-1].t_ms - trajectory.events[0].t_ms) / 60_000 or 1 / 60
    for _, _, kind in instances:
        m.instances[kind] += 1
    done: frozenset[str] = frozenset()
    for i, e in enumerate(trajectory.events):
        decision = controller.decide(_observation(i, e))
        done = frozenset(s for s, st in decision.statuses.items() if st is StepStatus.DONE)
        m.events += 1
        m.tracked += done == truth[i]
        if decision.event is not Event.MISTAKE:
            continue
        m.decisions += 1
        hits = [j for j, (a, b, _) in enumerate(instances) if a <= i <= b + GRACE_EVENTS]
        fresh = [j for j in hits if j not in detected]
        if fresh:
            j = fresh[0]
            detected.add(j)
            m.true_positives += 1
            m.detected[instances[j][2]] += 1
            m.delays_ms.append(e.t_ms - trajectory.events[instances[j][0]].t_ms)
        elif hits:
            m.duplicates += 1
        else:
            m.false_alarms += 1
    m.final_ok += done == truth[-1]


def evaluate(make: Callable[[], Controller], task: Task, runs: list[Trajectory]) -> Metrics:
    m = Metrics()
    for trajectory in runs:
        score_run(make(), task, trajectory, m)
    return m


def eval_runs(task, ontology, level: str, seed: int, n: int, split: str = "test") -> list[Trajectory]:
    return [
        generate_run(task, seed, i, NOISE_LEVELS[level], ontology, level)
        for i in split_indices(seed, n, split)
    ]


def _fmt(v: float, pct: bool = True) -> str:
    if v != v:  # nan
        return "n/a"
    return f"{100 * v:.1f}" if pct else f"{v:.2f}"


def report(task_paths: list[Path], seed: int, n: int, weights_dir: Path) -> str:
    lines = [
        "# Controller: rules vs learned under simulated perception noise",
        "",
        "Generated by `training/controller/ctrl/evaluate.py` "
        f"(`uv run python -m ctrl.evaluate`, seed {seed}, {n} runs → test split). Do not edit by hand.",
        "",
        "Test runs come from the symbolic simulator (`sim/symbolic`), split per run; their timelines never",
        "appear in training. Noise levels are `symsim.NOISE_LEVELS`. Step acc: share of observations after",
        "which the tracked done set is exactly right. Final ok: the run ends in the true state.",
        "Mistake",
        f"P/R/F1 over true mistake instances (a detection may come up to {GRACE_EVENTS} observations late).",
        "FA: false alarms (mistake decisions that match no true mistake).",
        "Delay: median ms from mistake start. A detection counts whatever kind the controller names, so",
        "under noise the per-kind recall also credits coincidental alarms (rules never flag `repeated` on",
        "purpose: perception reports an ongoing action twice).",
        "",
    ]
    for path in task_paths:
        task, ontology = load_task(path)
        lines += [f"## {task.id} (v{task.version})", ""]
        header = (
            "| noise | controller | step acc % | final ok % | mistake P % | R % | F1 % "
            "| FA/run | FA/min | delay ms |"
        )
        lines += [header, "|" + "---|" * 10]
        per_kind: dict[str, dict[str, Metrics]] = {}
        n_runs = 0
        for level in NOISE_LEVELS:
            runs = eval_runs(task, ontology, level, seed, n)
            n_runs = len(runs)
            per_kind[level] = {}
            for name, make in (
                ("rules", RulesController),
                ("learned", lambda: LearnedController(weights_dir)),
            ):
                m = evaluate(make, task, runs)
                per_kind[level][name] = m
                r = m.row()
                lines.append(
                    f"| {level} | {name} | {_fmt(r['step_acc'])} | {_fmt(r['final_ok'])} | "
                    f"{_fmt(r['precision'])} | {_fmt(r['recall'])} | {_fmt(r['f1'])} | "
                    f"{_fmt(r['fa_per_run'], False)} | {_fmt(r['fa_per_min'], False)} | "
                    f"{r['delay_ms']:.0f} |"
                )
        lines += ["", f"{n_runs} test runs per noise level.", "", "Recall per mistake kind (%):", ""]
        kinds = list(MistakeKind)
        lines += ["| noise | controller | " + " | ".join(k.value for k in kinds) + " |"]
        lines += ["|" + "---|" * (len(kinds) + 2)]
        for level, by_name in per_kind.items():
            for name, m in by_name.items():
                cells = [_fmt(m.detected[k] / m.instances[k]) if m.instances[k] else "n/a" for k in kinds]
                lines.append(f"| {level} | {name} | " + " | ".join(cells) + " |")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--task", type=Path, action="append", required=True, help="task JSON (repeatable)")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--n", type=int, default=6000, help="run indices to draw the test split from")
    parser.add_argument("--weights", type=Path, default=WEIGHTS_DIR)
    parser.add_argument("--out", type=Path, default=RESULTS_DIR / "controller.md")
    args = parser.parse_args(argv)
    text = report(args.task, args.seed, args.n, args.weights)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text)
    print(text)


if __name__ == "__main__":
    main()
