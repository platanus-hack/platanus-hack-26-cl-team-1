"""Rule controller v0 on the task automaton (owner: Cote).

The baseline and the safety rail: observations move the automaton; mistakes produce the task's
correction; uncertain observations change nothing and say nothing. The learned controller (later)
must emit the same `Decision`s so the two can be compared.
"""

from __future__ import annotations

from contracts import (
    Decision,
    Event,
    MistakeKind,
    Observation,
    Outcome,
    Priority,
    Quality,
    SayRequest,
    StepStatus,
    Task,
    TaskAutomaton,
)

MIN_CONFIDENCE = 0.5
REMIND_AFTER_MS = 20_000
# A step seen out of order this many times in a row, whose one missing prerequisite could be done now, is
# taken as proof that the prerequisite happened unseen (a brief action between two perception calls, like
# taking soap). The out-of-order warning is still said on the first sighting.
INFER_AFTER = 4  # 3 skipped a real step on a run where the model hallucinated 3 early rinses
INFER_MIN_MS = 2000  # …spanning at least this long, so faster perception doesn't infer sooner (D-018)


class RulesController:
    def __init__(
        self,
        min_confidence: float = MIN_CONFIDENCE,
        remind_after_ms: int = REMIND_AFTER_MS,
        infer_after: int = INFER_AFTER,
        infer_min_ms: int = INFER_MIN_MS,
    ) -> None:
        self.min_confidence = min_confidence
        self.remind_after_ms = remind_after_ms
        self.infer_after = infer_after
        self.infer_min_ms = infer_min_ms

    # ── Controller interface ─────────────────────────────────────────────────

    def start(self, task: Task) -> Decision:
        self.task = task
        self.automaton = TaskAutomaton(task)
        self.done: frozenset[str] = self.automaton.start
        self.mistake_step: str | None = None
        self.open_mistake: tuple | None = None  # (kind, step, mistake_id) already announced
        self.seq = 0
        self.last_progress_ms: int | None = None
        self.last_reminder_ms: int | None = None
        self.streak: tuple[str, int, int] | None = (
            None  # (action, consecutive out-of-order sightings, first t)
        )
        first = self.task.step(self.automaton.legal_next(self.done)[0])
        # The greeting is a reminder of the first step.
        greeting = SayRequest(text=f"Vamos con: {task.title_es}. {first.instruction_es}")
        return self._decision(Event.REMINDER, step=first.id, say=greeting)

    def decide(self, observation: Observation) -> Decision:
        self.seq = observation.seq
        out = observation.output
        if self.automaton.is_complete(self.done):
            return self._decision(Event.NONE)  # task finished: nothing left to supervise
        if out.action is None or out.confidence < self.min_confidence:
            return self._decision(Event.NONE)

        transition = self.automaton.apply(self.done, out.action)
        if transition.outcome is not Outcome.MISTAKE and out.quality is Quality.BAD:
            # Right action, done badly: `incomplete`, state unchanged.
            mistake = self.automaton.mistake_for(transition.step, MistakeKind.INCOMPLETE)
            text = mistake.correction_es if mistake else "Ojo, hazlo con más cuidado y repítelo."
            return self._mistake(
                transition.step, MistakeKind.INCOMPLETE, mistake.id if mistake else None, text
            )

        out_of_order = transition.outcome is Outcome.MISTAKE and transition.kind is MistakeKind.OUT_OF_ORDER
        same = out_of_order and self.streak is not None and self.streak[0] == out.action
        count, since = (self.streak[1] + 1, self.streak[2]) if same and self.streak else (1, observation.t_ms)
        self.streak = (out.action, count, since) if out_of_order else None
        long_enough = count >= self.infer_after and observation.t_ms - since >= self.infer_min_ms

        if transition.outcome is Outcome.MISTAKE:
            if transition.kind is MistakeKind.REPEATED:
                return self._decision(Event.NONE)  # perception often reports an ongoing action twice
            legal = self.automaton.legal_next(self.done)
            if transition.kind is MistakeKind.WRONG_ACTION and not self._near(transition.step, legal):
                # A forbidden action for a step that is far from due (opening the faucet bare-handed at the
                # start is fine; closing it bare-handed near the end isn't, even a step early).
                return self._decision(Event.NONE)
            inferred = self._infer(transition.step, observation.t_ms) if long_enough else None
            if out_of_order and inferred:
                return inferred
            text = self._correction_text(transition)
            mistake_id = transition.mistake.id if transition.mistake else None
            return self._mistake(transition.step, transition.kind, mistake_id, text)

        self.done = transition.done
        self.mistake_step = None
        self.open_mistake = None
        self.last_progress_ms = observation.t_ms
        step = self.task.step(transition.step)
        if transition.outcome is Outcome.TASK_DONE:
            return self._decision(
                Event.TASK_DONE, step=step.id, say=SayRequest(text="¡Listo! Terminaste la tarea.")
            )
        nxt = self.task.step(self.automaton.legal_next(self.done)[0])
        return self._decision(
            Event.STEP_DONE, step=step.id, say=SayRequest(text=f"Bien. {nxt.instruction_es}")
        )

    def tick(self, now_ms: int) -> Decision | None:
        if self.automaton.is_complete(self.done):
            return None
        if self.last_progress_ms is None:
            self.last_progress_ms = now_ms
            return None
        since = max(self.last_progress_ms, self.last_reminder_ms or 0)
        if now_ms - since < self.remind_after_ms:
            return None
        self.last_reminder_ms = now_ms
        nxt = self.task.step(self.automaton.legal_next(self.done)[0])
        return self._decision(Event.REMINDER, step=nxt.id, say=SayRequest(text=nxt.instruction_es))

    def skip(self, now_ms: int) -> Decision:
        if self.automaton.is_complete(self.done):
            return self._decision(Event.NONE)  # nothing left to skip
        step = self.task.step(self.automaton.legal_next(self.done)[0])
        observation_action = step.action
        transition = self.automaton.apply(self.done, observation_action)
        self.done = transition.done
        self.mistake_step = None
        self.open_mistake = None
        self.last_progress_ms = now_ms
        if transition.outcome is Outcome.TASK_DONE:
            return self._decision(
                Event.TASK_DONE, step=step.id, say=SayRequest(text="¡Listo! Terminaste la tarea.")
            )
        nxt = self.task.step(self.automaton.legal_next(self.done)[0])
        return self._decision(Event.STEP_DONE, step=step.id, say=SayRequest(text=nxt.instruction_es))

    # ── helpers ──────────────────────────────────────────────────────────────

    def _near(self, step_id: str | None, legal: list[str]) -> bool:
        """The step is due now, or each of its prerequisites is done or due now (one step away)."""
        if step_id is None or step_id in legal:
            return True
        return all(r in self.done or r in legal for r in self.task.step(step_id).requires)

    def _infer(self, step_id: str | None, t_ms: int) -> Decision | None:
        """Mark `step_id` done together with its one missing prerequisite, if that prerequisite could be
        done now. Returns None (keep warning) when more than one step is missing or it isn't due yet, or when
        the task defines doing this step out of order as a mistake: then the out-of-order action is the
        mistake itself (power with the parking brake set, the battery connected early), not a missed step."""
        if step_id is None or any(
            m.kind is MistakeKind.OUT_OF_ORDER and m.step == step_id for m in self.task.mistakes
        ):
            return None
        step = self.task.step(step_id)
        missing = [r for r in step.requires if r not in self.done]
        if len(missing) != 1 or missing[0] not in self.automaton.legal_next(self.done):
            return None
        skipped = self.task.step(missing[0])
        done = self.automaton.apply(self.done, skipped.action).done
        transition = self.automaton.apply(done, step.action)
        self.done = transition.done
        self.mistake_step = None
        self.open_mistake = None
        self.streak = None
        self.last_progress_ms = t_ms
        assumed = f"Bien, doy por hecho: {skipped.title_es.lower()}."
        if transition.outcome is Outcome.TASK_DONE:
            text = f"{assumed} ¡Listo! Terminaste la tarea."
            return self._decision(Event.TASK_DONE, step=step.id, say=SayRequest(text=text))
        nxt = self.task.step(self.automaton.legal_next(self.done)[0])
        return self._decision(
            Event.STEP_DONE, step=step.id, say=SayRequest(text=f"{assumed} {nxt.instruction_es}")
        )

    def _correction_text(self, transition) -> str:
        if transition.mistake is not None:
            return transition.mistake.correction_es
        nxt = self.task.step(self.automaton.legal_next(self.done)[0])
        if transition.kind is MistakeKind.OUT_OF_ORDER:
            return f"Ojo, todavía no. Primero: {nxt.title_es.lower()}."
        return f"Ojo, eso no va ahora. {nxt.instruction_es}"

    def _mistake(self, step: str | None, kind: MistakeKind, mistake_id: str | None, text: str) -> Decision:
        key = (kind, step, mistake_id)
        if key == self.open_mistake:
            # The same mistake seen again before any progress: it's already on screen and was said once.
            return self._decision(Event.NONE)
        self.open_mistake = key
        self.mistake_step = self.automaton.legal_next(self.done)[0]
        return self._decision(
            Event.MISTAKE,
            step=step,
            mistake_kind=kind,
            mistake_id=mistake_id,
            say=SayRequest(text=text, priority=Priority.URGENT),
        )

    def _statuses(self) -> dict[str, StepStatus]:
        legal = set(self.automaton.legal_next(self.done))
        statuses = {}
        for step in self.task.steps:
            if step.id in self.done:
                statuses[step.id] = StepStatus.DONE
            elif step.id == self.mistake_step:
                statuses[step.id] = StepStatus.MISTAKE
            elif step.id in legal:
                statuses[step.id] = StepStatus.ACTIVE
            else:
                statuses[step.id] = StepStatus.PENDING
        return statuses

    def _decision(self, event: Event, **fields) -> Decision:
        return Decision(
            seq=self.seq,
            event=event,
            statuses=self._statuses(),
            next_steps=tuple(self.automaton.legal_next(self.done)),
            **fields,
        )
