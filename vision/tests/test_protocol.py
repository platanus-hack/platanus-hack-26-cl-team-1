import json

import pytest
from fastapi.testclient import TestClient

from tests.synth import frame_of_mat, jpeg
from vision import app as app_module
from vision.protocol import decode_frame, encode_audio, encode_frame
from vision.steps import StepBook, greeting, step_line

STEPS = [
    {
        "id": "bb-bb1",
        "index": 1,
        "kind": "breadboard",
        "title": "Prepara la protoboard",
        "detail": "x",
        "highlight": [],
    },
    {
        "id": "part-led1",
        "index": 2,
        "kind": "part",
        "title": "Coloca el LED rojo",
        "detail": "Pata larga (ánodo) en e10, pata corta (cátodo) en e11.",
        "highlight": ["led1", "bb1.e10", "bb1.e11"],
    },
    {
        "id": "wire-w1",
        "index": 3,
        "kind": "wire",
        "title": "Cable verde: Arduino D13 → e10",
        "detail": "Cable verde: desde el pin D13 del Arduino hasta e10.",
        "highlight": [],
    },
]


def hello(**kw):
    return {
        "type": "hello",
        "protocol": 1,
        "project": {"parts": [], "wires": []},
        "netlist": {"nets": [], "pinNet": {}, "insertions": []},
        "steps": STEPS,
        "parts": {},
        "record": False,
        "debug": True,
        **kw,
    }


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("CV_TTS", "0")
    monkeypatch.setattr(app_module, "DATA", tmp_path)
    with TestClient(app_module.app) as c:
        yield c


def recv_until(ws, type_, limit=20):
    for _ in range(limit):
        m = json.loads(ws.receive_text())
        if m["type"] == type_:
            return m
    raise AssertionError(f"no {type_}")


def test_codecs():
    seq, t, payload = decode_frame(encode_frame(7, 12345, b"\xff\xd8jpeg"))
    assert (seq, t, payload) == (7, 12345, b"\xff\xd8jpeg")
    assert encode_audio("c12", b"RIFF")[:4] == b"\x03c12"


def test_step_lines():
    assert step_line(STEPS[1]) == "Coloca el LED rojo: pata larga (ánodo) en e10, pata corta (cátodo) en e11."
    assert step_line(STEPS[2]) == "Cable verde: desde el pin D13 del Arduino hasta e10."
    assert greeting(STEPS[0]).startswith("Hola, empecemos. Primer paso: Prepara la protoboard")


def test_stepbook_skip_back_resume():
    b = StepBook(STEPS)
    assert b.current == 1 and b.status == {"1": "active", "2": "pending", "3": "pending"}
    assert b.complete_current()["index"] == 2
    assert b.back()["index"] == 1
    assert b.status == {"1": "active", "2": "pending", "3": "pending"}
    b2 = StepBook(STEPS, {"current": 3, "status": {"1": "done", "2": "done", "3": "active"}})
    assert b2.current == 3
    assert b2.complete_current() is None and b2.finished


def test_hello_ready_step_and_greeting(client):
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello()))
        ready = recv_until(ws, "ready")
        assert ready["calibrated"] is False
        cal = recv_until(ws, "calibration")
        assert cal["ok"] is False
        step = recv_until(ws, "step")
        assert step["current"] == 1 and step["status"]["1"] == "active"
        say = recv_until(ws, "say")
        assert say["text"].startswith("Hola, empecemos. Primer paso:") and say["audio"] is False


def test_frame_is_acked_and_calibrates(client):
    img, _ = frame_of_mat()
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello()))
        recv_until(ws, "step")
        ws.send_bytes(encode_frame(1, 500, jpeg(img)))
        cal = recv_until(ws, "calibration")
        assert cal["ok"] is True and cal["markers"] == 4 and len(cal["H"]) == 9
        dbg = recv_until(ws, "debug")
        assert dbg["seq"] == 1 and dbg["t_ms"] == 500
        assert {"decode", "aruco", "total"} <= set(dbg["latency_ms"])


def test_skip_and_back(client):
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello()))
        recv_until(ws, "step")
        ws.send_text(json.dumps({"type": "skip_step"}))
        step = recv_until(ws, "step")
        assert step["current"] == 2 and step["status"]["1"] == "done"
        ws.send_text(json.dumps({"type": "back_step"}))
        step = recv_until(ws, "step")
        assert step["current"] == 1


def test_resume_does_not_greet_again(client):
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello(resume={"current": 2, "status": {"1": "done", "2": "active", "3": "pending"}})))
        step = recv_until(ws, "step")
        assert step["current"] == 2
        ws.send_text(json.dumps({"type": "skip_step"}))
        say = recv_until(ws, "say")
        assert "Paso 3" in say["text"]


def test_capture_saves_frames(client, tmp_path):
    img, _ = frame_of_mat()
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello()))
        recv_until(ws, "step")
        ws.send_text(json.dumps({"type": "set_capture", "on": True}))
        ws.send_bytes(encode_frame(1, 0, jpeg(img)))
        cap = recv_until(ws, "capture")
        assert cap["saved"] == 1
    assert len(list((tmp_path / "yolo" / "raw").rglob("*.jpg"))) == 1


def test_wrong_protocol(client):
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello(protocol=99)))
        assert recv_until(ws, "error")["message"].startswith("Protocolo 99")
