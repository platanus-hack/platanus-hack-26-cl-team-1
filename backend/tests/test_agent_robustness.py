"""Robustness of the agent turn against the REAL AsyncAnthropic client (mock HTTP
transport, no API key): mid-stream API errors, mid-output refusal fallbacks."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json  # noqa: E402
from typing import Any  # noqa: E402

import anthropic  # noqa: E402
import httpx2  # noqa: E402
import pytest  # noqa: E402

from app.agent import client as client_module  # noqa: E402
from app.agent.errors import map_exception  # noqa: E402
from app.agent.schemas import AgentTurnRequest  # noqa: E402
from app.agent.turn import turn_events  # noqa: E402
from app.settings import settings  # noqa: E402

USER_MSG = {"role": "user", "content": [{"type": "text", "text": "Hola"}]}

MESSAGE = {
    "id": "msg_01",
    "type": "message",
    "role": "assistant",
    "model": "claude-opus-5-5",
    "content": [],
    "stop_reason": None,
    "stop_sequence": None,
    "usage": {"input_tokens": 20, "output_tokens": 1},
}


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _client(raw: str) -> anthropic.AsyncAnthropic:
    def handler(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=raw.encode())

    return anthropic.AsyncAnthropic(
        api_key="test-key", max_retries=0, http_client=httpx2.AsyncClient(transport=httpx2.MockTransport(handler))
    )


async def _never_disconnected() -> bool:
    return False


async def _events(monkeypatch, raw: str) -> list[dict[str, Any]]:
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key")
    monkeypatch.setattr(client_module, "client_factory", lambda: _client(raw))
    req = AgentTurnRequest.model_validate({"messages": [USER_MSG]})
    frames = [f async for f in turn_events(req, _never_disconnected)]
    return [json.loads(f.split("data: ", 1)[1]) for f in frames if f.startswith("event: ")]


def _mid_stream_error(err_type: str, message: str) -> str:
    return "".join(
        [
            _sse("message_start", {"type": "message_start", "message": MESSAGE}),
            _sse("content_block_start", {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}),
            _sse("content_block_delta", {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hola, "}}),
            _sse("error", {"type": "error", "error": {"type": err_type, "message": message}}),
        ]
    )


@pytest.mark.parametrize(
    ("err_type", "code", "retryable"),
    [
        ("overloaded_error", "overloaded", True),
        ("rate_limit_error", "rate_limited", True),
        ("api_error", "upstream", True),
        ("invalid_request_error", "invalid_request", False),
    ],
)
async def test_mid_stream_api_error_is_mapped_by_error_type(monkeypatch, err_type, code, retryable):
    """The API reports overload etc. as an SSE `error` event on an HTTP 200 stream: the SDK
    raises a bare APIStatusError(status_code=200). It must still be classified by its type."""
    events = await _events(monkeypatch, _mid_stream_error(err_type, "Overloaded"))
    err = events[-1]
    assert err["type"] == "error"
    assert (err["code"], err["retryable"]) == (code, retryable), err
    assert "(200)" not in err["message"]
    assert not any(e["type"] == "message_end" for e in events)


def test_map_exception_reads_error_type_of_generic_status_error():
    req = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")
    exc = anthropic.APIStatusError(
        "boom", response=httpx2.Response(200, request=req), body={"type": "error", "error": {"type": "overloaded_error", "message": "x"}}
    )
    mapped = map_exception(exc)
    assert (mapped.code, mapped.retryable) == ("overloaded", True)


def _block(index: int, block: dict[str, Any], deltas: list[dict[str, Any]] = ()) -> str:
    out = [_sse("content_block_start", {"type": "content_block_start", "index": index, "content_block": block})]
    out += [_sse("content_block_delta", {"type": "content_block_delta", "index": index, "delta": d}) for d in deltas]
    out.append(_sse("content_block_stop", {"type": "content_block_stop", "index": index}))
    return "".join(out)


FALLBACK = {
    "type": "fallback",
    "from": {"model": "claude-opus-5-5"},
    "to": {"model": "claude-opus-4-8"},
    "trigger": {"type": "refusal", "category": "cyber"},
}

MID_OUTPUT_FALLBACK = "".join(
    [
        _sse("message_start", {"type": "message_start", "message": MESSAGE}),
        _block(0, {"type": "thinking", "thinking": "", "signature": ""}, [
            {"type": "thinking_delta", "thinking": "plan"}, {"type": "signature_delta", "signature": "c2ln"}]),
        _block(1, {"type": "text", "text": ""}, [{"type": "text_delta", "text": "Agrego un LED. "}]),
        _block(2, {"type": "tool_use", "id": "toolu_declined", "name": "add_part", "input": {}}, [
            {"type": "input_json_delta", "partial_json": '{"type": "led"}'}]),
        _block(3, FALLBACK),
        _block(4, {"type": "text", "text": ""}, [{"type": "text_delta", "text": "Lo agrego ahora."}]),
        _block(5, {"type": "tool_use", "id": "toolu_ok", "name": "add_part", "input": {}}, [
            {"type": "input_json_delta", "partial_json": '{"type": "led"}'}]),
        _sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "tool_use", "stop_sequence": None}, "usage": {"output_tokens": 9}}),
        _sse("message_stop", {"type": "message_stop"}),
    ]
)


async def test_mid_output_fallback_content_is_echo_ready(monkeypatch):
    """After a mid-output fallback the API says to omit thinking / tool_use blocks that come
    before the final `fallback` block (text and the fallback block stay in place). Otherwise
    the browser would also EXECUTE the declined model's tool call (duplicate add_part)."""
    events = await _events(monkeypatch, MID_OUTPUT_FALLBACK)
    end = events[-1]
    assert end["type"] == "message_end" and end["stop_reason"] == "tool_use"
    assert [b["type"] for b in end["content"]] == ["text", "fallback", "text", "tool_use"]
    assert end["content"][1] == FALLBACK  # the boundary block, verbatim (alias `from`)
    assert [b["id"] for b in end["content"] if b["type"] == "tool_use"] == ["toolu_ok"]


