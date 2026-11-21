"""Labelled runs → a fine-tuning dataset for the VLM (`training/vlm/train.py`).

Every example is exactly what production sends (`prompt.build_messages`: the system rules, the frames the
model saw, the task context with the next steps recorded live), and the target is the JSON answer for the
label, key order as in `prompt.task_json_schema` (note first):

- an action label → `{"note": <the action's visual cue>, "objects": [], "action": <id>, "quality": "ok", ...}`
- `none` → `{"note": "None of the task's actions is visible.", ..., "action": null, "quality": "unknown"}`
- calls before the first label in a session are skipped.

Splits are per session, never per call (`--test-sessions`), so test frames never leak into training.

    cd server && uv run python -m app.perception.dataset ../.context/webcam-runs/1814 [more runs…] \\
        --out ../.context/vlm-data/v1 --test-sessions s13
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from pathlib import Path

from contracts import Ontology, Task

from ..library.store import TaskLibrary
from ..settings import REPO_ROOT
from .prompt import SYSTEM, task_json_schema, user_text
from .review import NONE, effective_labels, load_sessions

CONFIDENCE = 0.9
NO_ACTION_NOTE = "None of the task's actions is visible."


def target(task: Task, ontology: Ontology, label: str) -> str:
    cues = {a.id: a.visual_cue for a in ontology.actions}
    action = None if label == NONE else label
    answer = {
        "note": f"{cues[label][0].upper()}{cues[label][1:]}." if action else NO_ACTION_NOTE,
        "objects": [],
        "action": action,
        "quality": "ok" if action else "unknown",
        "confidence": CONFIDENCE,
    }
    assert list(answer) == list(task_json_schema(task)["properties"])  # same key order as production
    return json.dumps(answer)


def check_test_sessions(requested: list[str], found: set[str]) -> None:
    """Every held-out session must exist: a typo would silently put a test run into training."""
    unknown = sorted(set(requested) - found)
    if unknown:
        raise ValueError(f"--test-sessions not in the runs: {unknown}; sessions found: {sorted(found)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("runs", nargs="+", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--test-sessions", nargs="*", default=[])
    parser.add_argument("--tasks-dir", type=Path, default=REPO_ROOT / "tasks")
    args = parser.parse_args()
    library = TaskLibrary.load(args.tasks_dir)
    sessions = {run: load_sessions(run, library) for run in args.runs}
    try:
        check_test_sessions(args.test_sessions, {s.id for found in sessions.values() for s in found})
    except ValueError as error:
        raise SystemExit(str(error)) from error
    (args.out / "images").mkdir(parents=True, exist_ok=True)
    rows: dict[str, list[dict]] = {"train": [], "test": []}
    counts: dict[str, Counter] = {"train": Counter(), "test": Counter()}
    for run in args.runs:
        labels_path = run / "labels.json"
        labels = json.loads(labels_path.read_text()) if labels_path.exists() else {}
        for session in sessions[run]:
            ontology = Ontology.model_validate_json(
                (args.tasks_dir / session.task.domain / "ontology.json").read_text()
            )
            split = "test" if session.id in args.test_sessions else "train"
            for call, label in zip(session.calls, effective_labels(session, labels), strict=True):
                if label is None:
                    continue
                images = []
                for name in call["frames"]:
                    dest = args.out / "images" / f"{run.name}_{session.id}_{name}"
                    shutil.copyfile(run / name, dest)
                    images.append(str(dest.relative_to(args.out)))
                rows[split].append(
                    {
                        "id": f"{run.name}:{session.id}:{call['call']}",
                        "task": session.task.id,
                        "system": SYSTEM,
                        "user": user_text(session.task, ontology, call["next_steps"], len(images)),
                        "images": images,
                        "target": target(session.task, ontology, label),
                    }
                )
                counts[split][label] += 1
    for split, items in rows.items():
        (args.out / f"{split}.jsonl").write_text("".join(json.dumps(r) + "\n" for r in items))
        print(f"{split}: {len(items)} examples {dict(counts[split])}")


if __name__ == "__main__":
    main()
