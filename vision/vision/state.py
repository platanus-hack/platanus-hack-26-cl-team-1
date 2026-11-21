"""Observed vs. expected → per-frame verdict for the active step → events, with hysteresis.

A verdict must hold for `n_frames` consecutive frames (8 ≈ 1.3 s at 6 fps) before an event
fires, and fires once until the verdict changes. A hand over the step's holes pauses the
evaluation (counters frozen, not reset).
"""

from __future__ import annotations

import time
from collections import Counter
from dataclasses import dataclass, field

from .detector import COMPONENT_CLASSES, Placed
from .expected import Expected, StepExpect, strip_of
from .mat import BB_RAILS, hole_grid

CHANNEL_Y = 10.5


@dataclass(frozen=True)
class FrameVerdict:
    kind: str  # complete | incomplete | issue | occluded | vlm_only | manual
    issue: str | None = None
    target: str | None = None
    shift: int = 0
    observed_hole: str | None = None
    detail: str = ""

    def key(self) -> tuple:
        return (self.kind, self.issue, self.target, self.shift, self.observed_hole)


@dataclass
class Event:
    kind: str  # step_candidate | issue_candidate | issue_gone | stall | paused | resumed | vlm_check
    step: int
    verdict: FrameVerdict | None = None
    holes: list[str] = field(default_factory=list)


def _center(holes: list[str]) -> tuple[float, float] | None:
    pts = [hole_grid(h) for h in holes]
    pts = [p for p in pts if p]
    if not pts:
        return None
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def _side(y: float) -> str:
    return "top" if y < CHANNEL_Y else "bottom"


