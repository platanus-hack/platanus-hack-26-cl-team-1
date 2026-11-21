import random
from pathlib import Path

import pytest
from contracts import MistakeKind, Outcome, Quality, TaskAutomaton, Trajectory

from symsim import NOISE_LEVELS, generate_run, generate_trajectories, true_timeline
from symsim.cli import load_task, main

TASK_PATH = Path(__file__).resolve().parents[3] / "tasks" / "hand_hygiene" / "hand_hygiene_basic.json"
TASK, ONTOLOGY = load_task(TASK_PATH)


def test_reproducible():
    a = generate_run(TASK, 7, 3, NOISE_LEVELS["high"], ONTOLOGY, "high")
    b = generate_run(TASK, 7, 3, NOISE_LEVELS["high"], ONTOLOGY, "high")
    assert a == b


def test_same_run_same_timeline_and_split_across_noise_levels():
    for i in range(30):
        runs = [generate_run(TASK, 1, i, p, ONTOLOGY, name) for name, p in NOISE_LEVELS.items()]
        assert len({r.split for r in runs}) == 1
        assert len({r.completed for r in runs}) == 1


def test_splits_cover_all_three():
    splits = {t.split for t in generate_trajectories(TASK, 200, 0, NOISE_LEVELS, ONTOLOGY)}
    assert len(splits) == 3


@pytest.mark.parametrize("index", range(200))
def test_timeline_is_consistent_with_the_automaton(index):
    automaton = TaskAutomaton(TASK)
    segments, completed = true_timeline(TASK, random.Random(index))
    done = automaton.start
    for seg in segments:
        if seg.action is None:
            continue
        transition = automaton.apply(done, seg.action)
        if seg.completes:
            assert seg.mistake_kind is None and transition.outcome is not Outcome.MISTAKE
            done = transition.done
        elif seg.mistake_kind is MistakeKind.INCOMPLETE:
            assert seg.quality is Quality.BAD and transition.outcome is not Outcome.MISTAKE
        else:
            assert transition.kind is seg.mistake_kind
            assert seg.mistake_id == (transition.mistake.id if transition.mistake else None)
    assert completed == automaton.is_complete(done)


def test_every_mistake_kind_appears():
    kinds = {
        e.mistake_kind for t in generate_trajectories(TASK, 300, 0, NOISE_LEVELS, ONTOLOGY) for e in t.events
    }
    assert kinds >= set(MistakeKind)


def test_clean_noise_reports_the_truth():
    for i in range(50):
        run = generate_run(TASK, 0, i, NOISE_LEVELS["clean"], ONTOLOGY, "clean")
        for e in run.events:
            assert e.observed_action == e.true_action
            assert (e.observed_quality is Quality.BAD) == (e.mistake_kind is MistakeKind.INCOMPLETE)


def test_noise_is_recorded_and_observed_actions_stay_in_the_task():
    run = generate_run(TASK, 0, 0, NOISE_LEVELS["high"], ONTOLOGY, "high")
    assert run.noise["drop"] == NOISE_LEVELS["high"].drop
    for t in generate_trajectories(TASK, 100, 0, {"high": NOISE_LEVELS["high"]}, ONTOLOGY):
        for e in t.events:
            assert e.observed_action is None or e.observed_action in TASK.actions
            if e.observed_action is None:
                assert e.observed_quality is Quality.UNKNOWN


def test_cli_writes_valid_jsonl(tmp_path):
    out = tmp_path / "runs.jsonl"
    main(["--task", str(TASK_PATH), "--n", "20", "--noise", "low", "--out", str(out)])
    lines = out.read_text().splitlines()
    assert len(lines) == 20
    assert all(Trajectory.model_validate_json(line).task_id == TASK.id for line in lines)
