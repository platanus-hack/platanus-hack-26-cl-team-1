import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from contracts import (
    ClipRecord,
    Decision,
    Event,
    InvalidVlmOutput,
    MistakeKind,
    Ontology,
    Outcome,
    Task,
    TaskAutomaton,
    VlmOutput,
    parse_vlm_output,
)
from contracts.export import main as export_main
from contracts.protocol import (
    Hello,
    client_message_adapter,
    pack_audio,
    pack_frame,
    server_message_adapter,
    unpack_audio,
    unpack_frame,
)

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


@pytest.fixture(scope="module")
def ontology() -> Ontology:
    return Ontology.model_validate_json((EXAMPLES / "ontology.hand_hygiene.json").read_text())


@pytest.fixture(scope="module")
def task_data() -> dict:
    return json.loads((EXAMPLES / "task.hand_hygiene_basic.json").read_text())


@pytest.fixture(scope="module")
def task(task_data) -> Task:
    return Task.model_validate(task_data)


def with_changes(data: dict, **changes) -> dict:
    return {**data, **changes}


# ── ontology ─────────────────────────────────────────────────────────────────


def test_example_task_fits_its_ontology(task, ontology):
    task.check_against(ontology)


def test_ontology_rejects_unknown_object_reference(ontology):
    data = ontology.model_dump()
    data["actions"][0]["object"] = "scalpel"
    with pytest.raises(ValidationError, match="unknown object 'scalpel'"):
        Ontology.model_validate(data)


def test_ontology_rejects_duplicate_action_ids(ontology):
    data = ontology.model_dump()
    data["actions"] = [*data["actions"], data["actions"][0]]
    with pytest.raises(ValidationError, match="duplicate action ids"):
        Ontology.model_validate(data)


def test_task_using_an_action_outside_the_ontology_is_rejected(task_data, ontology):
    task = Task.model_validate(with_changes(task_data, actions=[*task_data["actions"], "juggle"]))
    with pytest.raises(ValueError, match=r"actions \['juggle'\]"):
        task.check_against(ontology)


# ── task validation ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        pytest.param(
            lambda d: d["steps"][1].update(requires=["rinse"]), "isn't an earlier step", id="forward_ref"
        ),
        pytest.param(
            lambda d: d["steps"][0].update(requires=["wet"]), "isn't an earlier step", id="self_loop"
        ),
        pytest.param(
            lambda d: d["steps"][0].update(action="juggle"), "not in task actions", id="step_action"
        ),
        pytest.param(
            lambda d: d["steps"][1].update(action="wet_hands"), "duplicate step action", id="dup_action"
        ),
        pytest.param(lambda d: d["steps"].append(dict(d["steps"][0])), "duplicate step ids", id="dup_step"),
        pytest.param(
            lambda d: d["mistakes"][0].update(step="nope"), "unknown step 'nope'", id="mistake_step"
        ),
        pytest.param(
            lambda d: d["mistakes"][2].update(action="dry_hands"), "completes a step", id="mistake_action"
        ),
        pytest.param(
            lambda d: d["mistakes"][2].update(action=None), "needs `action`", id="wrong_action_no_action"
        ),
        pytest.param(
            lambda d: d["mistakes"][0].update(action="dry_hands"), "only wrong_action", id="action_on_other"
        ),
        pytest.param(lambda d: d.update(steps=[]), "at least 1", id="no_steps"),
        pytest.param(lambda d: d.update(extra_field=1), "Extra inputs", id="extra_field"),
        pytest.param(lambda d: d["steps"][0].update(id="Wet Hands"), "pattern", id="bad_id"),
    ],
)
def test_task_rejects_invalid_definitions(task_data, mutate, message):
    data = json.loads(json.dumps(task_data))
    mutate(data)
    with pytest.raises(ValidationError, match=message):
        Task.model_validate(data)


# ── automaton ────────────────────────────────────────────────────────────────


def test_legal_next_follows_the_step_graph(task):
    automaton = TaskAutomaton(task)
    assert automaton.legal_next(automaton.start) == ["wet"]
    assert automaton.legal_next({"wet", "soap"}) == ["palms", "backs"]
    assert automaton.legal_next({"wet", "soap", "palms"}) == ["backs"]


def test_a_correct_run_reaches_task_done(task):
    automaton = TaskAutomaton(task)
    done = automaton.start
    outcomes = []
    for action in [
        "wet_hands",
        "apply_soap",
        "rub_backs",
        "rub_palms",
        "rinse_hands",
        "dry_hands",
        "close_faucet_towel",
    ]:
        transition = automaton.apply(done, action)
        outcomes.append(transition.outcome)
        done = transition.done
    assert outcomes == [Outcome.ADVANCE] * 6 + [Outcome.TASK_DONE]


