"""The full Modo Armado session: detector → tracker (rules, every frame) → VLM (per event) → voice."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import Any

import numpy as np

from . import messages as M
from .detector import Detector, Placed, place, wire_color
from .expected import WIRE_COLORS_ES, Expected, StepExpect, build_expected
from .session import Config, FrameResult, Session
from .state import Event, FrameVerdict, Tracker
from .vlm import VlmJudge, VlmResult
from .vlm_prompt import StepInfo, b64_jpeg, make_crop

log = logging.getLogger(__name__)


def step_info(exp: Expected, step: StepExpect, raw: dict[str, Any]) -> StepInfo:
    piezas = []
    if step.part and step.part in exp.parts:
        p = exp.parts[step.part]
        for leg in step.legs:
            piezas.append({"pieza": M.part_name(p), "pata": M.PIN_ES.get(leg.pin, leg.pin), "hueco": leg.hole})
    cables = []
    if step.wire:
        a, b = (step.wire_ends + [None, None])[:2]
        cables.append(
            {
                "cable": WIRE_COLORS_ES.get(step.wire_color or "", step.wire_color or ""),
                "desde": M.end_name(a) if a else "?",
                "hasta": M.end_name(b) if b else "?",
            }
        )
    return StepInfo(step.index, raw.get("title", step.title), raw.get("detail", ""), piezas, cables)


class AssemblySession(Session):
    def __init__(self, ws, cfg: Config, detector: Detector | None, judge: VlmJudge | None) -> None:
        super().__init__(ws, cfg)
        self.detector = detector
        self.judge = judge
        self.exp: Expected | None = None
        self.tracker: Tracker | None = None
        self._img: np.ndarray | None = None
        self._placed: list[Placed] = []
        self._events: asyncio.Queue[Event] = asyncio.Queue()
        self._worker: asyncio.Task | None = None
        self._paused: str | None = None
        self._vlm_ms: float | None = None
        self._issue_key: str | None = None

    async def run(self) -> None:
        self._worker = asyncio.create_task(self._work())
        try:
            await super().run()
        finally:
            self._worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._worker

    # ------------------------------------------------------------------ hooks
    def on_hello_extra(self) -> None:
        assert self.hello is not None
        self.exp = build_expected(self.hello)
        self.tracker = Tracker(self.exp, detector=self.detector is not None)

    def process_extra(self, img: np.ndarray, res: FrameResult) -> None:
        self._img = img
        if self.detector is None:
            self._placed = []
            return
        t = time.perf_counter()
        dets = self.detector(img)
        res.latency_ms["yolo"] = round((time.perf_counter() - t) * 1000, 1)
        placed = place(dets, self.reg)
        for p in placed:
            if p.cls == "wire_end":
                p.color = wire_color(img, p.det.box)
        self._placed = placed
        res.detections = [p.to_msg() for p in placed]

    async def after_frame(self, res: FrameResult, jpeg: bytes) -> None:
        await super().after_frame(res, jpeg)
        if self._vlm_ms is not None:
            res.latency_ms["vlm"] = round(self._vlm_ms)
        if self.book is None or self.tracker is None:
            return
        for ev in self.tracker.update(self.book.current, self._placed, res.calib_ok):
            if ev.kind == "paused":
                self._paused = ev.verdict.detail if ev.verdict else "Pausa"
            elif ev.kind == "resumed":
                self._paused = None
            else:
                self._events.put_nowait(ev)
        res.paused = self._paused

    async def advance(self, manual: bool = False) -> None:
        await self._clear_issue(say_fixed=False)
        await super().advance(manual)

    # ------------------------------------------------------------------ events
    async def _work(self) -> None:
        while True:
            ev = await self._events.get()
            try:
                if self.book is None or ev.step != self.book.current:
                    continue  # stale (the step changed meanwhile)
                await self._handle(ev)
            except Exception:  # noqa: BLE001 — one bad event must not end the session
                log.exception("evento %s", ev.kind)

    async def _handle(self, ev: Event) -> None:
        assert self.exp and self.book and self.tracker
        step = self.exp.step(ev.step)
        raw = self.book.step(ev.step) or {}
        if step is None:
            return
        if ev.kind == "stall":
            self.speaker.say(M.stall_line(raw))
            return
        if ev.kind == "issue_gone":
            await self._clear_issue(say_fixed=True)
            return
        polarized = bool(step.part and self.exp.parts[step.part].polarized)
        board_end = any(e.board_pin for e in step.wire_ends)
        if ev.kind == "step_candidate":
            r = await self._ask(step, raw, None)
            v = r.verdict if r else None
            trust_vlm = polarized or board_end
            if v is not None and v.error and trust_vlm:
                await self._report(step, FrameVerdict("issue", v.tipo, step.part or step.wire), v.mensaje)
            elif self.book.current == ev.step:
                await self.advance()
        elif ev.kind == "issue_candidate" and ev.verdict:
            r = await self._ask(step, raw, ev.verdict.detail or ev.verdict.issue)
            if r is None or r.verdict is None:  # no VLM / timeout → rules alone
                await self._report(step, ev.verdict, None)
            elif r.verdict.error:
                kind = r.verdict.tipo if r.verdict.tipo != "ninguno" else ev.verdict.issue
                await self._report(
                    step,
                    FrameVerdict("issue", kind, ev.verdict.target, ev.verdict.shift, ev.verdict.observed_hole),
                    r.verdict.mensaje,
                )
            # ok / incierto → say nothing (the VLM did not confirm)
        elif ev.kind == "vlm_check":
            r = await self._ask(step, raw, None)
            if r and r.verdict:
                if r.verdict.ok and self.book.current == ev.step:
                    await self.advance()
                elif r.verdict.error:
                    await self._report(
                        step, FrameVerdict("issue", r.verdict.tipo, step.part or step.wire), r.verdict.mensaje
                    )

    async def _ask(self, step: StepExpect, raw: dict, suspected: str | None) -> VlmResult | None:
        if self.judge is None or self._img is None:
            return None
        img = self._img
        holes_px = {h: p for h in step.holes if (p := self.reg.hole_to_pixel(h))}
        crop = make_crop(img, holes_px, self.reg.pitch_px() or 8.0)
        r = await self.judge.judge(step_info(self.exp, step, raw), suspected, b64_jpeg(img, 80), b64_jpeg(crop, 85))
        self._vlm_ms = r.latency_ms
        self.on_vlm(step, suspected, img, crop, r)
        return r

    def on_vlm(self, step: StepExpect, suspected: str | None, img: np.ndarray, crop: np.ndarray, r: VlmResult) -> None:
        """Hook for the recorder."""

    async def _report(self, step: StepExpect, v: FrameVerdict, text: str | None) -> None:
        assert self.exp and self.book and self.tracker
        kind = v.issue or "wrong_hole"
        line = (text or "").strip() or M.issue_line(kind, self.exp, step, shift=v.shift, observed_hole=v.observed_hole)
        self.book.set_error(True)
        self._issue_key = f"issue:{step.index}"
        await self.send_json(
            {"type": "issue", "step": step.index, "kind": kind, "target": v.target, "text": line, "holes": step.holes}
        )
        await self.send_json(self.book.msg())
        self.speaker.say(line, "error", key=self._issue_key)
        self.tracker.issue_reported(v)

    async def _clear_issue(self, say_fixed: bool) -> None:
        if self._issue_key is None or self.book is None:
            return
        await self.speaker.cancel(self._issue_key)
        self._issue_key = None
        self.book.set_error(False)
        await self.send_json({"type": "issue_clear", "step": self.book.current})
        await self.send_json(self.book.msg())
        if say_fixed:
            self.speaker.say(M.fixed_line())
