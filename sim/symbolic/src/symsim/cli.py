"""Write trajectories as JSONL.

uv run symsim --task ../../tasks/hand_hygiene/hand_hygiene_basic.json --n 3000 --noise mix \
    --out ../../training/data/hand_hygiene_basic/mix.jsonl
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from contracts import Ontology, Task

from .generate import generate_trajectories
from .noise import NOISE_LEVELS


def load_task(path: Path) -> tuple[Task, Ontology | None]:
    """The task, plus `ontology.json` from the same folder when present (checked against the task)."""
    task = Task.model_validate_json(path.read_text())
    ontology_path = path.parent / "ontology.json"
    ontology = None
    if ontology_path.exists():
        ontology = Ontology.model_validate_json(ontology_path.read_text())
        task.check_against(ontology)
    return task, ontology


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--task", type=Path, required=True, help="path to a task JSON")
    parser.add_argument("--n", type=int, default=1000, help="number of runs")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--noise", default="mix", help=f"one of {sorted(NOISE_LEVELS)} or 'mix' (all)")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)

    if args.noise == "mix":
        levels = NOISE_LEVELS
    elif args.noise in NOISE_LEVELS:
        levels = {args.noise: NOISE_LEVELS[args.noise]}
    else:
        parser.error(f"unknown noise level {args.noise!r}")
    task, ontology = load_task(args.task)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    splits: Counter[str] = Counter()
    with args.out.open("w") as f:
        for trajectory in generate_trajectories(task, args.n, args.seed, levels, ontology):
            splits[trajectory.split.value] += 1
            f.write(trajectory.model_dump_json() + "\n")
    print(f"wrote {args.n} runs of {task.id} ({args.noise}) to {args.out}: {dict(splits)}")


if __name__ == "__main__":
    main()
