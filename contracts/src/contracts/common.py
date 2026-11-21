"""Building blocks shared by every contract."""

from __future__ import annotations

import enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

PROTOCOL_VERSION = 1

# snake_case identifiers: actions, objects, steps, mistakes, tasks, domains.
Id = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]*$", min_length=1, max_length=64)]
ActionId = Id
ObjectId = Id
StepId = Id
MistakeId = Id
TaskId = Id

NonEmptyText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Confidence = Annotated[float, Field(ge=0.0, le=1.0)]
Millis = Annotated[int, Field(ge=0)]


class Strict(BaseModel):
    """Base for every contract: unknown fields are an error, instances are immutable."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class Source(enum.StrEnum):
    """Where the frames come from. The server treats both the same way."""

    SIM = "sim"
    WEBCAM = "webcam"


class MistakeKind(enum.StrEnum):
    """Closed set of mistake types.

    `out_of_order` and `repeated` are detected generically from the step graph; `wrong_action` and
    `incomplete` need a `MistakeDef` in the task to say what they look like and how to correct them.
    """

    OUT_OF_ORDER = "out_of_order"  # a step whose prerequisites aren't done yet
    WRONG_ACTION = "wrong_action"  # an action the task forbids or doesn't contain
    INCOMPLETE = "incomplete"  # the right action, done badly (too short, partial)
    REPEATED = "repeated"  # a step that was already done


class StepStatus(enum.StrEnum):
    PENDING = "pending"
    ACTIVE = "active"  # legal to do now
    DONE = "done"
    MISTAKE = "mistake"  # attempted wrongly, waiting for the correction
