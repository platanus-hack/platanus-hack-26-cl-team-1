"""Contract 2: a task (recipe) from the library.

The task's automaton is not written by hand: it is derived from the steps' `requires` (a DAG).
A state is the set of completed steps; the legal next steps are those whose prerequisites are all
done. See `automaton.py`.
"""

from __future__ import annotations

from pydantic import Field, model_validator

from .common import ActionId, Id, MistakeId, MistakeKind, NonEmptyText, ObjectId, StepId, Strict, TaskId
from .ontology import Ontology, _require_unique


class Step(Strict):
    id: StepId
    title_es: NonEmptyText  # checklist line
    instruction_es: NonEmptyText  # what the supervisor says to prompt this step
    action: ActionId  # the action that completes it
    requires: tuple[StepId, ...] = ()  # prerequisites; empty = can start any time
    completion_cue: NonEmptyText  # English: visible evidence that the step is done
    min_duration_s: float | None = Field(default=None, gt=0)  # shorter than this = `incomplete`


class MistakeDef(Strict):
    """A task-specific mistake: what it looks like and what to say."""

    id: MistakeId
    kind: MistakeKind
    step: StepId  # the step it belongs to
    action: ActionId | None = None  # for `wrong_action`: the forbidden action that reveals it
    description: NonEmptyText  # English
    visual_cue: NonEmptyText  # English, for perception and video generation
    correction_es: NonEmptyText  # what the supervisor says

    @model_validator(mode="after")
    def _check(self) -> MistakeDef:
        if self.kind is MistakeKind.WRONG_ACTION and self.action is None:
            raise ValueError(f"mistake {self.id!r}: wrong_action needs `action`")
        if self.kind is not MistakeKind.WRONG_ACTION and self.action is not None:
            raise ValueError(f"mistake {self.id!r}: only wrong_action takes `action`")
        return self


class Task(Strict):
    id: TaskId
    version: int
    title_es: NonEmptyText
    description: NonEmptyText  # English
    domain: Id
    ontology_version: int
    objects: tuple[ObjectId, ...]
    actions: tuple[ActionId, ...]  # the task's restricted action set (⊂ ontology)
    steps: tuple[Step, ...] = Field(min_length=1)
    mistakes: tuple[MistakeDef, ...] = ()

    @model_validator(mode="after")
    def _check_internal(self) -> Task:
        _require_unique("object", list(self.objects))
        _require_unique("action", list(self.actions))
        _require_unique("step", [s.id for s in self.steps])
        _require_unique("mistake", [m.id for m in self.mistakes])
        _require_unique("step action", [s.action for s in self.steps])

        allowed = set(self.actions)
        seen: set[str] = set()
        for step in self.steps:  # listed order must be a topological order: no forward refs, no cycles
            if step.action not in allowed:
                raise ValueError(f"step {step.id!r}: action {step.action!r} not in task actions")
            for req in step.requires:
                if req not in seen:
                    raise ValueError(f"step {step.id!r} requires {req!r}, which isn't an earlier step")
            seen.add(step.id)

        for mistake in self.mistakes:
            if mistake.step not in seen:
                raise ValueError(f"mistake {mistake.id!r} references unknown step {mistake.step!r}")
            if mistake.action is not None and mistake.action not in allowed:
                raise ValueError(f"mistake {mistake.id!r}: action {mistake.action!r} not in task actions")
            if mistake.action is not None and mistake.action in {s.action for s in self.steps}:
                raise ValueError(f"mistake {mistake.id!r}: action {mistake.action!r} completes a step")
        return self

    def check_against(self, ontology: Ontology) -> None:
        """Raise ValueError unless every object and action exists in `ontology`."""
        if (ontology.domain, ontology.version) != (self.domain, self.ontology_version):
            raise ValueError(
                f"task {self.id!r} targets {self.domain} v{self.ontology_version}, "
                f"got {ontology.domain} v{ontology.version}"
            )
        missing_objects = sorted(set(self.objects) - {o.id for o in ontology.objects})
        missing_actions = sorted(set(self.actions) - {a.id for a in ontology.actions})
        if missing_objects or missing_actions:
            raise ValueError(
                f"task {self.id!r} uses ids not in the ontology: "
                f"objects {missing_objects}, actions {missing_actions}"
            )

    def step(self, step_id: str) -> Step:
        for step in self.steps:
            if step.id == step_id:
                return step
        raise KeyError(step_id)


class TaskSummary(Strict):
    """What the library lists to the UI."""

    id: TaskId
    version: int
    title_es: NonEmptyText
    domain: Id
    steps: int = Field(ge=1)
