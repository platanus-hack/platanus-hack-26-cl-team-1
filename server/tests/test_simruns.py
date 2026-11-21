"""Simulator runs → recorded, labelled VLM runs (app.perception.simruns)."""

import io
import itertools
import json
from pathlib import Path

from contracts import TaskAutomaton
from PIL import Image

from app.library.store import TaskLibrary
from app.perception.review import effective_labels, load_sessions
from app.perception.simruns import convert_run, done_at, label_at
from app.settings import Settings

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"
LIBRARY = TaskLibrary.load(TASKS_DIR)
TASK = LIBRARY.get("c172_takeoff")
EVENTS = [
    {"t_ms": 1000, "action": "turn_master_on"},
    {"t_ms": 2000, "action": "start_engine"},  # out of order: fuel and mixture aren't done
    {"t_ms": 6000, "action": "set_fuel_both"},
]


def raw_run(tmp_path: Path, seconds: float = 10, fps: int = 6) -> Path:
    raw = tmp_path / "raw" / "sim001_test"
    raw.mkdir(parents=True)
    buf = io.BytesIO()
    Image.new("RGB", (640, 480), (40, 40, 40)).save(buf, format="JPEG")
    frames = []
    for seq in range(int(seconds * fps)):
        name = f"f_{seq:05d}.jpg"
        (raw / name).write_bytes(buf.getvalue())
        frames.append({"seq": seq, "t_ms": round(seq * 1000 / fps), "file": name})
    run = {"task_id": "c172_takeoff", "run_id": "sim001_test", "frames": frames, "events": EVENTS}
    (raw / "run.json").write_text(json.dumps(run))
    return raw


def test_label_holds_after_an_action_then_falls_back_to_none():
    assert label_at(EVENTS, 500, 2500) == "none"
    assert label_at(EVENTS, 1000, 2500) == "turn_master_on"
    assert label_at(EVENTS, 2400, 2500) == "start_engine"
    assert label_at(EVENTS, 4600, 2500) == "none"


def test_mistakes_never_advance_the_expected_next():
    automaton = TaskAutomaton(TASK)
    assert done_at(automaton, EVENTS, 3000) == {"master_on"}
    assert done_at(automaton, EVENTS, 7000) == {"master_on", "fuel_on"}


def test_a_run_becomes_live_shaped_calls_with_every_call_labelled(tmp_path):
    out = tmp_path / "run"
    out.mkdir()
    settings = Settings.from_env()
    labels: dict[str, str] = {}
    counts = convert_run(raw_run(tmp_path), out, TASK, settings, 2500, labels)
    calls = [json.loads(line) for line in (out / "calls.jsonl").read_text().splitlines()]
    gaps = [b["t_ms"][-1] - a["t_ms"][-1] for a, b in itertools.pairwise(calls)]
    assert min(gaps) >= settings.vlm_min_interval_ms  # the live rate limit
    assert all(1 <= len(c["frames"]) <= settings.vlm_frames for c in calls)
    assert all(c["t_ms"][-1] - c["t_ms"][0] <= settings.vlm_span_ms for c in calls)
    assert all((out / name).is_file() for c in calls for name in c["frames"])
    assert set(counts) == {"none", "turn_master_on", "start_engine", "set_fuel_both"}
    # An action inside a call's frames is still "expected next" for that call: the controller hasn't seen it.
    first_master = next(c for c in calls if c["t_ms"][0] <= 1000 <= c["t_ms"][-1])
    assert "master_on" in first_master["next_steps"]
    (out / "labels.json").write_text(json.dumps(labels))
    # The review/dataset tools read it as one session with a label on every call.
    [session] = load_sessions(out, LIBRARY)
    assert session.id == "sim001_test" and len(session.calls) == len(calls)
    assert None not in effective_labels(session, labels)