class Tracker:
    def __init__(
        self,
        exp: Expected,
        n_frames: int = 8,
        stall_s: float = 25.0,
        board_after_s: float = 4.0,
        check_after_s: float = 6.0,
        clock=time.monotonic,
        detector: bool = True,
    ) -> None:
        self.exp = exp
        self.detector = detector  # without a detector, part/wire steps are judged by the VLM alone
        self.n = n_frames
        self.stall_s = stall_s
        self.board_after_s = board_after_s
        self.check_after_s = check_after_s
        self.clock = clock
        self.current: int | None = None
        self._streak_key: tuple | None = None
        self._streak = 0
        self._fired: tuple | None = None  # verdict key already turned into an event
        self.active_issue: FrameVerdict | None = None
        self._since = clock()
        self._stalled = False
        self._paused = False
        self._last_vlm_check = float("-inf")

    # ----------------------------------------------------------------- lifecycle
    def reset(self, current: int) -> None:
        self.current = current
        self._streak_key, self._streak, self._fired = None, 0, None
        self.active_issue = None
        self._since = self.clock()
        self._stalled = False
        self._paused = False
        self._last_vlm_check = float("-inf")

    def progressed(self) -> None:
        """Something happened (an issue was spoken, the user moved): restart the stall timer."""
        self._since = self.clock()
        self._stalled = False

    # ----------------------------------------------------------------- per frame
    def update(self, current: int, placed: list[Placed], calibrated: bool) -> list[Event]:
        if current != self.current:
            self.reset(current)
        step = self.exp.step(current)
        if step is None:
            return []
        v = self.evaluate(step, placed, calibrated)
        events: list[Event] = []
        now = self.clock()

        if v.kind == "occluded":
            if not self._paused:
                self._paused = True
                events.append(Event("paused", current, v))
            return events
        if self._paused:
            self._paused = False
            events.append(Event("resumed", current, v))

        k = v.key()
        if k == self._streak_key:
            self._streak += 1
        else:
            self._streak_key, self._streak = k, 1
            if self._fired is not None and self._fired != k:
                self._fired = None

        stable = self._streak >= self.n
        if stable and self.active_issue is not None and v.key() != self.active_issue.key() and v.kind != "issue":
            events.append(Event("issue_gone", current, self.active_issue, step.holes))
            self.active_issue = None
        if stable and self._fired != k:
            if v.kind == "complete":
                events.append(Event("step_candidate", current, v, step.holes))
                self._fired = k
            elif v.kind == "issue":
                events.append(Event("issue_candidate", current, v, step.holes))
                self._fired = k
        if v.kind == "vlm_only" and now - self._since > 3.0 and now - self._last_vlm_check > 6.0:
            self._last_vlm_check = now
            events.append(Event("vlm_check", current, v, step.holes))
        if (
            not self._stalled
            and self.active_issue is None
            and now - self._since > self.stall_s
            and v.kind != "complete"
        ):
            self._stalled = True
            events.append(Event("stall", current, v, step.holes))
        return events

    def issue_reported(self, v: FrameVerdict) -> None:
        self.active_issue = v
        self.progressed()

    # ----------------------------------------------------------------- rules
    def evaluate(self, step: StepExpect, placed: list[Placed], calibrated: bool) -> FrameVerdict:
        if self._hand_over(step, placed):
            return FrameVerdict("occluded", detail="Mano sobre la protoboard")
        elapsed = self.clock() - self._since
        if step.kind == "breadboard":
            return FrameVerdict("complete" if calibrated and elapsed > 1.5 else "incomplete")
        if step.kind == "board":
            seen = any(p.cls == "arduino_uno" for p in placed)
            return FrameVerdict("complete" if seen or (calibrated and elapsed > self.board_after_s) else "incomplete")
        if step.kind == "check":
            return FrameVerdict("complete" if elapsed > self.check_after_s else "incomplete")
        if step.kind == "program" or not calibrated:
            return FrameVerdict("manual" if step.kind == "program" else "incomplete")
        if not self.detector and (step.part or step.wire):
            return FrameVerdict("vlm_only", target=step.part or step.wire)
        if step.part:
            return self._part_verdict(step, placed)
        if step.wire:
            return self._wire_verdict(step, placed)
        return FrameVerdict("manual")

    def _hand_over(self, step: StepExpect, placed: list[Placed]) -> bool:
        c = _center(step.holes)
        for p in placed:
            if p.cls != "hand" or p.grid_box is None:
                continue
            if c is None:
                return True
            gx1, gy1, gx2, gy2 = p.grid_box
            if gx1 - 2 <= c[0] <= gx2 + 2 and gy1 - 2 <= c[1] <= gy2 + 2:
                return True
        return False

    def _part_verdict(self, step: StepExpect, placed: list[Placed]) -> FrameVerdict:
        part = self.exp.parts[step.part]
        c = _center([leg.hole for leg in step.legs])
        if part.yolo is None or c is None:
            return FrameVerdict("vlm_only", target=step.part)
        straddles = len({_side(hole_grid(leg.hole)[1]) for leg in step.legs}) > 1
        dy_tol = 1.0 if straddles else 2.6

        def dy_ok(p: Placed) -> bool:
            gy = p.grid_center[1]
            return abs(gy - c[1]) <= dy_tol and (straddles or _side(gy) == _side(c[1]))

        on_board = [p for p in placed if p.grid_center is not None and p.cls in COMPONENT_CLASSES]
        same = sorted(
            (p for p in on_board if p.cls == part.yolo and dy_ok(p)), key=lambda p: abs(p.grid_center[0] - c[0])
        )
        # parts already placed in earlier steps are expected to be there: don't mistake them for this one
        taken = self._expected_elsewhere(step)
        same = [p for p in same if not self._explained(p, taken)]
        if same:
            dx = same[0].grid_center[0] - c[0]
            shift = round(dx)
            if abs(dx) <= 0.6:
                return FrameVerdict("complete", target=step.part)
            if 1 <= abs(shift) <= 4:
                return FrameVerdict(
                    "issue",
                    "wrong_hole",
                    step.part,
                    shift,
                    detail=f"corrida {abs(shift)} columna(s) hacia {'la derecha' if shift > 0 else 'la izquierda'}",
                )
        other = [
            p
            for p in on_board
            if p.cls != part.yolo and abs(p.grid_center[0] - c[0]) <= 0.8 and dy_ok(p) and not self._explained(p, taken)
        ]
        if other:
            return FrameVerdict("issue", "wrong_part", step.part, detail=f"se ve {other[0].cls} en vez de {part.yolo}")
        return FrameVerdict("incomplete", target=step.part)

    def _expected_elsewhere(self, step: StepExpect) -> list[tuple[str, tuple[float, float]]]:
        """(yolo class, centre) of the parts of every earlier step."""
        out = []
        for s in self.exp.steps.values():
            if s.index >= step.index or not s.part or s.part not in self.exp.parts:
                continue
            cls = self.exp.parts[s.part].yolo
            c = _center([leg.hole for leg in s.legs])
            if cls and c:
                out.append((cls, c))
        return out

    @staticmethod
    def _explained(p: Placed, taken: list[tuple[str, tuple[float, float]]]) -> bool:
        gx, gy = p.grid_center
        return any(cls == p.cls and abs(gx - c[0]) <= 0.6 and abs(gy - c[1]) <= 2.6 for cls, c in taken)

    def _wire_verdict(self, step: StepExpect, placed: list[Placed]) -> FrameVerdict:
        ends = [e for e in step.wire_ends if e.hole]
        if not ends:
            return FrameVerdict("vlm_only", target=step.wire)
        obs = Counter(strip_of(h) for p in placed if p.cls == "wire_end" for h in p.holes[:1])
        prev = self.exp.steps.get(step.index - 1)
        before = Counter(e.strip for e in (prev.cumulative_wire_ends if prev else set()) if e.hole)
        after = Counter(e.strip for e in step.cumulative_wire_ends if e.hole)
        missing = [e for e in ends if obs[e.strip] < after[e.strip]]
        if not missing:
            return FrameVerdict("complete", target=step.wire)
        # a wire end where none is expected (beyond the ones already there) while ours is missing
        extra = [s for s, n in obs.items() if n > after.get(s, 0) and s not in BB_RAILS]
        new_ends = sum(obs.values()) - sum(before.values())
        if extra and new_ends >= 1:
            hole = next(
                (h for p in placed if p.cls == "wire_end" for h in p.holes[:1] if strip_of(h) == extra[0]), None
            )
            return FrameVerdict(
                "issue",
                "wire_wrong_end",
                step.wire,
                observed_hole=hole,
                detail=f"un extremo está en {hole}, se esperaba {missing[0].hole}",
            )
        return FrameVerdict("incomplete", target=step.wire)
