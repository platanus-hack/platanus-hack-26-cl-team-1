"""VlmPerception with an injected fake model (no network)."""

import asyncio
import base64
import io
import json
from pathlib import Path

import openai
import pytest
from contracts import Frame, Ontology, Perception, Quality, Source
from contracts.protocol import pack_frame
from fastapi.testclient import TestClient
from PIL import Image

from app.library.store import TaskLibrary
from app.main import create_app
from app.perception import factory
from app.perception.prompt import task_json_schema
from app.perception.vlm import VlmPerception, downscale_jpeg, pick_frames
from app.settings import PerceptionMode, Settings, VoiceMode

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"


@pytest.fixture(scope="module")
def task():
    return TaskLibrary.load(TASKS_DIR).get("hand_hygiene_basic")


@pytest.fixture(scope="module")
def ontology():
    return Ontology.model_validate_json((TASKS_DIR / "hand_hygiene" / "ontology.json").read_text())


def jpeg(width=64, height=48, color=(200, 100, 50)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (width, height), color).save(out, format="JPEG")
    return out.getvalue()


def frames(n=3, step_ms=500, **kw) -> list[Frame]:
    return [Frame(seq=i, t_ms=i * step_ms, jpeg=jpeg(**kw), source=Source.WEBCAM) for i in range(n)]


class FakeModel:
    """Records every call and answers with the queued replies (str = raw text, Exception = raised)."""

    def __init__(self, *replies):
        self.replies = list(replies)
        self.calls: list[tuple[list[dict], dict]] = []

    async def __call__(self, messages, json_schema):
        self.calls.append((messages, json_schema))
        reply = self.replies.pop(0) if len(self.replies) > 1 else self.replies[0]
        if isinstance(reply, Exception):
            raise reply
        return reply


class Clock:
    def __init__(self):
        self.now = 100.0

    def __call__(self):
        return self.now


def answer(**kw) -> str:
    base = {"action": None, "confidence": 0.0, "quality": "unknown", "objects": [], "note": ""}
    return json.dumps(base | kw)


def make(model, ontology, clock=None, **kw) -> VlmPerception:
    return VlmPerception(model, ontology, model="qwen-test", clock=clock or Clock(), **kw)


def observe(perception, task, fs=None, next_steps=("wet",)):
    return asyncio.run(perception.observe(fs or frames(), task, list(next_steps)))


def test_it_satisfies_the_interface(ontology):
    assert isinstance(make(FakeModel(answer()), ontology), Perception)


def test_prompt_carries_the_task_and_the_frames(task, ontology):
    model = FakeModel(answer())
    observe(make(model, ontology), task, next_steps=["wet"])
    messages, schema = model.calls[0]
    assert messages[0]["role"] == "system"
    content = messages[1]["content"]
    images = [c for c in content if c["type"] == "image_url"]
    assert len(images) == 2  # newest + one ~1 s older
    assert images[0]["image_url"]["url"].startswith("data:image/jpeg;base64,")
    text = content[-1]["text"]
    assert "wet_hands: hands held under running water from the faucet (mojar las manos)" in text
    assert "paper_towel" in text
    assert "Expected next" in text and "wet_hands: done when both hands are wet" in text
    assert "action touch_faucet_bare: a clean bare hand turns the faucet off" in text  # wrong_action
    assert 'rub_palms with quality "bad"' in text  # incomplete
    assert schema == task_json_schema(task)


def test_schema_is_narrowed_to_the_task(task):
    schema = task_json_schema(task)
    assert schema["properties"]["action"]["anyOf"][0]["enum"] == list(task.actions)
    assert schema["properties"]["objects"]["items"]["enum"] == list(task.objects)
    assert schema["additionalProperties"] is False


def test_valid_answer_becomes_an_observation(task, ontology):
    model = FakeModel(answer(action="wet_hands", confidence=0.8, quality="ok", objects=["hands", "faucet"]))
    fs = frames()
    obs = observe(make(model, ontology), task, fs)
    assert obs.output.action == "wet_hands"
    assert obs.output.confidence == 0.8
    assert obs.output.objects == ("hands", "faucet")
    assert (obs.seq, obs.t_ms, obs.source, obs.model) == (fs[-1].seq, fs[-1].t_ms, Source.WEBCAM, "qwen-test")
    assert obs.latency_ms >= 0


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "",
        answer(action="juggle", confidence=0.9, quality="ok"),  # action outside the task
        answer(action="wet_hands", confidence=0.9, quality="ok", objects=["car"]),  # object outside the task
        answer(action=None, confidence=0.9, quality="ok"),  # contradictory: null action, quality ok
        answer(action="wet_hands", confidence=1.7, quality="ok"),
    ],
)
def test_bad_answer_becomes_uncertain_never_raises(task, ontology, raw):
    obs = observe(make(FakeModel(raw), ontology), task)
    assert obs.output.action is None
    assert obs.output.quality is Quality.UNKNOWN
    assert obs.output.note.startswith("invalid model output")


def test_server_failure_raises(task, ontology):
    model = FakeModel(openai.APIConnectionError(request=None))  # type: ignore[arg-type]
    with pytest.raises(openai.APIConnectionError):
        observe(make(model, ontology), task)


