import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from tests.synth import frame_of_mat, jpeg
from vision import app as app_module
from vision.protocol import encode_frame

FIX = Path(__file__).parent / "fixtures"


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(app_module, "DATA", tmp_path)
    with TestClient(app_module.app) as c:
        yield c


def recv_until(ws, type_, limit=30):
    for _ in range(limit):
        m = json.loads(ws.receive_text())
        if m["type"] == type_:
            return m
    raise AssertionError(type_)


def test_recording_session_writes_frames_steps_and_labels(client, tmp_path, monkeypatch):
    hello = json.loads((FIX / "blink-uno.json").read_text())
    hello["record"] = True
    img, _ = frame_of_mat()
    data = jpeg(img)
    with client.websocket_connect("/ws/session") as ws:
        ws.send_text(json.dumps(hello))
        recv_until(ws, "step")
        ws.send_bytes(encode_frame(1, 0, data))
        dbg = recv_until(ws, "debug")
        assert dbg["paused"].startswith("Grabando dataset")
        ws.send_text(json.dumps({"type": "skip_step"}))  # operator: step 1 done
        recv_until(ws, "step")
        ws.send_text(json.dumps({"type": "label", "kind": "error_inserted", "error": "led_reversed"}))
        say = recv_until(ws, "say")
        while "Marcado" not in say["text"]:
            say = recv_until(ws, "say")
        assert say["text"] == "Marcado: polaridad al revés."
        ws.send_text(json.dumps({"type": "label", "kind": "error_fixed"}))
        ws.send_text(json.dumps({"type": "back_step"}))
        recv_until(ws, "step")
    sessions = list((tmp_path / "vlm" / "sessions").iterdir())
    assert len(sessions) == 1
    s = sessions[0]
    assert json.loads((s / "hello.json").read_text())["steps"][0]["id"] == "board-uno1"
    tl = [json.loads(line) for line in (s / "timeline.jsonl").read_text().splitlines()]
    types = [(r["type"], r.get("source") or r.get("kind")) for r in tl]
    assert types == [
        ("step", "start"),
        ("frame", None),
        ("step", "manual"),
        ("label", "error_inserted"),
        ("label", "error_fixed"),
        ("step", "back"),
    ]
    frame = tl[1]
    assert (s / frame["file"]).read_bytes() == data and len(frame["H"]) == 9 and frame["calibrated"]
    assert tl[3]["step"] == 2 and tl[3]["error"] == "led_reversed"
