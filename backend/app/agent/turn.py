"""One agent turn: call Claude (streaming) and relay AgentEvents as SSE frames.

"Server turn, client tools": the server never executes tools and NEVER modifies
`messages` — it streams one assistant message and hands the full content back
in `message_end`; the browser runs the tools and POSTs again.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import suppress
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from ..settings import settings
from .client import get_client
from .errors import NO_API_KEY_MESSAGE, IncompleteStreamError, map_exception
from .prompt import SYSTEM_BLOCKS, TOOLS
from .schemas import AgentTurnRequest
from .sse import PING, sse_error, sse_event

log = logging.getLogger(__name__)

FALLBACK_BETA = "server-side-fallback-2026-07-01"

PING_INTERVAL_S = 15.0


def build_params(messages: list[dict[str, Any]]) -> dict[str, Any]:
    """Request parameters. system/tools are byte-stable (built at import) → cached."""
    return {
        "model": settings.anthropic_model,
        "max_tokens": settings.agent_max_tokens,
        "system": SYSTEM_BLOCKS,
        "tools": TOOLS,
        "tool_choice": {"type": "auto"},
        # Adaptive thinking is always on for this model; summarized so the UI can show progress.
        "thinking": {"type": "adaptive", "display": "summarized"},
        "output_config": {"effort": settings.anthropic_effort},
        # Refusal fallbacks: on a policy decline the API re-runs the turn on a fallback model.
        "betas": [FALLBACK_BETA],
        "fallbacks": "default",
        # Automatic breakpoint for the growing conversation tail (plus the explicit one on system).
        "cache_control": {"type": "ephemeral"},
        "messages": messages,
    }


def _dump(obj: Any) -> Any:
    if obj is None:
        return None
    dump = getattr(obj, "model_dump", None)
    if callable(dump):
        return dump(mode="json", exclude_none=True, by_alias=True)
    return obj


#: Before the final `fallback` block (mid-output refusal fallback) only these echo back.
_ECHO_BEFORE_FALLBACK = frozenset({"text", "fallback"})


def echo_content(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Assistant content ready to be appended verbatim by the client.

    Identical to the API output except after a MID-OUTPUT refusal fallback: the API
    requires omitting the declined model's thinking / redacted_thinking / tool_use (and
    any other model-internal) blocks that come before the final `fallback` block, keeping
    text blocks and the fallback block exactly in place. This also keeps the browser from
    executing the declined model's (possibly cut-off) tool calls. A pre-output fallback
    (fallback block first) and normal turns are returned unchanged.
    """
    last = max((i for i, b in enumerate(blocks) if b.get("type") == "fallback"), default=-1)
    if last <= 0:
        return blocks
    return [b for i, b in enumerate(blocks) if i >= last or b.get("type") in _ECHO_BEFORE_FALLBACK]


def _stop_details(final: Any) -> Optional[dict[str, Any]]:
    sd = getattr(final, "stop_details", None)
    if sd is None:
        return None
    out: dict[str, Any] = {"category": getattr(sd, "category", None)}
    explanation = getattr(sd, "explanation", None)
    if explanation:
        out["explanation"] = explanation
    return out


def _translate(event: Any, snapshot: Callable[[], Any]) -> Optional[str]:
    """Raw stream event → SSE frame (None = not relayed). Derived SDK events are ignored."""
    et = getattr(event, "type", None)
    if et == "message_start":
        return sse_event("message_start", {"id": event.message.id})
    if et == "content_block_start":
        block = event.content_block
        if block.type == "tool_use":
            return sse_event("tool_use_start", {"id": block.id, "name": block.name})
        return None
    if et == "content_block_delta":
        delta = event.delta
        if delta.type == "text_delta":
            return sse_event("text_delta", {"text": delta.text})
        if delta.type == "thinking_delta" and delta.thinking:
            return sse_event("thinking_delta", {"text": delta.thinking})
        return None
    if et == "content_block_stop":
        block = getattr(event, "content_block", None)
        if block is None:  # raw event without the accumulated block
            content = getattr(snapshot(), "content", None) or []
            block = content[event.index] if event.index < len(content) else None
        if block is not None and block.type == "tool_use":
            return sse_event("tool_use", {"id": block.id, "name": block.name, "input": _dump(block.input)})
        return None
    return None


async def relay_turn(client: Any, messages: list[dict[str, Any]]) -> AsyncIterator[str]:
    """Stream one assistant message as SSE frames, ending with `message_end`."""
    async with client.beta.messages.stream(**build_params(messages)) as stream:
        snapshot = lambda: getattr(stream, "current_message_snapshot", None)  # noqa: E731
        async for event in stream:
            frame = _translate(event, snapshot)
            if frame is not None:
                yield frame
        final = await stream.get_final_message()
    if final.stop_reason is None:
        # get_final_message() does not check that message_stop arrived: a body that ended early
        # would hand the browser partial content (thinking without signature, cut tool_use).
        raise IncompleteStreamError("upstream stream ended before message_stop")
    usage = _dump(getattr(final, "usage", None))
    log.info(
        "agent turn end stop=%s cache_read=%s cache_write=%s out=%s",
        final.stop_reason,
        (usage or {}).get("cache_read_input_tokens"),
        (usage or {}).get("cache_creation_input_tokens"),
        (usage or {}).get("output_tokens"),
    )
    yield sse_event(
        "message_end",
        {
            "stop_reason": final.stop_reason,
            "stop_details": _stop_details(final),
            # Thinking blocks (signatures), fallback blocks… passed back verbatim by the client.
            "content": echo_content([_dump(b) for b in final.content]),
            "usage": usage,
        },
    )


async def turn_events(
    req: AgentTurnRequest,
    is_disconnected: Callable[[], Awaitable[bool]],
    *,
    ping_interval: float = PING_INTERVAL_S,
) -> AsyncIterator[str]:
    """Full SSE body: relayed events + `: ping` keepalives; stops when the client goes away."""
    if not settings.anthropic_api_key:
        yield sse_error("no_api_key", NO_API_KEY_MESSAGE, False)
        return
    if req.context:
        log.info("agent turn start messages=%d context=%s", len(req.messages), req.context.model_dump())

    queue: asyncio.Queue[Optional[str]] = asyncio.Queue()

    async def produce() -> None:
        try:
            async for frame in relay_turn(get_client(), req.api_messages()):
                await queue.put(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — every failure becomes an `error` event
            err = map_exception(exc)
            log.warning("agent turn failed: %s (%s)", type(exc).__name__, exc)
            await queue.put(sse_error(err.code, err.message, err.retryable))
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(produce())
    try:
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=ping_interval)
            except asyncio.TimeoutError:
                if await is_disconnected():
                    log.info("agent client disconnected; closing upstream stream")
                    break
                yield PING
                continue
            if frame is None:
                break
            yield frame
    finally:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