def test_rate_limited_between_calls(task, ontology):
    clock = Clock()
    model = FakeModel(answer())
    perception = make(model, ontology, clock=clock, min_interval_ms=1500)
    assert observe(perception, task) is not None
    clock.now += 1.0
    assert observe(perception, task) is None  # too soon: no call
    clock.now += 0.6
    assert observe(perception, task) is not None
    assert len(model.calls) == 2


def test_one_call_in_flight(task, ontology):
    release = asyncio.Event()

    class Slow(FakeModel):
        async def __call__(self, messages, json_schema):
            await release.wait()
            return await super().__call__(messages, json_schema)

    model = Slow(answer())
    perception = make(model, ontology, min_interval_ms=0)

    async def run():
        first = asyncio.create_task(perception.observe(frames(), task, []))
        await asyncio.sleep(0)
        second = await perception.observe(frames(), task, [])
        release.set()
        return await first, second

    first, second = asyncio.run(run())
    assert first is not None and second is None
    assert len(model.calls) == 1


def test_no_frames_no_call(task, ontology):
    model = FakeModel(answer())
    assert asyncio.run(make(model, ontology).observe([], task, [])) is None
    assert model.calls == []


def test_pick_frames_newest_plus_one_about_span_older():
    fs = frames(n=6, step_ms=300)  # t = 0, 300, …, 1500
    assert [f.t_ms for f in pick_frames(fs, span_ms=1000)] == [600, 1500]
    assert [f.t_ms for f in pick_frames(fs[-1:], span_ms=1000)] == [1500]
    assert [f.t_ms for f in pick_frames(fs, span_ms=0)] == [1500]


def test_pick_frames_spreads_more_frames_over_the_span():
    fs = frames(n=8, step_ms=170)  # ~6 fps: t = 0, 170, …, 1190 (the session's 8-frame window)
    assert [f.t_ms for f in pick_frames(fs, span_ms=1100, count=3)] == [170, 680, 1190]
    assert [f.t_ms for f in pick_frames(fs[-2:], span_ms=1100, count=3)] == [1020, 1190]  # fewer frames
    assert [f.t_ms for f in pick_frames(fs, span_ms=1100, count=1)] == [1190]


def test_downscale_keeps_small_frames_and_shrinks_big_ones():
    small = jpeg(320, 240)
    assert downscale_jpeg(small, 640) is small
    big = downscale_jpeg(jpeg(1280, 720), 640)
    with Image.open(io.BytesIO(big)) as img:
        assert img.size == (640, 360)
    with pytest.raises(Exception):  # noqa: B017 - PIL raises its own error type
        downscale_jpeg(b"\xff\xd8not a jpeg", 640)


def test_frames_are_sent_downscaled(task, ontology):
    model = FakeModel(answer())
    observe(make(model, ontology, max_side_px=100), task, frames(n=1, width=400, height=200))
    url = model.calls[0][0][1]["content"][0]["image_url"]["url"]
    with Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))) as img:
        assert img.size == (100, 50)


def test_vlm_mode_needs_a_base_url():
    with pytest.raises(ValueError, match="SUP_VLM_BASE_URL"):
        Settings(
            tasks_dir=TASKS_DIR, perception=PerceptionMode.VLM, scripted_every_ms=0, scripted_mistake=None,
            voice=VoiceMode.BROWSER, cors_origins=(),
        )  # fmt: skip


def test_session_runs_on_the_vlm(monkeypatch):
    """Through the WebSocket: real JPEG frames → fake model → observation → the controller advances."""
    model = FakeModel(answer(action="wet_hands", confidence=0.9, quality="ok"))
    monkeypatch.setattr(factory, "_completer", lambda *a: model)
    settings = Settings(
        tasks_dir=TASKS_DIR, perception=PerceptionMode.VLM, scripted_every_ms=0, scripted_mistake=None,
        voice=VoiceMode.BROWSER, cors_origins=(), vlm_base_url="http://vlm.invalid/v1", vlm_min_interval_ms=0,
    )  # fmt: skip
    client = TestClient(create_app(settings))
    with client.websocket_connect("/ws/session") as ws:
        hello = {"type": "hello", "protocol": 1, "task_id": "hand_hygiene_basic", "source": "webcam"}
        hello["debug"] = True
        ws.send_text(json.dumps(hello))
        assert ws.receive_json()["type"] == "ready"
        ws.send_bytes(pack_frame(0, 0, jpeg()))
        seen = []
        while not any(m["type"] == "state" and m["statuses"]["wet"] == "done" for m in seen):
            seen.append(ws.receive_json())
        observations = [m["observation"] for m in seen if m["type"] == "debug" and m.get("observation")]
        assert observations[0]["output"]["action"] == "wet_hands"
        assert observations[0]["model"] == settings.vlm_model
    assert model.calls


def test_records_frames_and_answers_when_asked(task, ontology, tmp_path):
    model = FakeModel(answer(action="wet_hands", confidence=0.8, quality="ok"))
    observe(make(model, ontology, record_dir=tmp_path), task, next_steps=["wet"])
    lines = (tmp_path / "calls.jsonl").read_text().splitlines()
    record = json.loads(lines[0])
    assert record["output"]["action"] == "wet_hands"
    assert record["next_steps"] == ["wet"]
    assert [(tmp_path / f).exists() for f in record["frames"]] == [True, True]
