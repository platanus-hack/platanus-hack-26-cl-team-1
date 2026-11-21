"""One Modo Armado session over /ws/session."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from .protocol import PROTOCOL, decode_frame
from .registration import Registration, canvas_to_cv
from .speaker import Speaker
from .steps import StepBook, finished_line, greeting, next_line

log = logging.getLogger(__name__)


@dataclass
class Config:
    data_dir: Path
    synth: Callable[[str], bytes] | None = None
    voice: str | None = None
    calib_path: Path | None = None
    capture_every_s: float = 1.0


@dataclass
class FrameResult:
    seq: int
    t_ms: int
    latency_ms: dict[str, float] = field(default_factory=dict)
    markers: int = 0
    calib_ok: bool = False
    calib_changed: bool = False
    detections: list[dict] = field(default_factory=list)
    paused: str | None = None


class Session:
    def __init__(self, ws: WebSocket, cfg: Config, registration: Registration | None = None) -> None:
        self.ws = ws
        self.cfg = cfg
        self.id = uuid.uuid4().hex[:8]
        self._send_lock = asyncio.Lock()
        self.speaker = Speaker(self.send_json, self.send_bytes, cfg.synth)
        self.reg = registration or Registration(cfg.calib_path)
        self.book: StepBook | None = None
        self.hello: dict[str, Any] | None = None
        self.debug = False
        self.record = False
        self.capture_on = False
        self.capture_saved = 0
        self._last_capture = 0.0
        self._calib_ok_sent: bool | None = None
        self._markers_sent = -1
        self._busy = False

    # ------------------------------------------------------------------ io
    async def send_json(self, msg: dict) -> None:
        async with self._send_lock:
            await self.ws.send_text(json.dumps(msg, ensure_ascii=False))

    async def send_bytes(self, data: bytes) -> None:
        async with self._send_lock:
            await self.ws.send_bytes(data)

    async def run(self) -> None:
        speaker_task = asyncio.create_task(self.speaker.run())
        try:
            while True:
                msg = await self.ws.receive()
                if msg["type"] == "websocket.disconnect":
                    break
                if msg.get("bytes") is not None:
                    await self.on_frame(msg["bytes"])
                elif msg.get("text") is not None:
                    try:
                        data = json.loads(msg["text"])
                    except json.JSONDecodeError:
                        continue
                    await self.on_message(data)
        except WebSocketDisconnect:
            pass
        finally:
            speaker_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await speaker_task

    # ------------------------------------------------------------------ control
    async def on_message(self, m: dict) -> None:
        t = m.get("type")
        if t == "hello":
            await self.on_hello(m)
        elif self.book is None:
            await self.send_json({"type": "error", "message": "Falta el saludo (hello)."})
        elif t == "skip_step":
            await self.advance(manual=True)
        elif t == "back_step":
            step = self.book.back()
            await self.send_json(self.book.msg())
            if step:
                await self.send_json({"type": "issue_clear", "step": self.book.current})
                self.speaker.say(f"Volvamos al paso {step['index']}: {step['title']}.")
        elif t == "set_debug":
            self.debug = bool(m.get("debug"))
        elif t == "set_record":
            self.record = bool(m.get("record"))
        elif t == "set_capture":
            self.capture_on = bool(m.get("on"))
        elif t == "mute":
            self.speaker.muted = bool(m.get("muted"))
        elif t == "calib_points":
            pts = {k: canvas_to_cv(float(v[0]), float(v[1])) for k, v in (m.get("points") or {}).items()}
            err = self.reg.refine_with_clicks(pts)
            await self.send_json(
                {
                    "type": "calibration",
                    "ok": self.reg.H is not None,
                    "markers": len(self.reg.last_seen),
                    "H": self.reg.H_list(),
                    "refined": self.reg.refined,
                    "message": err or "Calibración fina guardada.",
                }
            )
        elif t == "label":
            await self.on_label(m)

    async def on_hello(self, m: dict) -> None:
        if m.get("protocol") != PROTOCOL:
            await self.send_json({"type": "error", "message": f"Protocolo {m.get('protocol')} no soportado."})
            return
        resumed = self.book is not None or bool(m.get("resume"))
        self.hello = m
        self.debug = bool(m.get("debug"))
        self.record = bool(m.get("record"))
        self.book = StepBook(m.get("steps") or [], m.get("resume"))
        await self.send_json(
            {"type": "ready", "calibrated": self.reg.H is not None, "session": self.id, "voice": self.cfg.voice}
        )
        await self.send_calibration(force=True)
        await self.send_json(self.book.msg())
        step = self.book.step()
        if step and not resumed:
            self.speaker.say(greeting(step))
        self.on_hello_extra()

    def on_hello_extra(self) -> None:
        """Hook for the assembly pipeline (expected state, tracker)."""

    async def on_label(self, m: dict) -> None:
        """Hook for the recorder (F7)."""

    async def advance(self, manual: bool = False) -> None:
        assert self.book is not None
        self.book.set_error(False)
        await self.send_json({"type": "issue_clear", "step": self.book.current})
        nxt = self.book.complete_current()
        await self.send_json(self.book.msg())
        if nxt is not None:
            self.speaker.say(next_line(nxt) if not manual else f"Dale. Paso {nxt['index']}: {nxt['title']}.")
        elif self.book.finished:
            self.speaker.say(finished_line())

    async def send_calibration(self, force: bool = False) -> None:
        ok = self.reg.H is not None
        n = len(self.reg.last_seen)
        if not force and ok == self._calib_ok_sent and n == self._markers_sent:
            return
        self._calib_ok_sent, self._markers_sent = ok, n
        await self.send_json(
            {"type": "calibration", "ok": ok, "markers": n, "H": self.reg.H_list(), "refined": self.reg.refined}
        )

    # ------------------------------------------------------------------ frames
    async def on_frame(self, data: bytes) -> None:
        try:
            seq, t_ms, jpeg = decode_frame(data)
        except ValueError:
            return
        if self._busy:  # client backpressure should prevent this; never queue frames
            return
        self._busy = True
        t0 = time.perf_counter()
        try:
            res = await asyncio.to_thread(self.process, seq, t_ms, jpeg)
            await self.after_frame(res, jpeg)
        finally:
            self._busy = False
        res.latency_ms["total"] = round((time.perf_counter() - t0) * 1000, 1)
        msg: dict[str, Any] = {"type": "debug", "seq": seq, "t_ms": t_ms, "latency_ms": res.latency_ms}
        if res.paused:
            msg["paused"] = res.paused
        if self.debug:
            msg["detections"] = res.detections
        await self.send_json(msg)

    def process(self, seq: int, t_ms: int, jpeg: bytes) -> FrameResult:
        """Runs in a worker thread: decode + registration (+ detector in subclasses)."""
        res = FrameResult(seq, t_ms)
        t = time.perf_counter()
        img = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if img is None:
            res.paused = "Frame ilegible"
            return res
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        res.latency_ms["decode"] = round((time.perf_counter() - t) * 1000, 1)
        t = time.perf_counter()
        up = self.reg.update(gray)
        res.latency_ms["aruco"] = round((time.perf_counter() - t) * 1000, 1)
        res.markers, res.calib_ok, res.calib_changed = up.markers, up.ok, up.changed
        self.process_extra(img, res)
        return res

    def process_extra(self, img: np.ndarray, res: FrameResult) -> None:
        """Hook for detection (F6)."""

    async def after_frame(self, res: FrameResult, jpeg: bytes) -> None:
        if res.calib_changed:
            await self.send_calibration(force=True)
        else:
            await self.send_calibration()
        if self.capture_on:
            now = time.monotonic()
            if now - self._last_capture >= self.cfg.capture_every_s:
                self._last_capture = now
                d = self.cfg.data_dir / "yolo" / "raw" / self.id
                d.mkdir(parents=True, exist_ok=True)
                (d / f"{int(time.time() * 1000)}_{res.seq:06d}.jpg").write_bytes(jpeg)
                self.capture_saved += 1
                await self.send_json({"type": "capture", "saved": self.capture_saved})
