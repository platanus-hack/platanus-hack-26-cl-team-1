"""Contract 7: the in-process interfaces between owners inside the server.

The session server (Alonso) drives three components through these interfaces:

    frames ──▶ Perception (Cote) ──▶ Observation ──▶ Controller (Cote) ──▶ Decision ──▶ Voice (Alonso)

Any implementation that matches works: a fake, the rules, a learned model, an API or a local model.
The session server owns timing and concurrency: it never has more than one `observe` call in flight,
and it calls `Controller.tick` about once a second so the controller can remind a stuck user.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from .common import Source
from .decision import Decision, SayRequest
from .perception import Observation
from .task import Task


@dataclass(frozen=True)
class Frame:
    """One decoded client frame (see `protocol.unpack_frame`)."""

    seq: int
    t_ms: int  # client clock, monotonic within a session
    jpeg: bytes
    source: Source


@runtime_checkable
class Perception(Protocol):
    """Video understanding (M_VL)."""

    async def observe(
        self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]
    ) -> Observation | None:
        """Judge the most recent frames (oldest first, newest last).

        `next_steps` are the legal next steps, to focus the prompt. Return `None` when there is nothing
        new to report (e.g. a scripted fake between events). A model answer that fails
        `parse_vlm_output` must come back as an observation with `action=None` (uncertain), or `None`:
        never raise for a bad model answer. Raise only for real failures (server down), which the
        session reports as an `error` message.
        """
        ...


@runtime_checkable
class Controller(Protocol):
    """Next-action prediction (M_C): rules or a learned model. One instance per session."""

    def start(self, task: Task) -> Decision:
        """Reset for `task` and return the initial decision (all statuses, first steps, a greeting)."""
        ...

    def decide(self, observation: Observation) -> Decision:
        """Update the state from one observation."""
        ...

    def tick(self, now_ms: int) -> Decision | None:
        """Called ~1/s with the client clock. Return a `reminder` decision when the user is stuck."""
        ...

    def skip(self, now_ms: int) -> Decision:
        """The user pressed "ya lo hice": mark the first legal next step done."""
        ...


@runtime_checkable
class Voice(Protocol):
    """Text-to-speech. Anti-spam (what to drop, what to cancel) is the session's voice queue, not this."""

    async def synthesize(self, request: SayRequest) -> bytes | None:
        """Return audio/mpeg bytes, or `None` when TTS is unavailable (the browser then speaks the text)."""
        ...
