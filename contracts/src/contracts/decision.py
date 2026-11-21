"""Contract 4: controller (M_C) → voice and UI.

Both controllers (rules and learned) emit the same `Decision`, so they can be swapped and compared.
"""

from __future__ import annotations

import enum

from pydantic import Field, model_validator

from .common import MistakeId, MistakeKind, NonEmptyText, StepId, StepStatus, Strict


class Event(enum.StrEnum):
    NONE = "none"  # nothing worth saying
    STEP_DONE = "step_done"
    MISTAKE = "mistake"
    MISTAKE_FIXED = "mistake_fixed"
    REMINDER = "reminder"  # stuck too long: repeat the next step's instruction
    TASK_DONE = "task_done"


class Priority(enum.StrEnum):
    NORMAL = "normal"
    URGENT = "urgent"  # mistakes: jump the voice queue


class SayRequest(Strict):
    text: NonEmptyText  # Spanish
    priority: Priority = Priority.NORMAL


class Decision(Strict):
    seq: int = Field(ge=0)  # seq of the observation that produced it
    event: Event
    step: StepId | None = None
    mistake_kind: MistakeKind | None = None
    mistake_id: MistakeId | None = None  # the task's MistakeDef, when one matched
    statuses: dict[StepId, StepStatus]  # every step of the task
    next_steps: tuple[StepId, ...]  # legal next steps after this decision
    say: SayRequest | None = None

    @model_validator(mode="after")
    def _check(self) -> Decision:
        is_mistake = self.event is Event.MISTAKE
        if is_mistake != (self.mistake_kind is not None):
            raise ValueError("mistake_kind is set exactly when event is 'mistake'")
        if self.mistake_id is not None and not is_mistake:
            raise ValueError("mistake_id only goes with event 'mistake'")
        if self.event is Event.NONE and self.say is not None:
            raise ValueError("event 'none' says nothing")
        return self
