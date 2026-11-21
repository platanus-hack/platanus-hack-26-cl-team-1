"""Step bookkeeping (current step + status per step) and the spoken lines for each step."""

from __future__ import annotations

import random
import re
from typing import Any

Step = dict[str, Any]

_OK = ("Bien ahí.", "Listo.", "Perfecto.", "Buena.", "Dale, quedó bien.")


def _first_sentence(text: str) -> str:
    m = re.match(r"(.+?[.!?])(\s|$)", text.strip())
    return (m.group(1) if m else text).strip()


def step_line(step: Step) -> str:
    """Short spoken version of a GuideStep."""
    title = step.get("title", "").rstrip(".")
    detail = step.get("detail", "")
    kind = step.get("kind")
    if kind == "part":
        first = _first_sentence(detail)
        return f"{title}: {first[:1].lower()}{first[1:]}" if first else f"{title}."
    if kind in ("wire", "power"):
        return _first_sentence(detail) if detail else f"{title}."
    if kind == "check":
        return f"{title}. {_first_sentence(detail)}"
    return f"{title}."


def greeting(step: Step) -> str:
    return f"Hola, empecemos. Primer paso: {step_line(step)}"


def next_line(step: Step, rng: random.Random | None = None) -> str:
    r = rng or random
    return f"{r.choice(_OK)} Paso {step['index']}: {step_line(step)}"


def finished_line() -> str:
    return "¡Listo, el circuito está armado! Conecta el USB y prueba tu programa."


class StepBook:
    def __init__(self, steps: list[Step], resume: dict | None = None) -> None:
        self.steps = sorted(steps, key=lambda s: s["index"])
        self.by_index = {s["index"]: s for s in self.steps}
        self.status: dict[str, str] = {str(s["index"]): "pending" for s in self.steps}
        self.current = self.steps[0]["index"] if self.steps else 1
        if resume:
            for k, v in (resume.get("status") or {}).items():
                if k in self.status and v in ("pending", "active", "done", "error"):
                    self.status[k] = v
            cur = int(resume.get("current") or self.current)
            if cur in self.by_index:
                self.current = cur
        if self.steps and self.status[str(self.current)] in ("pending",):
            self.status[str(self.current)] = "active"

    @property
    def finished(self) -> bool:
        return bool(self.steps) and all(v == "done" for v in self.status.values())

    def step(self, index: int | None = None) -> Step | None:
        return self.by_index.get(self.current if index is None else index)

    def msg(self) -> dict:
        return {"type": "step", "current": self.current, "status": dict(self.status)}

    def complete_current(self) -> Step | None:
        """Mark the current step done and move to the next pending one. Returns the new current step."""
        if not self.steps:
            return None
        self.status[str(self.current)] = "done"
        for s in self.steps:
            if s["index"] > self.current and self.status[str(s["index"])] != "done":
                self.current = s["index"]
                self.status[str(self.current)] = "active"
                return s
        for s in self.steps:  # an earlier step left undone (skipped back)
            if self.status[str(s["index"])] != "done":
                self.current = s["index"]
                self.status[str(self.current)] = "active"
                return s
        return None

    def back(self) -> Step | None:
        prev = [s for s in self.steps if s["index"] < self.current]
        if not prev:
            return None
        if self.status[str(self.current)] == "active":
            self.status[str(self.current)] = "pending"
        self.current = prev[-1]["index"]
        self.status[str(self.current)] = "active"
        return prev[-1]

    def set_error(self, on: bool) -> None:
        if not self.steps:
            return
        k = str(self.current)
        if on and self.status[k] == "active":
            self.status[k] = "error"
        elif not on and self.status[k] == "error":
            self.status[k] = "active"
