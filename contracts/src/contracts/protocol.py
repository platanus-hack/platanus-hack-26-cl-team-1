"""Contract 5: the WebSocket protocol between the browser and the server (`/ws/session`).

JSON messages are discriminated by `type`. Two binary frames:
  client → server, one per video frame:  uint32 seq, uint32 t_ms (little-endian) + JPEG bytes
  server → client, one per `say` with audio:  uint8 len(id), id (ASCII) + audio/mpeg bytes
Frames come from the webcam or from a simulated clip played in the page; the server doesn't care.
"""

from __future__ import annotations

import struct
from typing import Annotated, Literal

from pydantic import Field, TypeAdapter

from .common import (
    PROTOCOL_VERSION,
    Id,
    MistakeId,
    MistakeKind,
    NonEmptyText,
    Source,
    StepId,
    StepStatus,
    Strict,
    TaskId,
)
from .decision import Priority
from .perception import Observation
from .task import Task

# ── client → server ──────────────────────────────────────────────────────────


class Hello(Strict):
    type: Literal["hello"] = "hello"
    protocol: Literal[1] = PROTOCOL_VERSION
    task_id: TaskId
    source: Source
    debug: bool = False  # ask for `debug` messages with observations
    record: bool = False  # dataset recording: frames are saved with operator labels


class SkipStep(Strict):
    type: Literal["skip_step"] = "skip_step"  # "ya lo hice": mark the active step done


class Reset(Strict):
    type: Literal["reset"] = "reset"


class Mute(Strict):
    type: Literal["mute"] = "mute"
    on: bool


class Label(Strict):
    """Operator label during dataset recording (record=True only)."""

    type: Literal["label"] = "label"
    step: StepId | None = None
    mistake_id: MistakeId | None = None  # null = the current action is correct


ClientMessage = Annotated[Hello | SkipStep | Reset | Mute | Label, Field(discriminator="type")]

# ── server → client ──────────────────────────────────────────────────────────


class Ready(Strict):
    type: Literal["ready"] = "ready"
    session_id: Id
    task: Task  # the full task, so the UI can draw the checklist


class State(Strict):
    type: Literal["state"] = "state"
    seq: int = Field(ge=0)
    statuses: dict[StepId, StepStatus]
    next_steps: tuple[StepId, ...]


class Issue(Strict):
    type: Literal["issue"] = "issue"
    step: StepId | None
    kind: MistakeKind
    mistake_id: MistakeId | None = None
    text_es: NonEmptyText


class IssueClear(Strict):
    type: Literal["issue_clear"] = "issue_clear"
    step: StepId | None


class Say(Strict):
    """Subtitle + voice. When `audio` is true a binary audio frame with the same id follows;
    otherwise the browser may speak it with speechSynthesis."""

    type: Literal["say"] = "say"
    id: Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,32}$")]
    text: NonEmptyText
    priority: Priority = Priority.NORMAL
    audio: bool


class CancelSay(Strict):
    type: Literal["cancel_say"] = "cancel_say"
    id: str


class Debug(Strict):
    type: Literal["debug"] = "debug"
    seq: int = Field(ge=0)  # ack of the last frame received
    latency_ms: dict[str, int] = Field(default_factory=dict)  # e.g. {"vlm": 480, "controller": 1, "tts": 210}
    observation: Observation | None = None


class Error(Strict):
    type: Literal["error"] = "error"
    code: Literal["bad_message", "unknown_task", "protocol_version", "internal"]
    message: NonEmptyText


ServerMessage = Annotated[
    Ready | State | Issue | IssueClear | Say | CancelSay | Debug | Error, Field(discriminator="type")
]

client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)
server_message_adapter: TypeAdapter[ServerMessage] = TypeAdapter(ServerMessage)

# ── binary frames ────────────────────────────────────────────────────────────

FRAME_HEADER = struct.Struct("<II")
UINT32 = 0xFFFFFFFF


def pack_frame(seq: int, t_ms: int, jpeg: bytes) -> bytes:
    if not (0 <= seq <= UINT32 and 0 <= t_ms <= UINT32):
        raise ValueError(f"seq and t_ms must fit in uint32, got {seq}, {t_ms}")
    return FRAME_HEADER.pack(seq, t_ms) + jpeg


def unpack_frame(data: bytes) -> tuple[int, int, bytes]:
    if len(data) <= FRAME_HEADER.size:
        raise ValueError(f"frame too short: {len(data)} bytes")
    seq, t_ms = FRAME_HEADER.unpack_from(data)
    return seq, t_ms, data[FRAME_HEADER.size :]


def pack_audio(say_id: str, audio: bytes) -> bytes:
    encoded = say_id.encode("ascii")
    if not 1 <= len(encoded) <= 255:
        raise ValueError(f"say id must be 1-255 ASCII bytes, got {len(encoded)}")
    return bytes([len(encoded)]) + encoded + audio


def unpack_audio(data: bytes) -> tuple[str, bytes]:
    if not data:
        raise ValueError("empty audio frame")
    n = data[0]
    if len(data) < 1 + n or n == 0:
        raise ValueError("audio frame shorter than its id")
    return data[1 : 1 + n].decode("ascii"), data[1 + n :]