async def test_content_without_mid_output_fallback_is_untouched(monkeypatch):
    pre_output = "".join(
        [
            _sse("message_start", {"type": "message_start", "message": MESSAGE}),
            _block(0, FALLBACK),
            _block(1, {"type": "thinking", "thinking": "", "signature": ""}, [{"type": "signature_delta", "signature": "c2ln"}]),
            _block(2, {"type": "text", "text": ""}, [{"type": "text_delta", "text": "Hola"}]),
            _sse("message_delta", {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}, "usage": {"output_tokens": 3}}),
            _sse("message_stop", {"type": "message_stop"}),
        ]
    )
    end = (await _events(monkeypatch, pre_output))[-1]
    assert [b["type"] for b in end["content"]] == ["fallback", "thinking", "text"]


def test_empty_assistant_message_is_rejected_by_the_server():
    """Why the browser must never append an empty assistant message: every later POST 422s."""
    with pytest.raises(ValueError):
        AgentTurnRequest.model_validate(
            {"messages": [USER_MSG, {"role": "assistant", "content": []}, {"role": "user", "content": [{"type": "text", "text": "¿sigues?"}]}]}
        )


def test_default_client_is_reused_across_turns(monkeypatch):
    """One AsyncAnthropic (one connection pool) per process, not a new client + TLS
    handshake for every POST of every tool iteration (up to 25 per student message)."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-reuse")
    a = client_module._default_factory()
    b = client_module._default_factory()
    assert a is b
    monkeypatch.setattr(settings, "anthropic_api_key", "other-key")
    assert client_module._default_factory() is not a


def test_proxy_base_url_is_passed_to_the_client(monkeypatch):
    """backend/.env lands in `settings`, not os.environ: the SDK would never see the proxy URL."""
    monkeypatch.setattr(settings, "anthropic_api_key", "test-key-proxy")
    monkeypatch.setattr(settings, "anthropic_base_url", "https://proxy.example/t/tok/anthropic")
    c = client_module._default_factory()
    assert str(c.base_url).rstrip("/") == "https://proxy.example/t/tok/anthropic"
    assert c.api_key == "test-key-proxy"
    monkeypatch.setattr(settings, "anthropic_base_url", "")
    assert client_module._default_factory() is not c


def test_request_prefix_is_byte_stable_across_processes():
    """system + tools (the cached prefix) must not depend on hash seeds / dict order."""
    import os
    import subprocess

    code = (
        "import hashlib, json; from app.agent.turn import build_params; "
        "p = build_params([]); p.pop('messages'); "
        "print(hashlib.sha256(json.dumps(p, ensure_ascii=False).encode()).hexdigest())"
    )
    root = Path(__file__).resolve().parents[1]
    digests = {
        subprocess.run(
            [sys.executable, "-c", code], cwd=root, capture_output=True, text=True, check=True,
            env={**os.environ, "PYTHONHASHSEED": seed},
        ).stdout.strip()
        for seed in ("1", "2", "3")
    }
    assert len(digests) == 1 and all(digests)


async def test_upstream_stream_ending_without_message_stop_is_an_error(monkeypatch):
    """An upstream body that ends early (no message_delta / message_stop) must NOT become a
    `message_end` (stop_reason null + partial content, e.g. a thinking block without its
    signature, would be appended by the browser and 400 every later turn)."""
    truncated = "".join(
        [
            _sse("message_start", {"type": "message_start", "message": MESSAGE}),
            _block(0, {"type": "thinking", "thinking": "", "signature": ""}, [{"type": "thinking_delta", "thinking": "plan"}]),
            _sse("content_block_start", {"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "toolu_x", "name": "add_part", "input": {}}}),
            _sse("content_block_delta", {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"type": "le'}}),
        ]
    )
    events = await _events(monkeypatch, truncated)
    assert not any(e["type"] == "message_end" for e in events)
    assert events[-1]["type"] == "error" and events[-1]["retryable"] is True
