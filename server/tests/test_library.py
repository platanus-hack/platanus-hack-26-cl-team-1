"""The task library's content: every ontology and task under tasks/ is usable by the rest of the system."""

from pathlib import Path

import pytest
from contracts import MistakeKind, Outcome, TaskAutomaton

from app.library.store import TaskLibrary

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"
LIBRARY = TaskLibrary.load(TASKS_DIR)
TASKS = [LIBRARY.get(s.id) for s in LIBRARY.summaries()]


def test_the_robot_assembly_candidates_are_in_the_library():
    ids = {s.id for s in LIBRARY.summaries()}
    assert {"servo_wheel_module", "arduino_led_breadboard"} <= ids


@pytest.mark.parametrize("task", TASKS, ids=lambda t: t.id)
def test_the_listed_order_is_a_correct_run(task):
    automaton = TaskAutomaton(task)
    done = automaton.start
    for i, step in enumerate(task.steps):
        transition = automaton.apply(done, step.action)
        expected = Outcome.TASK_DONE if i == len(task.steps) - 1 else Outcome.ADVANCE
        assert transition.outcome is expected, step.id
        done = transition.done


@pytest.mark.parametrize("task", TASKS, ids=lambda t: t.id)
def test_every_wrong_action_mistake_is_recognized(task):
    automaton = TaskAutomaton(task)
    for mistake in task.mistakes:
        if mistake.kind is MistakeKind.WRONG_ACTION:
            transition = automaton.apply(automaton.start, mistake.action)
            assert transition.outcome is Outcome.MISTAKE
            assert transition.mistake == mistake


@pytest.mark.parametrize("task", TASKS, ids=lambda t: t.id)
def test_every_out_of_order_mistake_can_happen(task):
    """An out_of_order MistakeDef on a step with no prerequisites could never fire."""
    for mistake in task.mistakes:
        if mistake.kind is MistakeKind.OUT_OF_ORDER:
            assert task.step(mistake.step).requires, mistake.id
