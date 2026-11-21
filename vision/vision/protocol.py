"""WebSocket protocol of /ws/session — mirror of frontend/src/assembly/protocol.ts.

Binary messages:
  client → server (one per frame): uint32 seq, uint32 t_ms (little-endian) + JPEG
  server → client (one per `say`): uint8 len(id), id (ASCII), WAV bytes
"""

from __future__ import annotations

import struct
from typing import Literal

PROTOCOL = 1

IssueKind = Literal["missing", "wrong_hole", "led_reversed", "wrong_part", "wire_wrong_end", "extra_part"]
ISSUE_KINDS: tuple[str, ...] = ("missing", "wrong_hole", "led_reversed", "wrong_part", "wire_wrong_end", "extra_part")
StepStatus = Literal["pending", "active", "done", "error"]

_HDR = struct.Struct("<II")


def decode_frame(data: bytes) -> tuple[int, int, bytes]:
    if len(data) < _HDR.size:
        raise ValueError("frame too short")
    seq, t_ms = _HDR.unpack_from(data)
    return seq, t_ms, data[_HDR.size :]


def encode_frame(seq: int, t_ms: int, jpeg: bytes) -> bytes:
    return _HDR.pack(seq & 0xFFFFFFFF, t_ms & 0xFFFFFFFF) + jpeg


def encode_audio(clip_id: str, wav: bytes) -> bytes:
    raw = clip_id.encode("ascii")
    if len(raw) > 255:
        raise ValueError("clip id too long")
    return bytes([len(raw)]) + raw + wav
