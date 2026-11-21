"""POST /api/agent/turn (SSE) — see frontend/src/contracts/agent.ts.

Body = AgentTurnRequest; response = text/event-stream of AgentEvent frames
(`event: <type>\\ndata: <json>\\n\\n`) plus `: ping` keepalives.
"""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from .schemas import AgentTurnRequest
from .turn import turn_events

router = APIRouter(tags=["agent"])

SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


@router.post("/agent/turn")
async def agent_turn(body: AgentTurnRequest, request: Request) -> StreamingResponse:
    return StreamingResponse(
        turn_events(body, request.is_disconnected),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )
