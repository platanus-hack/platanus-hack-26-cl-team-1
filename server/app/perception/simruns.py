"""Simulator runs → recorded, labelled VLM runs, ready for `app.perception.dataset` (owner: Anaís).

The C172 simulator knows exactly what happened and when, so its runs need no hand labelling. A raw run
(`sim/cockpit/fly_c172.js`) is a directory with `run.json` (frames and ground-truth events, both on
simulator time) and the frames. This replays each run the way a live session calls the VLM, with the
server's own code and settings (`pick_frames`, `downscale_jpeg`, the session's frame window, frames per
call, span and minimum interval), and writes a `SUP_VLM_RECORD_DIR`-style run: `calls.jsonl` + the JPEGs
each call would have sent + `labels.json` (one label per call, so nothing is left unlabelled).

    cd server && uv run python -m app.perception.simruns ../.context/sim-raw --out ../.context/sim-runs/v1
    cd server && uv run python -m app.perception.dataset ../.context/sim-runs/v1 \\
        --out ../.context/vlm-data/sim-v1 --test-sessions sim005_flaps_full sim006_power_with_brake

Labels: a call is labelled with the latest ground-truth action if the newest frame it sends is at most
`--hold-ms` after it (the change and the state right after it are on screen), otherwise `none`. "Expected
next" is what a controller with perfect perception would show before the call: the recipe advanced by the
ground-truth actions before the call's oldest frame (mistakes don't advance it). Every call has a real
model call's shape; the recorded `output` is the label itself (an oracle), marked `"source": "simulator"`,
since no model was called.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from dataclasses import replace
from pathlib import Path

from contracts import Frame, Outcome, Quality, Source, Task, TaskAutomaton, VlmOutput

from ..library.store import TaskLibrary
from ..session.ws import FRAME_WINDOW
from ..settings import REPO_ROOT, Settings
from .review import NONE
from .vlm import downscale_jpeg, pick_frames

HOLD_MS = 2500


def label_at(events: list[dict], t_ms: int, hold_ms: int) -> str:
    """The latest event at or before `t_ms`, if it's at most `hold_ms` old; otherwise nothing happening."""
    latest = None
    for event in events:
        if event["t_ms"] > t_ms:
            break
        latest = event
    if latest is None or t_ms - latest["t_ms"] > hold_ms:
        return NONE
    return latest["action"]


def done_at(automaton: TaskAutomaton, events: list[dict], t_ms: int) -> frozenset[str]:
    """Steps completed by the ground truth up to `t_ms` (a mistake never advances the recipe)."""
    done = automaton.start
    for event in events:
        if event["t_ms"] > t_ms:
            break
        transition = automaton.apply(done, event["action"])
        if transition.outcome is not Outcome.MISTAKE:
            done = transition.done
    return done


def convert_run(
    raw: Path, out: Path, task: Task, settings: Settings, hold_ms: int, labels: dict[str, str]
) -> Counter:
    """Append one raw run to the recorded run in `out` as one session; returns its label counts."""
    run = json.loads((raw / "run.json").read_text())
    if run["task_id"] != task.id:
        raise ValueError(f"{raw}: run is for {run['task_id']!r}, not {task.id!r}")
    session = run["run_id"]
    events = sorted(run["events"], key=lambda e: e["t_ms"])
    unknown = sorted({e["action"] for e in events} - set(task.actions))
    if unknown:
        raise ValueError(f"{raw}: events with actions not in {task.id}: {unknown}")
    automaton = TaskAutomaton(task)
    counts: Counter = Counter()
    window: list[Frame] = []
    last_call_ms: int | None = None
    call = 0
    with (out / "calls.jsonl").open("a") as calls:
        for meta in run["frames"]:
            jpeg = (raw / meta["file"]).read_bytes()
            window = [*window, Frame(seq=meta["seq"], t_ms=meta["t_ms"], jpeg=jpeg, source=Source.SIM)][
                -FRAME_WINDOW:
            ]
            if last_call_ms is not None and meta["t_ms"] - last_call_ms < settings.vlm_min_interval_ms:
                continue  # the session's perception is rate limited: this frame only joins the window
            last_call_ms = meta["t_ms"]
            call += 1
            picked = pick_frames(window, settings.vlm_span_ms, settings.vlm_frames)
            newest = picked[-1].t_ms
            label = label_at(events, newest, hold_ms)
            output = (
                VlmOutput(
                    action=None, confidence=1.0, quality=Quality.UNKNOWN, note="simulator: nothing happening"
                )
                if label == NONE
                else VlmOutput(
                    action=label, confidence=1.0, quality=Quality.OK, note="simulator ground truth"
                )
            )
            names = []
            for i, frame in enumerate(picked):
                name = f"{session}_{call:05d}_{i}.jpg"
                (out / name).write_bytes(downscale_jpeg(frame.jpeg, settings.vlm_max_side_px))
                names.append(name)
            record = {
                "session": session,
                "call": call,
                "task": task.id,
                # What the controller knew before this call: actions before its oldest frame (an action
                # inside the frames is what this call is about to report).
                "next_steps": automaton.legal_next(done_at(automaton, events, picked[0].t_ms - 1)),
                "seqs": [f.seq for f in picked],
                "t_ms": [f.t_ms for f in picked],
                "latency_ms": 0,
                "raw": output.model_dump_json(),
                "output": output.model_dump(mode="json"),
                "frames": names,
                "source": "simulator",
            }
            calls.write(json.dumps(record) + "\n")
            labels[f"{session}:{call}"] = label
            counts[label] += 1
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "raw", type=Path, help="directory of raw runs (one subdirectory per run with run.json)"
    )
    parser.add_argument("--out", type=Path, required=True, help="recorded run to create (must not exist)")
    parser.add_argument("--hold-ms", type=int, default=HOLD_MS)
    parser.add_argument("--tasks-dir", type=Path, default=REPO_ROOT / "tasks")
    args = parser.parse_args()
    if args.out.exists():
        raise SystemExit(f"{args.out} already exists: pick a new --out (calls.jsonl is appended to)")
    runs = sorted(p for p in args.raw.iterdir() if (p / "run.json").is_file())
    if not runs:
        raise SystemExit(f"no raw runs (subdirectories with run.json) in {args.raw}")
    library = TaskLibrary.load(args.tasks_dir)
    settings = replace(Settings.from_env(), tasks_dir=args.tasks_dir)
    args.out.mkdir(parents=True)
    labels: dict[str, str] = {}
    total: Counter = Counter()
    for raw in runs:
        task_id = json.loads((raw / "run.json").read_text())["task_id"]
        task = library.get(task_id)
        if task is None:
            raise SystemExit(f"{raw}: task {task_id!r} is not in the library")
        counts = convert_run(raw, args.out, task, settings, args.hold_ms, labels)
        total += counts
        print(f"{raw.name}: {sum(counts.values())} calls {dict(counts)}")
    (args.out / "labels.json").write_text(json.dumps(labels, indent=1) + "\n")
    print(f"\n{len(runs)} sessions, {sum(total.values())} calls → {args.out}\n{dict(total.most_common())}")


if __name__ == "__main__":
    main()
