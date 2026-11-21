"""Fakes that satisfy the interfaces, so every owner can build without waiting for the others.

- `ScriptedPerception`: replays a script of actions on the client clock (no model, no GPU).
- `SilentVoice`: no TTS; the browser speaks the text with speechSynthesis.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .decision import SayRequest
from .interfaces import Frame
from .perception import Observation, Quality, VlmOutput
from .task import Task


@dataclass(frozen=True)
class ScriptedEvent:
    at_ms: int  # client time since the first frame
    action: str | None
    confidence: float = 0.9


class ScriptedPerception:
    """Reports each scripted action once, when the client clock passes its time."""

    model = "scripted"

    def __init__(self, script: Sequence[ScriptedEvent]) -> None:
        self._script = sorted(script, key=lambda e: e.at_ms)
        self._next = 0
        self._t0: int | None = None

    @classmethod
    def correct_run(cls, task: Task, every_ms: int = 4000, mistake: str | None = None) -> ScriptedPerception:
        """The task's steps in listed order, one every `every_ms`. With `mistake` (an action id), that
        action is inserted before the second step, then the run continues correctly."""
        actions = [s.action for s in task.steps]
        if mistake is not None:
            actions.insert(1, mistake)
        return cls([ScriptedEvent((i + 1) * every_ms, a) for i, a in enumerate(actions)])

    async def observe(
        self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]
    ) -> Observation | None:
        if not frames:
            return None
        last = frames[-1]
        if self._t0 is None:
            self._t0 = last.t_ms
        if self._next >= len(self._script) or last.t_ms - self._t0 < self._script[self._next].at_ms:
            return None
        event = self._script[self._next]
        self._next += 1
        output = VlmOutput(
            action=event.action,
            confidence=event.confidence,
            quality=Quality.OK if event.action else Quality.UNKNOWN,
        )
        return Observation(
            seq=last.seq, t_ms=last.t_ms, source=last.source, model=self.model, latency_ms=0, output=output
        )


class SilentVoice:
    async def synthesize(self, request: SayRequest) -> bytes | None:
        return None
