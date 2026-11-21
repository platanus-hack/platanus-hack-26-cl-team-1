"""SSE framing + exception mapping."""
import sys
from pathlib import Path

# `uv run pytest` from backend/ does not put backend/ on sys.path (no pythonpath in pyproject yet).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

import anthropic
import httpx

from app.agent.errors import map_exception
from app.agent.sse import PING, sse_error, sse_event


def test_event_framing_is_single_data_line():
    frame = sse_event("text_delta", {"text": "Hola\n¿qué tal?"})
    assert frame.startswith("event: text_delta\ndata: ")
    assert frame.endswith("\n\n")
    lines = frame.rstrip("\n").split("\n")
    assert len(lines) == 2  # newlines inside the payload are JSON-escaped
    payload = json.loads(lines[1][len("data: "):])
    assert payload == {"type": "text_delta", "text": "Hola\n¿qué tal?"}


def test_error_frame_and_ping():
    frame = sse_error("rate_limited", "Espera", True)
    payload = json.loads(frame.split("data: ", 1)[1])
    assert payload == {"type": "error", "code": "rate_limited", "retryable": True, "message": "Espera"}
    assert PING == ": ping\n\n"


def _status_error(cls, status: int):
    req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return cls("boom", response=httpx.Response(status, request=req), body={"error": {"message": "detalle"}})


def test_exception_mapping():
    assert map_exception(_status_error(anthropic.AuthenticationError, 401)).code == "auth"
    rl = map_exception(_status_error(anthropic.RateLimitError, 429))
    assert (rl.code, rl.retryable) == ("rate_limited", True)
    ov = map_exception(_status_error(anthropic.OverloadedError, 529))
    assert (ov.code, ov.retryable) == ("overloaded", True)
    bad = map_exception(_status_error(anthropic.BadRequestError, 400))
    assert (bad.code, bad.retryable) == ("invalid_request", False)
    assert "detalle" in bad.message
    assert map_exception(_status_error(anthropic.InternalServerError, 500)).code == "upstream"
    conn = map_exception(anthropic.APIConnectionError(request=httpx.Request("POST", "https://x")))
    assert (conn.code, conn.retryable) == ("upstream", True)
    assert map_exception(ValueError("bad json")).retryable is True
    assert map_exception(RuntimeError("x")).code == "internal"
