"""The learned controller as a `Controller`, on the committed weights (numpy only, no torch)."""

import json
from pathlib import Path

import pytest
from contracts import Controller, Event, Observation, Quality, Source, StepStatus, VlmOutput
from contracts.protocol import pack_frame
from fastapi.testclient import TestClient

from app.controller.factory import make_controller_factory
from app.controller.learned import LearnedController
from app.library.store import TaskLibrary
from app.main import create_app
from app.settings import ControllerMode, PerceptionMode, Settings, VoiceMode

REPO = Path(__file__).resolve().parents[2]
TASKS_DIR = REPO / "tasks"
WEIGHTS = REPO / "training" / "controller" / "weights"
LIBRARY = TaskLibrary.load(TASKS_DIR)
TASK = LIBRARY.get("hand_hygiene_basic")
CORRECT = [s.action for s in TASK.steps]


def obs(action, seq, quality=None, confidence=0.9):
    quality = quality or (Quality.OK if action else Quality.UNKNOWN)
    out = VlmOutput(action=action, confidence=confidence, quality=quality)
    return Observation(seq=seq, t_ms=seq * 1500, source=Source.SIM, model="t", latency_ms=0, output=out)


def settings(**kw):
    return Settings(
        tasks_dir=TASKS_DIR, perception=PerceptionMode.SCRIPTED, scripted_every_ms=100, scripted_mistake=None,
        voice=VoiceMode.BROWSER, cors_origins=(), **kw,
    )  # fmt: skip


def test_satisfies_the_interface():
    assert isinstance(LearnedController(WEIGHTS), Controller)


def test_clean_correct_run_reaches_task_done_in_legal_states():
    controller = LearnedController(WEIGHTS)
    first = controller.start(TASK)
    assert first.event is Event.REMINDER
    events, seq = [], 0
    for action in CORRECT:
        for _ in range(2):  # perception reports an ongoing action about twice
            seq += 1
            decision = controller.decide(obs(action, seq))
            events.append(decision.event)
            assert decision.event is not Event.MISTAKE
            done = {s for s, st in decision.statuses.items() if st is StepStatus.DONE}
            for step in TASK.steps:  # the tracked state is always a valid automaton state
                if step.id in done:
                    assert set(step.requires) <= done
    assert events.count(Event.STEP_DONE) == len(CORRECT) - 1
    assert Event.TASK_DONE in events


def test_flags_the_tasks_wrong_action():
    controller = LearnedController(WEIGHTS)
    controller.start(TASK)
    seq = 0
    for action in CORRECT[:-1]:
        for _ in range(2):
            seq += 1
            controller.decide(obs(action, seq))
    decisions = [controller.decide(obs("touch_faucet_bare", seq + k)) for k in (1, 2)]
    mistakes = [d for d in decisions if d.event is Event.MISTAKE]
    assert len(mistakes) == 1  # said once, not repeated
    assert mistakes[0].mistake_id == "bare_faucet"


def test_missing_weights_fail_at_startup(tmp_path):
    with pytest.raises(FileNotFoundError, match="hand_hygiene_basic"):
        make_controller_factory(
            settings(controller=ControllerMode.LEARNED, controller_weights_dir=tmp_path), LIBRARY
        )


def test_session_runs_with_the_learned_controller():
    client = TestClient(
        create_app(settings(controller=ControllerMode.LEARNED, controller_weights_dir=WEIGHTS))
    )
    assert client.get("/api/health").json()["controller"] == "learned"
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps({"type": "hello", "protocol": 1, "task_id": TASK.id, "source": "sim"}))
        assert ws.receive_json()["type"] == "ready"
        received = []
        for seq in range(40):
            ws.send_bytes(pack_frame(seq, seq * 50, b"\xff\xd8fake"))
            while True:
                message = ws.receive_json()
                received.append(message)
                if message["type"] == "debug" and message["seq"] == seq:
                    break
    says = [m["text"] for m in received if m["type"] == "say"]
    assert says[0].startswith("Vamos con")
    assert [m for m in received if m["type"] == "state"][-1]["statuses"]["wet"] == "done"
