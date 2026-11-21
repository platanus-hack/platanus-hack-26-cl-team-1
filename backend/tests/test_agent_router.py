"""POST /api/agent/turn with a fake streaming client (no network)."""
from __future__ import annotations

import sys
from pathlib import Path

# `uv run pytest` from backend/ does not put backend/ on sys.path (no pythonpath in pyproject yet).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


import asyncio
import copy
import json
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx
import pytest
from anthropic.types.beta import (
    BetaRawContentBlockDeltaEvent,
    BetaRawContentBlockStartEvent,
    BetaRawContentBlockStopEvent,
    BetaRawMessageDeltaEvent,
    BetaRawMessageStartEvent,
)
from anthropic.types.beta.parsed_beta_message import ParsedBetaMessage
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agent import client as client_module
from app.agent.router import router
from app.agent.schemas import AgentTurnRequest
from app.agent.turn import turn_events
from app.settings import settings

USER_MSG = {
    "role": "user",
    "content": [
        {"type": "text", "text": "Quiero hacer parpadear un LED"},
        {"type": "text", "text": '<contexto_app>{"view":"hardware","board":"uno"}</contexto_app>'},
    ],
}

FINAL = {
    "id": "msg_1",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-5-5",
    "stop_reason": "tool_use",
    "stop_sequence": None,
    "content": [
        {"type": "thinking", "thinking": "Voy a revisar el proyecto", "signature": "sig-abc"},
        {"type": "text", "text": "¡Vamos! Primero miro tu proyecto."},
        {"type": "tool_use", "id": "toolu_1", "name": "get_project", "input": {}},
    ],
    "usage": {"input_tokens": 12, "output_tokens": 30, "cache_read_input_tokens": 900},
}


def raw_events() -> list[Any]:
    start_msg = {**FINAL, "content": [], "stop_reason": None}
    return [
        BetaRawMessageStartEvent.model_validate({"type": "message_start", "message": start_msg}),
        BetaRawContentBlockStartEvent.model_validate(
            {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}
        ),
        BetaRawContentBlockDeltaEvent.model_validate(
            {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Voy a revisar el proyecto"}}
        ),
        BetaRawContentBlockStopEvent.model_validate({"type": "content_block_stop", "index": 0}),
        BetaRawContentBlockStartEvent.model_validate(
            {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}
        ),
        BetaRawContentBlockDeltaEvent.model_validate(
            {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "¡Vamos! "}}
        ),
        BetaRawContentBlockDeltaEvent.model_validate(
            {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Primero miro tu proyecto."}}
        ),
        BetaRawContentBlockStopEvent.model_validate({"type": "content_block_stop", "index": 1}),
        BetaRawContentBlockStartEvent.model_validate(
            {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "toolu_1", "name": "get_project", "input": {}}}
        ),
        BetaRawContentBlockDeltaEvent.model_validate(
            {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": "{}"}}
        ),
        # The SDK's stop event carries the accumulated block (ParsedBetaContentBlockStopEvent).
        SimpleNamespace(
            type="content_block_stop",
            index=2,
            content_block=SimpleNamespace(type="tool_use", id="toolu_1", name="get_project", input={}),
        ),
        BetaRawMessageDeltaEvent.model_validate(
            {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None}, "usage": {"output_tokens": 30}}
        ),
    ]


class FakeStream:
    def __init__(self, events: list[Any], final: dict, *, delay: float = 0.0, raise_on_enter: BaseException | None = None):
        self.events = events
        self.final = ParsedBetaMessage.model_validate(final)
        self.current_message_snapshot = self.final
        self.delay = delay
        self.raise_on_enter = raise_on_enter
        self.closed = False

    async def __aenter__(self) -> "FakeStream":
        if self.raise_on_enter:
            raise self.raise_on_enter
        return self

    async def __aexit__(self, *exc: Any) -> None:
        self.closed = True

    async def __aiter__(self):
        for e in self.events:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield e

    async def get_final_message(self) -> ParsedBetaMessage:
        return self.final


class FakeClient:
    def __init__(self, stream: FakeStream):
        self.stream_obj = stream
        self.calls: list[dict[str, Any]] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **params: Any) -> FakeStream:
        self.calls.append(params)
        return self.stream_obj


def parse_sse(body: str) -> list[dict[str, Any]]:
    out = []
    for frame in body.split("\n\n"):
        if not frame.strip() or frame.startswith(":"):
            continue
        lines = frame.split("\n")
        assert lines[0].startswith("event: ")
        data = json.loads(lines[1][len("data: "):])
        assert data["type"] == lines[0][len("event: "):]
        out.append(data)
    return out


@pytest.fixture
def api() -> TestClient:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    return TestClient(app)


