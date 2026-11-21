"""The task automaton derived from a task's step DAG.

Shared by the symbolic simulator (to generate legal and illegal runs), the rule controller, and the
evaluation scripts, so all three agree on what "legal" means.
"""

from __future__ import annotations

import enum
from collections.abc import Iterable
from dataclasses import dataclass

from .common import MistakeKind
from .task import MistakeDef, Task


class Outcome(enum.StrEnum):
    ADVANCE = "advance"
    MISTAKE = "mistake"
    TASK_DONE = "task_done"


@dataclass(frozen=True)
class Transition:
    outcome: Outcome
    done: frozenset[str]  # completed steps after the transition
    step: str | None  # the step the action belongs to, if any
    kind: MistakeKind | None = None
    mistake: MistakeDef | None = None  # the task's definition, when one matches


class TaskAutomaton:
    def __init__(self, task: Task) -> None:
        self.task = task
        self._by_action = {s.action: s for s in task.steps}
        self._wrong = {m.action: m for m in task.mistakes if m.action is not None}

    @property
    def start(self) -> frozenset[str]:
        return frozenset()

    def legal_next(self, done: Iterable[str]) -> list[str]:
        """Steps that can be done now, in task order."""
        done = frozenset(done)
        return [s.id for s in self.task.steps if s.id not in done and set(s.requires) <= done]

    def is_complete(self, done: Iterable[str]) -> bool:
        return frozenset(done) == {s.id for s in self.task.steps}

    def mistake_for(self, step: str | None, kind: MistakeKind) -> MistakeDef | None:
        for mistake in self.task.mistakes:
            if mistake.kind is kind and mistake.step == step:
                return mistake
        return None

    def apply(self, done: Iterable[str], action: str) -> Transition:
        """What observing `action` in state `done` means. Never raises for an unknown action:
        anything outside the task's steps is a `wrong_action`."""
        done = frozenset(done)
        if action in self._wrong:
            mistake = self._wrong[action]
            return Transition(Outcome.MISTAKE, done, mistake.step, MistakeKind.WRONG_ACTION, mistake)

        step = self._by_action.get(action)
        if step is None:
            return Transition(Outcome.MISTAKE, done, None, MistakeKind.WRONG_ACTION)
        if step.id in done:
            kind = MistakeKind.REPEATED
            return Transition(Outcome.MISTAKE, done, step.id, kind, self.mistake_for(step.id, kind))
        if not set(step.requires) <= done:
            kind = MistakeKind.OUT_OF_ORDER
            return Transition(Outcome.MISTAKE, done, step.id, kind, self.mistake_for(step.id, kind))

        after = done | {step.id}
        outcome = Outcome.TASK_DONE if self.is_complete(after) else Outcome.ADVANCE
        return Transition(outcome, after, step.id)
