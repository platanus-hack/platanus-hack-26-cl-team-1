import json
from pathlib import Path

import pytest
from contracts import Controller, Event, MistakeKind, Observation, Quality, Source, StepStatus, VlmOutput
from contracts.protocol import pack_frame
from fastapi.testclient import TestClient

from app.controller.rules import RulesController
from app.library.store import TaskLibrary
from app.main import create_app
from app.settings import PerceptionMode, Settings, VoiceMode

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"


@pytest.fixture(scope="module")
def task():
    return TaskLibrary.load(TASKS_DIR).get("hand_hygiene_basic")


def obs(action, t_ms=0, confidence=0.9, quality=None, seq=1):
    quality = quality or (Quality.OK if action else Quality.UNKNOWN)
    output = VlmOutput(action=action, confidence=confidence, quality=quality)
    return Observation(seq=seq, t_ms=t_ms, source=Source.SIM, model="test", latency_ms=0, output=output)


# ── library ──────────────────────────────────────────────────────────────────


def test_library_loads_and_validates_the_repo_tasks():
    library = TaskLibrary.load(TASKS_DIR)
    assert sorted(s.id for s in library.summaries()) == ["hand_hygiene_basic", "servo_scout_robot"]


def test_library_refuses_an_invalid_task(tmp_path):
    domain = tmp_path / "hand_hygiene"
    domain.mkdir()
    (domain / "ontology.json").write_text((TASKS_DIR / "hand_hygiene" / "ontology.json").read_text())
    bad = json.loads((TASKS_DIR / "hand_hygiene" / "hand_hygiene_basic.json").read_text())
    bad["actions"].append("juggle")
    (domain / "bad.json").write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="juggle"):
        TaskLibrary.load(tmp_path)


# ── rule controller ──────────────────────────────────────────────────────────


def test_rules_controller_satisfies_the_interface():
    assert isinstance(RulesController(), Controller)


def test_start_greets_with_the_first_step(task):
    decision = RulesController().start(task)
    assert decision.event is Event.REMINDER
    assert decision.statuses["wet"] is StepStatus.ACTIVE
    assert "Moja tus manos" in decision.say.text


def test_correct_action_advances_and_announces_the_next_step(task):
    controller = RulesController()
    controller.start(task)
    decision = controller.decide(obs("wet_hands"))
    assert (decision.event, decision.step) == (Event.STEP_DONE, "wet")
    assert decision.statuses["wet"] is StepStatus.DONE
    assert decision.say.text == "Bien. Ahora aplica jabón en la palma."


@pytest.mark.parametrize(
    ("observation", "expected"),
    [
        pytest.param(obs(None), Event.NONE, id="uncertain"),
        pytest.param(obs("wet_hands", confidence=0.3), Event.NONE, id="low_confidence"),
    ],
)
def test_uncertain_observations_change_nothing_and_say_nothing(task, observation, expected):
    controller = RulesController()
    controller.start(task)
    decision = controller.decide(observation)
    assert (decision.event, decision.say) == (expected, None)
    assert decision.statuses["wet"] is StepStatus.ACTIVE


def test_defined_mistake_uses_the_task_correction(task):
    controller = RulesController()
    controller.start(task)
    decision = controller.decide(obs("apply_soap"))
    assert (decision.event, decision.mistake_kind, decision.mistake_id) == (
        Event.MISTAKE, MistakeKind.OUT_OF_ORDER, "soap_before_wet",
    )  # fmt: skip
    assert decision.say.text == "Ojo, primero hay que mojarse las manos."
    assert decision.statuses["wet"] is StepStatus.MISTAKE


def test_bad_quality_is_incomplete_and_does_not_advance(task):
    controller = RulesController()
    controller.start(task)
    for action in ["wet_hands", "apply_soap"]:
        controller.decide(obs(action))
    decision = controller.decide(obs("rub_palms", quality=Quality.BAD))
    assert (decision.mistake_kind, decision.mistake_id) == (MistakeKind.INCOMPLETE, "short_rub")
    assert decision.statuses["palms"] is not StepStatus.DONE


def test_repeated_action_is_silent(task):
    controller = RulesController()
    controller.start(task)
    controller.decide(obs("wet_hands"))
    assert controller.decide(obs("wet_hands")).event is Event.NONE


