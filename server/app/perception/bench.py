"""Judge JPEGs with the real VLM and measure latency (the numbers in PRs and the pitch come from here).

    cd server && SUP_VLM_BASE_URL=https://<tunnel>/v1 SUP_VLM_API_KEY=… \\
        uv run python -m app.perception.bench --task hand_hygiene_basic --repeat 3 img1.jpg img2.jpg …

Each image is sent as a single frame (next steps = the task's first legal steps) through `VlmPerception`,
exactly as the session would. Prints one observation per call, then p50/p95 latency.
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
from dataclasses import replace
from pathlib import Path

from contracts import Frame, Source, TaskAutomaton

from ..library.store import TaskLibrary
from ..settings import PerceptionMode, Settings
from .factory import make_perception


def percentile(values: list[int], q: float) -> int:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, round(q * (len(ordered) - 1)))]


async def run(task_id: str, images: list[Path], repeat: int) -> None:
    settings = replace(Settings.from_env(), perception=PerceptionMode.VLM, vlm_min_interval_ms=0)
    task = TaskLibrary.load(settings.tasks_dir).get(task_id)
    if task is None:
        sys.exit(f"unknown task {task_id!r}")
    perception = make_perception(settings, task)
    next_steps = TaskAutomaton(task).legal_next(frozenset())
    latencies: list[int] = []
    seq = 0
    for _ in range(repeat):
        for path in images:
            frame = Frame(seq=seq, t_ms=seq * 1000, jpeg=path.read_bytes(), source=Source.WEBCAM)
            seq += 1
            obs = await perception.observe([frame], task, next_steps)
            assert obs is not None  # rate limit disabled above
            latencies.append(obs.latency_ms)
            print(f"{path.name}\t{obs.latency_ms} ms\t{obs.output.model_dump_json()}")
    print(
        f"\n{len(latencies)} calls, model {settings.vlm_model}: "
        f"p50 {percentile(latencies, 0.5)} ms, p95 {percentile(latencies, 0.95)} ms, "
        f"mean {statistics.mean(latencies):.0f} ms (first call includes warm-up: {latencies[0]} ms)"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--task", default="hand_hygiene_basic")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("images", nargs="+", type=Path)
    args = parser.parse_args()
    asyncio.run(run(args.task, args.images, args.repeat))


if __name__ == "__main__":
    main()
