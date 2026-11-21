"""Contract 3: perception (M_VL) → controller (M_C).

`VlmOutput` is exactly what the video-language model must return (as JSON). `Observation` is what
the server hands the controller: the validated output plus where and when it came from.
"""

from __future__ import annotations

import enum
import json

from pydantic import Field, ValidationError, model_validator

from .common import ActionId, Confidence, Millis, NonEmptyText, ObjectId, Source, Strict
from .task import Task


class Quality(enum.StrEnum):
    OK = "ok"
    BAD = "bad"  # the action was attempted but done wrongly (feeds `incomplete` / task mistakes)
    UNKNOWN = "unknown"


class VlmOutput(Strict):
    """`action` is null when nothing from the task's action set is happening, or the model is unsure.
    A null action must come with quality `unknown`: the supervisor stays silent on it."""

    action: ActionId | None
    confidence: Confidence
    quality: Quality
    objects: tuple[ObjectId, ...] = ()
    note: str | None = None  # short English rationale, for the debug overlay only

    @model_validator(mode="after")
    def _check(self) -> VlmOutput:
        if self.action is None and self.quality is not Quality.UNKNOWN:
            raise ValueError("a null action must have quality 'unknown'")
        return self


class Observation(Strict):
    seq: int = Field(ge=0)  # seq of the last frame the model saw
    t_ms: Millis  # client timestamp of that frame
    source: Source
    model: NonEmptyText  # e.g. "qwen3-vl-8b-fp8", "qwen3-vl-8b-fp8+lora-v1", "gemini-…"
    latency_ms: Millis
    output: VlmOutput


class InvalidVlmOutput(ValueError):
    """The model's answer doesn't fit the contract or the task. Treat as 'uncertain': say nothing."""


def parse_vlm_output(raw: str | bytes | dict, task: Task) -> VlmOutput:
    """Parse and validate a model answer against the contract and the task's restricted sets."""
    try:
        data = json.loads(raw) if isinstance(raw, str | bytes) else raw
        output = VlmOutput.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as error:
        raise InvalidVlmOutput(str(error)) from error
    if output.action is not None and output.action not in task.actions:
        raise InvalidVlmOutput(f"action {output.action!r} is not in task {task.id!r}")
    unknown = sorted(set(output.objects) - set(task.objects))
    if unknown:
        raise InvalidVlmOutput(f"objects {unknown} are not in task {task.id!r}")
    return output


def vlm_output_json_schema() -> dict:
    """Schema to pass to the model as structured output (vLLM `guided_json`, Gemini `response_schema`)."""
    return VlmOutput.model_json_schema()