def test_reminder_after_inactivity(task):
    controller = RulesController(remind_after_ms=10_000)
    controller.start(task)
    assert controller.tick(1_000) is None
    assert controller.tick(5_000) is None
    decision = controller.tick(11_000)
    assert (decision.event, decision.step) == (Event.REMINDER, "wet")
    assert controller.tick(12_000) is None


# ── session WebSocket, end to end with the scripted fake ────────────────────


def test_session_runs_a_scripted_task_end_to_end():
    settings = Settings(
        tasks_dir=TASKS_DIR, perception=PerceptionMode.SCRIPTED, scripted_every_ms=5000,
        scripted_mistake=None, voice=VoiceMode.BROWSER, cors_origins=(),
    )  # fmt: skip
    client = TestClient(create_app(settings))
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(
            json.dumps({"type": "hello", "protocol": 1, "task_id": "hand_hygiene_basic", "source": "sim"})
        )
        assert ws.receive_json()["type"] == "ready"
        received = []
        for seq in range(40):  # 20 s of client time: a step every 5 s leaves room for each line
            ws.send_bytes(pack_frame(seq, seq * 500, b"\xff\xd8fake"))
            while True:
                message = ws.receive_json()
                received.append(message)
                if message["type"] == "debug" and message["seq"] == seq:
                    break
        # drain what perception emitted after the last ack
        last_state = [m for m in received if m["type"] == "state"][-1]
        says = [m["text"] for m in received if m["type"] == "say"]
    assert says[0].startswith("Vamos con")
    assert any(text.startswith("Bien.") for text in says)
    assert all(m["audio"] is False for m in received if m["type"] == "say")
    assert last_state["statuses"]["wet"] == "done"


def test_session_rejects_unknown_task():
    client = TestClient(create_app())
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps({"type": "hello", "protocol": 1, "task_id": "nope", "source": "sim"}))
        assert ws.receive_json() == {"type": "error", "code": "unknown_task", "message": "no task 'nope'"}


def test_tasks_api_lists_the_library():
    client = TestClient(create_app())
    assert {t["id"] for t in client.get("/api/tasks").json()} == {"hand_hygiene_basic", "servo_scout_robot"}
    assert client.get("/api/tasks/nope").status_code == 404


# ── after the task is complete (review finding on PR #14) ───────────────────

ALL_STEPS = [
    "wet_hands",
    "apply_soap",
    "rub_palms",
    "rub_backs",
    "rinse_hands",
    "dry_hands",
    "close_faucet_towel",
]


def finished_controller(task):
    controller = RulesController()
    controller.start(task)
    for action in ALL_STEPS:
        last = controller.decide(obs(action))
    assert last.event is Event.TASK_DONE
    return controller


@pytest.mark.parametrize(
    "observation",
    [
        pytest.param(obs("touch_faucet_bare"), id="defined_wrong_action"),
        pytest.param(obs("juggle"), id="unknown_action"),
        pytest.param(obs("rub_palms", quality=Quality.BAD), id="bad_quality"),
        pytest.param(obs("wet_hands"), id="repeated"),
    ],
)
def test_observations_after_completion_are_ignored(task, observation):
    decision = finished_controller(task).decide(observation)
    assert (decision.event, decision.say, decision.next_steps) == (Event.NONE, None, ())
    assert set(decision.statuses.values()) == {StepStatus.DONE}


def test_skip_after_completion_is_a_no_op(task):
    controller = finished_controller(task)
    decision = controller.skip(99_000)
    assert (decision.event, decision.say) == (Event.NONE, None)
    assert controller.tick(200_000) is None


def test_session_survives_skip_after_completion():
    settings = Settings(
        tasks_dir=TASKS_DIR, perception=PerceptionMode.SCRIPTED, scripted_every_ms=10, scripted_mistake=None,
        voice=VoiceMode.BROWSER, cors_origins=(),
    )  # fmt: skip
    client = TestClient(create_app(settings))
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(
            json.dumps({"type": "hello", "protocol": 1, "task_id": "hand_hygiene_basic", "source": "sim"})
        )
        ws.receive_json()  # ready
        for _ in range(7):
            ws.send_text(json.dumps({"type": "skip_step"}))
        for _ in range(3):
            ws.send_text(json.dumps({"type": "skip_step"}))  # after completion
        ws.send_bytes(pack_frame(0, 0, b"\xff\xd8fake"))
        messages = []
        while True:
            message = ws.receive_json()
            messages.append(message)
            if message["type"] == "debug":
                break
    assert not [m for m in messages if m["type"] == "error"]
    assert [m for m in messages if m["type"] == "state"][-1]["next_steps"] == []


