"""Real AsyncAnthropic client over a mock HTTP transport: checks the request the
SDK actually sends and that relay_turn translates a raw Anthropic SSE stream."""
from __future__ import annotations

import sys
from pathlib import Path

# `uv run pytest` from backend/ does not put backend/ on sys.path (no pythonpath in pyproject yet).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json  # noqa: E402
from typing import Any  # noqa: E402

import anthropic  # noqa: E402
import httpx2  # noqa: E402

from app.agent.turn import relay_turn  # noqa: E402
from app.settings import settings  # noqa: E402


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


MESSAGE = {
    "id": "msg_01",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-5-5",
    "content": [],
    "stop_reason": None,
    "stop_sequence": None,
    "usage": {"input_tokens": 20, "output_tokens": 1, "cache_read_input_tokens": 7000, "cache_creation_input_tokens": 0},
}

RAW_STREAM = "".join(
    [
        _sse("message_start", {"type": "message_start", "message": MESSAGE}),
        _sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking", "thinking": "", "signature": ""}}),
        _sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "Reviso el proyecto."}}),
        _sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "signature_delta", "signature": "c2lnbmF0dXJl"}}),
        _sse("content_block_stop", {"type": "content_block_stop", "index": 0}),
        _sse("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
        _sse("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "¡Hola! "}}),
        _sse("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "Agrego un LED."}}),
        _sse("content_block_stop", {"type": "content_block_stop", "index": 1}),
        _sse("ping", {"type": "ping"}),
        _sse("content_block_start", {"type": "content_block_start", "index": 2, "content_block": {"type": "tool_use", "id": "toolu_01", "name": "add_part", "input": {}}}),
        _sse("content_block_delta", {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": '{"type": "led", '}}),
        _sse("content_block_delta", {"type": "content_block_delta", "index": 2, "delta": {"type": "input_json_delta", "partial_json": '"props": {"color": "red"}}'}}),
        _sse("content_block_stop", {"type": "content_block_stop", "index": 2}),
        _sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None}, "usage": {"output_tokens": 42}}),
        _sse("message_stop", {"type": "message_stop"}),
    ]
)


def _frames(frames: list[str]) -> list[dict[str, Any]]:
    return [json.loads(f.split("data: ", 1)[1]) for f in frames]


async def test_real_sdk_request_and_relay():
    captured: dict[str, Any] = {}

    def handler(request: httpx2.Request) -> httpx2.Response:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["body"] = json.loads(request.content)
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=RAW_STREAM.encode())

    client = anthropic.AsyncAnthropic(api_key="test-key", http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler)))
    messages = [{"role": "user", "content": [{"type": "text", "text": "Quiero un LED"}]}]
    frames = [f async for f in relay_turn(client, messages)]
    events = _frames(frames)

    assert [e["type"] for e in events] == [
        "message_start", "thinking_delta", "text_delta", "text_delta", "tool_use_start", "tool_use", "message_end",
    ]
    assert events[5]["input"] == {"type": "led", "props": {"color": "red"}}
    end = events[-1]
    assert end["stop_reason"] == "tool_use"
    assert end["content"] == [
        {"type": "thinking", "thinking": "Reviso el proyecto.", "signature": "c2lnbmF0dXJl"},
        {"type": "text", "text": "¡Hola! Agrego un LED."},
        {"type": "tool_use", "id": "toolu_01", "name": "add_part", "input": {"type": "led", "props": {"color": "red"}}},
    ]
    assert end["usage"]["output_tokens"] == 42
    assert end["usage"]["cache_read_input_tokens"] == 7000

    # What actually goes over the wire.
    body = captured["body"]
    assert captured["url"].endswith("/v1/messages?beta=true") or "/v1/messages" in captured["url"]
    assert "server-side-fallback-2026-07-01" in captured["headers"].get("anthropic-beta", "")
    assert body["model"] == settings.anthropic_model
    assert body["stream"] is True
    assert body["fallbacks"] == "default"
    assert body["thinking"] == {"type": "adaptive", "display": "summarized"}
    assert body["output_config"] == {"effort": settings.anthropic_effort}
    assert body["tool_choice"] == {"type": "auto"}
    assert body["cache_control"] == {"type": "ephemeral"}
    assert body["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert body["messages"] == messages
    assert all(t["eager_input_streaming"] is True for t in body["tools"])
    assert "temperature" not in body and "top_p" not in body
