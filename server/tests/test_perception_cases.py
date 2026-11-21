"""The VLM case scorer's controller labels (the run itself needs the GPU)."""

from pathlib import Path

from contracts import TaskAutomaton

from app.library.store import TaskLibrary
from app.perception.cases import outcome

TASK = TaskLibrary.load(Path(__file__).resolve().parents[2] / "tasks").get("c172_takeoff")
AUTOMATON = TaskAutomaton(TASK)
STARTED = frozenset({"master_on", "fuel_on", "mixture_rich", "engine_start"})


def test_labels_advance_mistakes_and_silence():
    assert outcome(AUTOMATON, frozenset(), "turn_master_on", 0.9) == "advance master_on"
    assert outcome(AUTOMATON, frozenset(), None, 0.9) == "silent"
    assert outcome(AUTOMATON, frozenset(), "turn_master_on", 0.2) == "silent"  # below the rules' threshold
    assert (
        outcome(AUTOMATON, frozenset({"master_on"}), "turn_master_on", 0.9) == "silent"
    )  # repeats are ignored
    assert (
        outcome(AUTOMATON, frozenset({"master_on"}), "start_engine", 0.9)
        == "mistake out_of_order (start_not_ready)"
    )
    assert outcome(AUTOMATON, STARTED, "set_flaps_full", 0.9) == "mistake wrong_action (flaps_full)"


def test_repo_cases_reference_the_task():
    import json

    spec = json.loads(
        (Path(__file__).resolve().parents[2] / "sim/cockpit/c172_takeoff/cases.json").read_text()
    )
    root = Path(__file__).resolve().parents[2] / "sim/cockpit/c172_takeoff"
    assert spec["task_id"] == TASK.id
    for case in spec["cases"]:
        assert case["expected"] is None or case["expected"] in TASK.actions
        assert set(case["done"]) <= {s.id for s in TASK.steps}
        assert (root / f"{case['name']}_a.jpg").is_file() and (root / f"{case['name']}_b.jpg").is_file()
