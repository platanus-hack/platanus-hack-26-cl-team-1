"""Request body of POST /api/agent/turn (mirrors AgentTurnRequest in contracts/agent.ts)."""
from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_MESSAGES = 600


class ApiMessage(BaseModel):
    """An Anthropic message; content blocks are opaque JSON and passed through untouched."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: Union[str, list[dict[str, Any]]]

    @field_validator("content")
    @classmethod
    def _non_empty(cls, v: Union[str, list[dict[str, Any]]]) -> Union[str, list[dict[str, Any]]]:
        if isinstance(v, list):
            if not v:
                raise ValueError("content no puede estar vacío")
            for block in v:
                if not isinstance(block.get("type"), str):
                    raise ValueError("cada bloque de content necesita un campo 'type'")
        elif not v.strip():
            raise ValueError("content no puede estar vacío")
        return v


class TurnContext(BaseModel):
    """For server logs only — never added to the model input."""

    view: Literal["hardware", "schematic", "software"]
    board: Optional[Literal["uno", "esp32c6"]] = None
    partCount: int = 0
    issueCount: int = 0
    simRunning: bool = False


class AgentTurnRequest(BaseModel):
    messages: list[ApiMessage] = Field(min_length=1, max_length=MAX_MESSAGES)
    context: Optional[TurnContext] = None

    @field_validator("messages")
    @classmethod
    def _shape(cls, v: list[ApiMessage]) -> list[ApiMessage]:
        if v[0].role != "user":
            raise ValueError("la conversación debe empezar con un mensaje del estudiante")
        if v[-1].role != "user":
            raise ValueError("el último mensaje debe ser del estudiante o un resultado de herramienta")
        return v

    def api_messages(self) -> list[dict[str, Any]]:
        """Messages exactly as the client sent them (content blocks untouched)."""
        return [{"role": m.role, "content": m.content} for m in self.messages]