# ── reset (review finding on PR #14) ─────────────────────────────────────────


def run_frames(ws, start_seq, count, step_ms=50, t0=0):
    messages = []
    for i in range(count):
        seq = start_seq + i
        ws.send_bytes(pack_frame(seq, t0 + i * step_ms, b"\xff\xd8fake"))
        while True:
            message = ws.receive_json()
            messages.append(message)
            if message["type"] == "debug" and message["seq"] == seq:
                break
    return messages


def test_reset_clears_the_issue_and_replays_perception():
    settings = Settings(
        tasks_dir=TASKS_DIR, perception=PerceptionMode.SCRIPTED, scripted_every_ms=100, scripted_mistake=None,
        voice=VoiceMode.BROWSER, cors_origins=(),
    )  # fmt: skip
    client = TestClient(create_app(settings))
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(
            json.dumps({"type": "hello", "protocol": 1, "task_id": "hand_hygiene_basic", "source": "sim"})
        )
        ws.receive_json()  # ready
        first = run_frames(ws, 0, 12)
        assert [m for m in first if m["type"] == "state"][-1]["statuses"]["wet"] == "done"

        ws.send_text(json.dumps({"type": "reset"}))
        after_reset = []
        while True:
            message = ws.receive_json()
            after_reset.append(message)
            if message["type"] == "say":
                break
        state = next(m for m in after_reset if m["type"] == "state")
        assert set(state["statuses"].values()) == {"active", "pending"}  # nothing done anymore

        # A fresh scripted perception replays from the start on the new frames.
        replay = run_frames(ws, 100, 12, t0=10_000)
        assert [m for m in replay if m["type"] == "state"][-1]["statuses"]["wet"] == "done"


def test_persistent_mistake_is_announced_once(task):
    controller = RulesController()
    controller.start(task)
    first = controller.decide(obs("apply_soap"))
    again = controller.decide(obs("apply_soap"))
    assert (first.event, again.event, again.say) == (Event.MISTAKE, Event.NONE, None)
    assert again.statuses["wet"] is StepStatus.MISTAKE  # still shown
    controller.decide(obs("wet_hands"))  # progress clears it
    assert controller.decide(obs("juggle")).event is Event.MISTAKE


def scripted_client(mistake=None):
    settings = Settings(
        tasks_dir=TASKS_DIR, perception=PerceptionMode.SCRIPTED, scripted_every_ms=100,
        scripted_mistake=mistake, voice=VoiceMode.BROWSER, cors_origins=(),
    )  # fmt: skip
    return TestClient(create_app(settings))


def hello(**extra):
    return json.dumps(
        {"type": "hello", "protocol": 1, "task_id": "hand_hygiene_basic", "source": "sim", **extra}
    )


def test_reset_with_an_open_issue_sends_issue_clear():
    with scripted_client(mistake="touch_faucet_bare").websocket_connect("/ws/session") as ws:
        ws.send_text(hello())
        ws.receive_json()  # ready
        # wet at 100 ms, the mistake at 200 ms; stop before the next step (300 ms) would clear it.
        messages = run_frames(ws, 0, 5)
        while not any(m["type"] == "say" and m["priority"] == "urgent" for m in messages):
            messages.append(ws.receive_json())  # the issue, then its spoken correction
        assert next(m for m in messages if m["type"] == "issue")["mistake_id"] == "bare_faucet"
        ws.send_text(json.dumps({"type": "reset"}))
        after = []
        while not after or after[-1]["type"] != "say":
            after.append(ws.receive_json())
    assert [m["type"] for m in after if m["type"] != "debug"] == ["issue_clear", "cancel_say", "state", "say"]


def test_fixing_a_mistake_cancels_its_correction_if_still_playing():
    with scripted_client(mistake="touch_faucet_bare").websocket_connect("/ws/session") as ws:
        ws.send_text(hello())
        ws.receive_json()  # ready
        # wet at 100 ms, the mistake at 200 ms, soap at 300 ms (clears the issue while the line plays)
        messages = run_frames(ws, 0, 14)
    types = [m["type"] for m in messages]
    urgent = next(m for m in messages if m["type"] == "say" and m["priority"] == "urgent")
    cancel = next(m for m in messages if m["type"] == "cancel_say")
    assert cancel["id"] == urgent["id"]
    assert types.index("cancel_say") == types.index("issue_clear") + 1


