"""Score the real VLM on labeled frame pairs, the way a live session would see them.

    cd server && SUP_VLM_BASE_URL=http://localhost:8001/v1 \\
        uv run python -m app.perception.cases ../sim/cockpit/c172_takeoff [--repeat 3]

The directory holds `cases.json` ({"task_id", "cases": [{"name", "expected", "done"}]}) and, per case,
`<name>_a.jpg` (before the action) and `<name>_b.jpg` (~1 s after): the same 640x480 JPEGs the page sends.
Each case is two frames 1 s apart through `VlmPerception` with the task's "expected next" for the steps in
`done`, then through `TaskAutomaton` as the rules controller would. A case passes when the controller
outcome matches the expected action's (advance the right step, the right mistake, or silence). Prints a
markdown table you can paste into a PR. Frames and cases come from `sim/cockpit/capture_c172.js`.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import replace
from pathlib import Path

from contracts import Frame, Outcome, Source, TaskAutomaton

from ..controller.rules import MIN_CONFIDENCE
from ..library.store import TaskLibrary
from ..settings import PerceptionMode, Settings
from .bench import percentile
from .factory import make_perception


def outcome(automaton: TaskAutomaton, done: frozenset[str], action: str | None, confidence: float) -> str:
    """What the rules controller does with this observation, as a short label."""
    if action is None or confidence < MIN_CONFIDENCE:
        return "silent"
    t = automaton.apply(done, action)
    if t.outcome is Outcome.MISTAKE:
        if t.kind is not None and t.kind.value == "repeated":
            return "silent"  # the rules ignore repeats
        return f"mistake {t.kind.value if t.kind else '?'}" + (f" ({t.mistake.id})" if t.mistake else "")
    return f"advance {t.step}"


async def run(root: Path, repeat: int) -> int:
    spec = json.loads((root / "cases.json").read_text())
    # One call at a time: each case needs its own answer before the next.
    settings = replace(
        Settings.from_env(), perception=PerceptionMode.VLM, vlm_min_interval_ms=0, vlm_max_in_flight=1
    )
    task = TaskLibrary.load(settings.tasks_dir).get(spec["task_id"])
    if task is None:
        sys.exit(f"unknown task {spec['task_id']!r}")
    perception = make_perception(settings, task)
    automaton = TaskAutomaton(task)

    rows, latencies, passed, total, seq = [], [], 0, 0, 0
    for _ in range(repeat):
        for case in spec["cases"]:
            done = frozenset(case["done"])
            frames = [
                Frame(
                    seq=seq + i,
                    t_ms=(seq + i) * 1000,
                    jpeg=(root / f"{case['name']}_{s}.jpg").read_bytes(),
                    source=Source.SIM,
                )
                for i, s in enumerate(("a", "b"))
            ]
            seq += 2
            obs = await perception.observe(frames, task, automaton.legal_next(done))
            assert obs is not None  # rate limit disabled above
            out = obs.output
            want = outcome(automaton, done, case["expected"], 1.0)
            got = outcome(automaton, done, out.action, out.confidence)
            ok = want == got
            passed += ok
            total += 1
            latencies.append(obs.latency_ms)
            rows.append(
                f"| {case['name']} | {case['expected'] or '—'} | {out.action or '—'} ({out.confidence:.2f}, "
                f"{out.quality.value}) | {want} | {got} | {'✅' if ok else '❌'} | {obs.latency_ms} |"
            )
            print(f"{case['name']}: {out.model_dump_json()}", file=sys.stderr)

    print(f"## {task.id}: VLM on simulator frames ({settings.vlm_model})\n")
    header = (
        "| case | expected | VLM action (conf, quality) | controller should | controller would | ok | ms |"
    )
    print(header)
    print("|---|---|---|---|---|---|---|")
    print("\n".join(rows))
    print(
        f"\n**{passed}/{total} cases pass** · latency p50 {percentile(latencies, 0.5)} ms, "
        f"p95 {percentile(latencies, 0.95)} ms · `python -m app.perception.cases {root}`"
    )
    return 0 if passed == total else 1


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("root", type=Path, help="directory with cases.json and the <name>_a/_b.jpg frames")
    parser.add_argument("--repeat", type=int, default=1)
    args = parser.parse_args()
    sys.exit(asyncio.run(run(args.root, args.repeat)))


if __name__ == "__main__":
    main()
