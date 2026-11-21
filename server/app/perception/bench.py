"""Judge JPEGs with the real VLM and measure latency (the numbers in PRs and the pitch come from here).

    cd server && SUP_VLM_BASE_URL=https://<tunnel>/v1 SUP_VLM_API_KEY=… \\
        uv run python -m app.perception.bench --task hand_hygiene_basic --repeat 3 img1.jpg img2.jpg …

`--stream SECONDS` instead feeds the images as a camera at `--fps` with the live settings and reports
observations per second (the throughput of pipelined calls, D-018).

Otherwise each image is sent as a single frame (next steps = the task's first legal steps) through
`VlmPerception`, exactly as the session would. Prints one observation per call, then p50/p95 latency.
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


async def stream(task_id: str, images: list[Path], seconds: float, fps: float) -> None:
    """Feed a camera-like stream (the images in a loop at `fps`) through `VlmPerception` with the live
    settings (`SUP_VLM_MAX_IN_FLIGHT`, `SUP_VLM_MIN_INTERVAL_MS`, …), one `observe` at a time as the session
    does, and report observations per second and their latency."""
    settings = replace(Settings.from_env(), perception=PerceptionMode.VLM)
    task = TaskLibrary.load(settings.tasks_dir).get(task_id)
    if task is None:
        sys.exit(f"unknown task {task_id!r}")
    perception = make_perception(settings, task)
    next_steps = TaskAutomaton(task).legal_next(frozenset())
    jpegs = [p.read_bytes() for p in images]
    window: list[Frame] = []
    latencies: list[int] = []
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    observing: asyncio.Task | None = None
    seq = 0
    while loop.time() - t0 < seconds:
        frame = Frame(
            seq=seq, t_ms=round((loop.time() - t0) * 1000), jpeg=jpegs[seq % len(jpegs)], source=Source.WEBCAM
        )
        window = [*window[-7:], frame]  # the session's 8-frame window
        if observing is None or observing.done():
            if observing is not None and (obs := observing.result()) is not None:
                latencies.append(obs.latency_ms)
            observing = asyncio.create_task(perception.observe(list(window), task, next_steps))
        seq += 1
        await asyncio.sleep(max(0.0, t0 + seq / fps - loop.time()))
    elapsed = loop.time() - t0
    if not latencies:
        sys.exit("no observations")
    print(
        f"{len(latencies)} observations in {elapsed:.1f} s = {len(latencies) / elapsed:.2f}/s "
        f"(max_in_flight={settings.vlm_max_in_flight}, min_interval={settings.vlm_min_interval_ms} ms, "
        f"{settings.vlm_frames} frames/call, camera {fps:g} fps); "
        f"latency p50 {percentile(latencies, 0.5)} ms, p95 {percentile(latencies, 0.95)} ms"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--task", default="hand_hygiene_basic")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--stream", type=float, metavar="SECONDS", help="camera-like stream: observations/s")
    parser.add_argument(
        "--fps", type=float, default=6.0, help="camera fps for --stream (the web app sends 6)"
    )
    parser.add_argument("images", nargs="+", type=Path)
    args = parser.parse_args()
    if args.stream:
        asyncio.run(stream(args.task, args.images, args.stream, args.fps))
    else:
        asyncio.run(run(args.task, args.images, args.repeat))


if __name__ == "__main__":
    main()