@pytest.mark.parametrize(
    ("done", "action", "kind", "mistake_id"),
    [
        pytest.param(
            set(), "apply_soap", MistakeKind.OUT_OF_ORDER, "soap_before_wet", id="out_of_order_defined"
        ),
        pytest.param(set(), "rinse_hands", MistakeKind.OUT_OF_ORDER, None, id="out_of_order_generic"),
        pytest.param({"wet"}, "wet_hands", MistakeKind.REPEATED, None, id="repeated"),
        pytest.param(
            {"wet"}, "touch_faucet_bare", MistakeKind.WRONG_ACTION, "bare_faucet", id="wrong_defined"
        ),
        pytest.param({"wet"}, "juggle", MistakeKind.WRONG_ACTION, None, id="wrong_unknown"),
    ],
)
def test_mistakes_leave_the_state_unchanged(task, done, action, kind, mistake_id):
    transition = TaskAutomaton(task).apply(done, action)
    assert transition.outcome is Outcome.MISTAKE
    assert transition.kind is kind
    assert (transition.mistake.id if transition.mistake else None) == mistake_id
    assert transition.done == frozenset(done)


# ── perception ───────────────────────────────────────────────────────────────


def test_parse_vlm_output_accepts_a_valid_answer(task):
    raw = '{"action": "apply_soap", "confidence": 0.8, "quality": "ok", "objects": ["soap", "hands"]}'
    assert parse_vlm_output(raw, task).action == "apply_soap"


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param("not json", id="not_json"),
        pytest.param('{"action": "juggle", "confidence": 0.9, "quality": "ok"}', id="action_outside_task"),
        pytest.param('{"action": null, "confidence": 0.9, "quality": "ok"}', id="null_action_with_quality"),
        pytest.param('{"action": "wet_hands", "confidence": 1.5, "quality": "ok"}', id="confidence_range"),
        pytest.param(
            '{"action": "wet_hands", "confidence": 0.5, "quality": "ok", "objects": ["scalpel"]}', id="obj"
        ),
        pytest.param(
            '{"action": "wet_hands", "confidence": 0.5, "quality": "ok", "verdict": "x"}', id="extra"
        ),
    ],
)
def test_parse_vlm_output_rejects_bad_answers(task, raw):
    with pytest.raises(InvalidVlmOutput):
        parse_vlm_output(raw, task)


def test_null_action_means_uncertain():
    output = VlmOutput(action=None, confidence=0.2, quality="unknown")
    assert output.action is None


# ── decision ─────────────────────────────────────────────────────────────────


def test_decision_ties_mistake_kind_to_the_mistake_event():
    base = {"seq": 1, "statuses": {"wet": "active"}, "next_steps": ["wet"]}
    Decision(event=Event.MISTAKE, mistake_kind=MistakeKind.OUT_OF_ORDER, **base)
    with pytest.raises(ValidationError, match="mistake_kind"):
        Decision(event=Event.MISTAKE, **base)
    with pytest.raises(ValidationError, match="mistake_kind"):
        Decision(event=Event.STEP_DONE, mistake_kind=MistakeKind.REPEATED, **base)
    with pytest.raises(ValidationError, match="says nothing"):
        Decision(event=Event.NONE, say={"text": "hola"}, **base)


# ── protocol ─────────────────────────────────────────────────────────────────


def test_client_messages_are_discriminated_by_type():
    message = client_message_adapter.validate_json(
        '{"type": "hello", "protocol": 1, "task_id": "t", "source": "webcam"}'
    )
    assert isinstance(message, Hello)
    with pytest.raises(ValidationError):
        client_message_adapter.validate_json(
            '{"type": "hello", "protocol": 2, "task_id": "t", "source": "webcam"}'
        )
    with pytest.raises(ValidationError):
        client_message_adapter.validate_json('{"type": "dance"}')


def test_server_ready_carries_the_full_task(task):
    message = server_message_adapter.validate_python(
        {"type": "ready", "session_id": "s1", "task": task.model_dump()}
    )
    assert message.task == task


def test_frame_round_trip_and_bounds():
    assert unpack_frame(pack_frame(7, 1234, b"\xff\xd8jpeg")) == (7, 1234, b"\xff\xd8jpeg")
    with pytest.raises(ValueError):
        pack_frame(-1, 0, b"x")
    with pytest.raises(ValueError):
        unpack_frame(b"\x00" * 8)


def test_audio_round_trip_and_bounds():
    assert unpack_audio(pack_audio("c12", b"mp3")) == ("c12", b"mp3")
    with pytest.raises(ValueError):
        pack_audio("", b"mp3")
    with pytest.raises(ValueError):
        unpack_audio(b"\x05ab")


# ── dataset ──────────────────────────────────────────────────────────────────


def test_clip_mistake_id_is_set_exactly_when_incorrect():
    base = {
        "id": "c1", "task_id": "t", "task_version": 1, "run_id": "r1", "split": "train", "source": "runway",
        "path": "clips/c1.mp4", "duration_s": 5, "fps": 24, "action": "wet_hands", "step": "wet",
    }  # fmt: skip
    ClipRecord(is_correct=True, **base)
    ClipRecord(is_correct=False, mistake_id="soap_before_wet", **base)
    with pytest.raises(ValidationError):
        ClipRecord(is_correct=False, **base)


# ── generated schemas ────────────────────────────────────────────────────────


def test_committed_schemas_are_up_to_date():
    assert export_main(["--check"]) == 0
