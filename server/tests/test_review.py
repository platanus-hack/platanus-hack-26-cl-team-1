"""The run review: sessions, labels that hold until the next one, replay, perception vs controller."""

import json
from pathlib import Path

import pytest

from app.controller.rules import RulesController
from app.library.store import TaskLibrary
from app.perception.review import Review, effective_labels, load_sessions, segments

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"


@pytest.fixture(scope="module")
def library():
    return TaskLibrary.load(TASKS_DIR)


def call(n, action, t_ms, session=None, next_steps=("wet",)):
    out = {"action": action, "confidence": 0.9 if action else 0.0, "quality": "ok" if action else "unknown"}
    record = {
        "call": n, "task": "hand_hygiene_basic", "next_steps": list(next_steps), "seqs": [n],
        "t_ms": [t_ms], "latency_ms": 400, "raw": json.dumps(out),
        "output": {**out, "objects": [], "note": None}, "frames": [],
    }  # fmt: skip
    return record | ({"session": session} if session else {})


def write_run(tmp_path, calls):
    (tmp_path / "calls.jsonl").write_text("\n".join(json.dumps(c) for c in calls))
    return tmp_path


def test_old_runs_are_split_where_the_call_counter_restarts(tmp_path, library):
    run = write_run(tmp_path, [call(1, None, 0), call(2, None, 1500), call(1, None, 0), call(2, None, 1500)])
    assert [len(s.calls) for s in load_sessions(run, library)] == [2, 2]


def test_a_label_holds_until_the_next_one(tmp_path, library):
    run = write_run(tmp_path, [call(n, None, n * 1500, "a") for n in range(1, 6)])
    session = load_sessions(run, library)[0]
    labels = {"a:2": "wet_hands", "a:4": "none"}
    assert effective_labels(session, labels) == [None, "wet_hands", "wet_hands", "none", "none"]
    assert segments(["wet_hands", "wet_hands", None, "apply_soap", "none", "apply_soap"]) == [
        ("wet_hands", 0, 1),
        ("apply_soap", 3, 3),
        ("apply_soap", 5, 5),
    ]


def test_splits_a_perception_miss_from_the_controller(tmp_path, library):
    """The person wets, soaps, rubs. The model never sees the soap: with its answers the supervisor
    flags rubbing as out of order; with the labels it completes all three steps."""
    model = ["wet_hands", "wet_hands", "rub_palms", "rub_palms", "rub_palms"]
    run = write_run(tmp_path, [call(n + 1, a, n * 1500, "a") for n, a in enumerate(model)])
    review = Review(run, library, RulesController)
    for key, value in {"a:1": "wet_hands", "a:3": "apply_soap", "a:4": "rub_palms"}.items():
        review.set_label(key, value)
    analysis = review.data()["sessions"][0]
    assert any("out_of_order at palms" in e for e in analysis["model_progress"])
    assert [e.split(": ", 1)[1] for e in analysis["oracle_progress"]] == ["wet", "soap", "palms"]
    assert analysis["missed_segments"] == [["apply_soap", 3, 3]]
    assert analysis["accuracy"] == pytest.approx(4 / 5)
    assert ["apply_soap", "rub_palms", 1] in analysis["confusion"]
