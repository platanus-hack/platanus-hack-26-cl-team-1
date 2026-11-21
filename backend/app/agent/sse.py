"""Server-Sent Events framing for POST /api/agent/turn (see contracts/agent.ts AgentEvent)."""
from __future__ import annotations

import json
from typing import Any

PING = ": ping\n\n"


def sse_event(event_type: str, data: dict[str, Any]) -> str:
    """One SSE frame: `event: <type>` + a single-line JSON `data:` (with `type` included)."""
    payload = {"type": event_type, **data}
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {body}\n\n"


def sse_error(code: str, message: str, retryable: bool) -> str:
    return sse_event("error", {"code": code, "retryable": retryable, "message": message})