def test_reset_drops_a_perception_result_from_before_the_reset(task):
    import asyncio

    from contracts import Frame
    from contracts.fakes import SilentVoice
    from contracts.protocol import Hello

    from app.session.ws import Session

    class FakeWs:
        def __init__(self):
            self.sent = []

        async def send_text(self, text):
            self.sent.append(json.loads(text))

        async def send_bytes(self, data):
            self.sent.append(data)

    class SlowPerception:
        def __init__(self):
            self.release = asyncio.Event()

        async def observe(self, frames, task, next_steps):
            await self.release.wait()
            return obs("wet_hands", seq=frames[-1].seq)

    async def scenario():
        perceptions = []

        def make(t):
            perceptions.append(SlowPerception())
            return perceptions[-1]

        ws = FakeWs()
        session = Session(
            ws, task, Hello(task_id=task.id, source="sim"), make, RulesController(), SilentVoice()
        )
        await session.emit(session.controller.start(task))
        frame = Frame(seq=1, t_ms=0, jpeg=b"x", source=Source.SIM)
        stale = asyncio.create_task(session.perceive([frame], session.generation))
        await asyncio.sleep(0)
        generation = session.generation
        session.generation += 1  # what reset does first, before awaiting anything
        perceptions[0].release.set()
        await stale
        return ws.sent, generation

    sent, _ = asyncio.run(scenario())
    states = [m for m in sent if isinstance(m, dict) and m["type"] == "state"]
    assert all(m["statuses"]["wet"] != "done" for m in states)


def test_session_reset_clears_frames_and_rebuilds_perception():
    with scripted_client().websocket_connect("/ws/session") as ws:
        ws.send_text(hello())
        ws.receive_json()
        run_frames(ws, 0, 4)
        ws.send_text(json.dumps({"type": "reset"}))
        for _ in range(2):
            ws.receive_json()  # state, say
        # Frames restart at t=0 relative to a new perception: the first event comes 100 ms after them.
        replay = run_frames(ws, 50, 4, t0=50_000)
    assert [m for m in replay if m["type"] == "state"][-1]["statuses"]["wet"] == "done"


@pytest.mark.parametrize(
    ("first", "second", "expected_error"),
    [
        pytest.param(hello(record=True), None, "recording is not implemented", id="record_hello"),
        pytest.param(hello(), json.dumps({"type": "label", "step": "wet"}), "label ignored", id="label"),
    ],
)
def test_recording_fails_loudly_until_implemented(first, second, expected_error):
    with scripted_client().websocket_connect("/ws/session") as ws:
        ws.send_text(first)
        message = ws.receive_json()
        if second is not None:
            assert message["type"] == "ready"
            for _ in range(2):
                ws.receive_json()  # initial state, greeting
            ws.send_text(second)
            message = ws.receive_json()
    assert message["type"] == "error" and expected_error in message["message"]


def test_unknown_scripted_mistake_is_reported():
    with scripted_client(mistake="touch_faucet_bar").websocket_connect("/ws/session") as ws:
        ws.send_text(hello())
        message = ws.receive_json()
    assert message["type"] == "error" and "touch_faucet_bar" in message["message"]


def test_slow_voice_does_not_block_frames(monkeypatch):
    """Review finding on PR #22: a slow TTS call stalled the frame loop."""
    import asyncio
    import time

    class SlowVoice:
        async def synthesize(self, request):
            await asyncio.sleep(30)

    monkeypatch.setattr("app.main.make_voice", lambda settings: SlowVoice())
    with scripted_client().websocket_connect("/ws/session") as ws:
        ws.send_text(hello())
        ws.receive_json()  # ready; the greeting is now stuck in synthesis
        started = time.monotonic()
        messages = run_frames(ws, 0, 5)
        elapsed = time.monotonic() - started
    assert elapsed < 2
    assert [m["seq"] for m in messages if m["type"] == "debug"] == [0, 1, 2, 3, 4]
    assert not any(m["type"] == "say" for m in messages)
