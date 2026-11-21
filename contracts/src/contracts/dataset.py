"""Contract 6: simulator and dataset records (simulator owner → model owner).

`Trajectory`: a symbolic run over a task's automaton, with ground truth per event. Trains and tests
the controller. `ClipRecord`: one video clip (generated or recorded) with its label. Trains and
tests perception. Clips live on the GPU server; manifests (JSONL of ClipRecord) live in git.
"""

from __future__ import annotations

import enum

from pydantic import Field, model_validator

from .common import (
    ActionId,
    Confidence,
    Id,
    Millis,
    MistakeId,
    MistakeKind,
    NonEmptyText,
    StepId,
    Strict,
    TaskId,
)
from .perception import Quality


class Split(enum.StrEnum):
    """Assigned per run / recording session, never per frame or clip of the same run."""

    TRAIN = "train"
    VAL = "val"
    TEST = "test"


class TrajectoryEvent(Strict):
    t_ms: Millis
    true_action: ActionId | None  # what really happened (null = idle / nothing relevant)
    observed_action: ActionId | None  # what simulated perception reported (noise applied)
    observed_confidence: Confidence
    observed_quality: Quality = Quality.UNKNOWN  # simulated perception's quality judgement (`incomplete`)
    step: StepId | None  # the step the true action belongs to
    mistake_kind: MistakeKind | None = None  # ground truth
    mistake_id: MistakeId | None = None

    @model_validator(mode="after")
    def _check(self) -> TrajectoryEvent:
        if self.observed_action is None and self.observed_quality is not Quality.UNKNOWN:
            raise ValueError("a null observed_action must have quality 'unknown' (as in VlmOutput)")
        return self


class Trajectory(Strict):
    id: Id
    task_id: TaskId
    task_version: int
    seed: int
    split: Split
    noise: dict[str, float] = Field(
        default_factory=dict
    )  # e.g. {"drop": 0.1, "confuse": 0.05, "delay_ms": 300}
    events: tuple[TrajectoryEvent, ...] = Field(min_length=1)
    completed: bool  # the run reached all steps done


class ClipSource(enum.StrEnum):
    RUNWAY = "runway"
    WAN = "wan"  # local video generation
    RECORDED = "recorded"  # real webcam recording


class ClipRecord(Strict):
    id: Id
    task_id: TaskId
    task_version: int
    run_id: Id  # clips of the same run share a split
    split: Split
    source: ClipSource
    path: NonEmptyText  # relative to the data root on the GPU server
    duration_s: float = Field(gt=0)
    fps: float = Field(gt=0)
    action: ActionId | None  # the action shown (null = idle)
    step: StepId | None
    is_correct: bool
    mistake_id: MistakeId | None = None
    prompt: str | None = None  # generation prompt, when generated

    @model_validator(mode="after")
    def _check(self) -> ClipRecord:
        if self.is_correct == (self.mistake_id is not None):
            raise ValueError("mistake_id is set exactly when the clip is not correct")
        return self
