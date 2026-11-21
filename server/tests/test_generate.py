import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from contracts import Ontology, Task

from app.library.generate import assemble_task, generate_task, task_output_schema
from app.library.store import TaskLibrary

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"
DOMAIN = TASKS_DIR / "robot_assembly"


@pytest.fixture(scope="module")
def ontology():
    return Ontology.model_validate_json((DOMAIN / "ontology.json").read_text())


@pytest.fixture(scope="module")
def stored():
    return Task.model_validate_json((DOMAIN / "servo_scout_robot.json").read_text())


def model_answer(task: Task) -> dict:
    """What the model returns for `task`: the generated fields only, with explicit nulls."""
    return {
        "title_es": task.title_es,
        "description": task.description,
        "objects": list(task.objects),
        "steps": [{**s.model_dump(mode="json"), "requires": list(s.requires)} for s in task.steps],
        "mistakes": [m.model_dump(mode="json") for m in task.mistakes],
    }


class FakeClient:
    """Stands in for `anthropic.Anthropic`: replays answers and records each request."""

    def __init__(self, answers: list[dict]) -> None:
        self.answers = list(answers)
        self.requests: list[dict] = []
        self.messages = self

    def create(self, **request):
        self.requests.append(request)
        text = json.dumps(self.answers.pop(0))
        return SimpleNamespace(stop_reason="end_turn", content=[SimpleNamespace(type="text", text=text)])


def test_robot_assembly_task_loads_with_its_ontology():
    task = TaskLibrary.load(TASKS_DIR).get("servo_scout_robot")
    assert task is not None and task.steps[-1].id == "power"


def test_schema_restricts_ids_to_the_ontology(ontology):
    schema = task_output_schema(ontology)
    step_action = schema["properties"]["steps"]["items"]["properties"]["action"]
    assert set(step_action["enum"]) == {a.id for a in ontology.actions}
    assert set(schema["properties"]["objects"]["items"]["enum"]) == {o.id for o in ontology.objects}


def test_assemble_rebuilds_the_stored_task(ontology, stored):
    assert assemble_task(model_answer(stored), ontology, stored.id) == stored


def test_assemble_rejects_an_action_whose_objects_are_not_listed(ontology, stored):
    raw = model_answer(stored)
    raw["objects"] = [o for o in raw["objects"] if o != "wheel"]
    with pytest.raises(ValueError, match="attach_wheel"):
        assemble_task(raw, ontology, stored.id)


def test_generate_sends_the_error_back_and_retries(ontology, stored):
    bad = model_answer(stored)
    bad["steps"][0]["requires"] = ["power"]  # forward reference: invalid DAG order
    client = FakeClient([bad, model_answer(stored)])

    task = generate_task("robot", ontology, stored.id, client=client, model="test")

    assert task == stored
    assert len(client.requests) == 2
    retry = client.requests[1]["messages"][-1]["content"]
    assert "invalid" in retry and "power" in retry


def test_generate_gives_up_loudly(ontology, stored):
    bad = model_answer(stored)
    bad["steps"][0]["action"] = bad["steps"][1]["action"]  # two steps share an action
    client = FakeClient([bad, bad])
    with pytest.raises(ValueError, match="no valid task after 2 attempts"):
        generate_task("robot", ontology, stored.id, client=client, model="test", max_attempts=2)
