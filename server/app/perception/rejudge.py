"""Re-judge a recorded run with the current prompt and settings, and score it against the run's labels.

Tune perception without redoing the task in front of the camera. The recorded frames go through
`VlmPerception` again, in order, with the controller replayed alongside, so the "expected next" steps in
the prompt follow the new answers just as they would live. The result is a new run directory, with the same
session ids and a copy of the labels, which `app.perception.review` can open or report on.

    cd server && SUP_VLM_BASE_URL=http://localhost:8001/v1 uv run python -m app.perception.rejudge \\
        ../.context/webcam-runs/1814 --session s13 --frames 3 --span-ms 1100 --out ../.context/rejudge/f3

Caveat: only frames the live run recorded exist, about two per call, so `--frames`/`--span-ms` pick from
those (sparser than the 6 fps a live session sees).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
from pathlib import Path

from contracts import Frame, Source

from ..controller.rules import RulesController
from ..library.store import TaskLibrary
from ..settings import Settings
from .factory import _completer, _ontology
from .review import Review, Session, analyse, load_sessions, report
from .vlm import VlmPerception


def recorded_frames(run_dir: Path, session: Session) -> list[tuple[int, Frame]]:
    """Every distinct recorded frame of the session, in time order, with the call that first sent it."""
    seen: dict[int, tuple[int, Frame]] = {}
    for call in session.calls:
        for seq, t_ms, name in zip(call["seqs"], call["t_ms"], call["frames"], strict=True):
            if seq not in seen:
                jpeg = (run_dir / name).read_bytes()
                seen[seq] = (call["call"], Frame(seq=seq, t_ms=t_ms, jpeg=jpeg, source=Source.WEBCAM))
    return sorted(seen.values(), key=lambda cf: cf[1].t_ms)


async def rejudge(
    run_dir: Path, session: Session, out: Path, settings: Settings, frames_per_call: int, span_ms: int
) -> None:
    assert settings.vlm_base_url, "set SUP_VLM_BASE_URL"
    completer = _completer(
        settings.vlm_base_url,
        settings.vlm_model,
        settings.vlm_api_key,
        settings.vlm_timeout_s,
        settings.vlm_max_tokens,
    )
    perception = VlmPerception(
        completer,
        _ontology(settings.tasks_dir / session.task.domain / "ontology.json"),
        model=settings.vlm_model,
        min_interval_ms=0,
        max_side_px=settings.vlm_max_side_px,
        span_ms=span_ms,
        frames_per_call=frames_per_call,
        record_dir=out,
        session=session.id,
    )
    controller = RulesController()
    decision = controller.start(session.task)
    history = recorded_frames(run_dir, session)
    for call in session.calls:
        newest = call["t_ms"][-1]
        window = [f for _, f in history if newest - span_ms - 50 <= f.t_ms <= newest]
        if (reminder := controller.tick(newest)) is not None:
            decision = reminder
        observation = await perception.observe(window, session.task, list(decision.next_steps))
        assert observation is not None  # no rate limit, one call at a time
        decision = controller.decide(observation)
        print(f"{call['call']:4d} {observation.latency_ms:4d} ms {observation.output.action}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--session", required=True)
    parser.add_argument("--out", type=Path, required=True)
    live = Settings.from_env()
    parser.add_argument("--frames", type=int, default=live.vlm_frames, help="default: the live setting")
    parser.add_argument("--span-ms", type=int, default=live.vlm_span_ms, help="default: the live setting")
    args = parser.parse_args()
    settings = Settings.from_env()
    library = TaskLibrary.load(settings.tasks_dir)
    session = next(s for s in load_sessions(args.run_dir, library) if s.id == args.session)
    if args.out.resolve() == args.run_dir.resolve() or args.run_dir.resolve().is_relative_to(
        args.out.resolve()
    ):
        parser.error("--out must not be the recorded run (or contain it): it is replaced")
    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)
    asyncio.run(rejudge(args.run_dir, session, args.out, settings, args.frames, args.span_ms))
    labels = Review(args.run_dir, library, RulesController).labels()
    (args.out / "labels.json").write_text(json.dumps(labels, indent=1, sort_keys=True))
    rejudged = next(s for s in load_sessions(args.out, library) if s.id == args.session)
    print("\n" + report(analyse(rejudged, labels, RulesController)))


if __name__ == "__main__":
    main()