@pytest.fixture
def with_key(monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")


def install(monkeypatch, stream: FakeStream) -> FakeClient:
    fake = FakeClient(stream)
    monkeypatch.setattr(client_module, "client_factory", lambda: fake)
    return fake


def test_turn_streams_expected_event_sequence(api, with_key, monkeypatch):
    fake = install(monkeypatch, FakeStream(raw_events(), FINAL))
    messages = [USER_MSG]
    sent = copy.deepcopy(messages)
    res = api.post("/api/agent/turn", json={"messages": messages, "context": {"view": "hardware", "board": "uno", "partCount": 2, "issueCount": 0, "simRunning": False}})
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(res.text)
    assert [e["type"] for e in events] == [
        "message_start", "thinking_delta", "text_delta", "text_delta", "tool_use_start", "tool_use", "message_end",
    ]
    assert events[0]["id"] == "msg_1"
    assert events[1]["text"] == "Voy a revisar el proyecto"
    assert events[2]["text"] + events[3]["text"] == "¡Vamos! Primero miro tu proyecto."
    assert events[4] == {"type": "tool_use_start", "id": "toolu_1", "name": "get_project"}
    assert events[5] == {"type": "tool_use", "id": "toolu_1", "name": "get_project", "input": {}}
    end = events[6]
    assert end["stop_reason"] == "tool_use"
    assert end["stop_details"] is None
    assert end["content"] == FINAL["content"]  # thinking signature passed back verbatim
    assert end["usage"]["cache_read_input_tokens"] == 900

    # The request: messages untouched, adaptive summarized thinking, fallbacks, caching, eager tools.
    params = fake.calls[0]
    assert params["messages"] == sent
    assert params["model"] == settings.anthropic_model
    assert params["thinking"] == {"type": "adaptive", "display": "summarized"}
    assert params["output_config"] == {"effort": settings.anthropic_effort}
    assert params["tool_choice"] == {"type": "auto"}
    assert params["betas"] == ["server-side-fallback-2026-07-01"]
    assert params["fallbacks"] == "default"
    assert params["cache_control"] == {"type": "ephemeral"}
    assert params["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert all(t["eager_input_streaming"] is True for t in params["tools"])
    assert fake.stream_obj.closed


def test_tool_use_input_from_snapshot_when_stop_event_is_raw(api, with_key, monkeypatch):
    events = raw_events()
    events[10] = BetaRawContentBlockStopEvent.model_validate({"type": "content_block_stop", "index": 2})
    install(monkeypatch, FakeStream(events, FINAL))
    out = parse_sse(api.post("/api/agent/turn", json={"messages": [USER_MSG]}).text)
    tool_use = next(e for e in out if e["type"] == "tool_use")
    assert tool_use["input"] == {} and tool_use["name"] == "get_project"


def test_refusal_carries_stop_details(api, with_key, monkeypatch):
    final = {**FINAL, "stop_reason": "refusal", "stop_details": {"type": "refusal", "category": None, "explanation": "No puedo"}, "content": []}
    install(monkeypatch, FakeStream(raw_events()[:1], final))
    out = parse_sse(api.post("/api/agent/turn", json={"messages": [USER_MSG]}).text)
    assert out[-1]["type"] == "message_end"
    assert out[-1]["stop_reason"] == "refusal"
    assert out[-1]["stop_details"] == {"category": None, "explanation": "No puedo"}


def test_missing_api_key_streams_friendly_error(api, monkeypatch):
    monkeypatch.setattr(settings, "anthropic_api_key", "")
    called = []
    monkeypatch.setattr(client_module, "client_factory", lambda: called.append(1))
    res = api.post("/api/agent/turn", json={"messages": [USER_MSG]})
    assert res.status_code == 200
    events = parse_sse(res.text)
    assert len(events) == 1
    assert events[0]["code"] == "no_api_key" and events[0]["retryable"] is False
    assert "ANTHROPIC_API_KEY" in events[0]["message"] and "backend/.env" in events[0]["message"]
    assert not called


def test_sdk_errors_become_spanish_error_events(api, with_key, monkeypatch):
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    err = anthropic.RateLimitError("slow down", response=httpx.Response(429, request=req), body=None)
    install(monkeypatch, FakeStream([], FINAL, raise_on_enter=err))
    events = parse_sse(api.post("/api/agent/turn", json={"messages": [USER_MSG]}).text)
    assert events == [{"type": "error", "code": "rate_limited", "retryable": True, "message": events[0]["message"]}]


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"messages": []},
        {"messages": [{"role": "system", "content": "hola"}]},
        {"messages": [{"role": "assistant", "content": "hola"}]},
        {"messages": [USER_MSG, {"role": "assistant", "content": [{"type": "text", "text": "ok"}]}]},
        {"messages": [{"role": "user", "content": []}]},
        {"messages": [{"role": "user", "content": [{"text": "sin tipo"}]}]},
        {"messages": [USER_MSG], "context": {"view": "otra"}},
    ],
)
def test_request_validation(api, with_key, body):
    assert api.post("/api/agent/turn", json=body).status_code == 422


async def test_pings_and_disconnect_close_upstream(with_key, monkeypatch):
    stream = FakeStream(raw_events(), FINAL, delay=0.05)
    install(monkeypatch, stream)
    req = AgentTurnRequest.model_validate({"messages": [USER_MSG]})
    disconnected = {"value": False}

    async def is_disconnected() -> bool:
        return disconnected["value"]

    frames = []
    async for frame in turn_events(req, is_disconnected, ping_interval=0.01):
        frames.append(frame)
        if frame == ": ping\n\n" and len(frames) > 3:
            disconnected["value"] = True
    assert ": ping\n\n" in frames
    assert not any(f.startswith("event: message_end") for f in frames)
    await asyncio.sleep(0.01)
    assert stream.closed  # upstream context manager exited
