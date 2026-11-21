"""The session WebSocket `/ws/session` (owner: Alonso).

Wires the pieces through the interfaces in `contracts.interfaces`:
frames → Perception → Observation → Controller → Decision → Voice → messages to the browser.
Owns timing and concurrency: at most one `observe` call in flight; `Controller.tick` about once a
second of client time; every send goes through one lock.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import logging
from collections import deque
from collections.abc import Callable

from contracts import Controller, Decision, Event, Frame, Perception, Task, Voice
from contracts.protocol import (
    Debug,
    Error,
    Hello,
    Issue,
    IssueClear,
    Label,
    Mute,
    Ready,
    Reset,
    Say,
    SkipStep,
    State,
    client_message_adapter,
    pack_audio,
    unpack_frame,
)
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import BaseModel, ValidationError

from ..library.store import TaskLibrary

log = logging.getLogger(__name__)

FRAME_WINDOW = 8  # frames handed to perception, oldest first
TICK_EVERY_MS = 1000
_session_ids = itertools.count(1)


class Session:
    def __init__(
        self,
        ws: WebSocket,
        task: Task,
        hello: Hello,
        perception: Perception,
        controller: Controller,
        voice: Voice,
    ) -> None:
        self.ws, self.task, self.hello = ws, task, hello
        self.perception, self.controller, self.voice = perception, controller, voice
        self.frames: deque[Frame] = deque(maxlen=FRAME_WINDOW)
        self.send_lock = asyncio.Lock()
        self.perceiving: asyncio.Task | None = None
        self.muted = False
        self.issue_open = False
        self.last_t_ms = 0
        self.last_tick_ms: int | None = None
        self.say_ids = itertools.count(1)
        self.latest: Decision | None = None

    async def send(self, message: BaseModel) -> None:
        async with self.send_lock:
            await self.ws.send_text(message.model_dump_json())

    async def emit(self, decision: Decision) -> None:
        self.latest = decision
        await self.send(State(seq=decision.seq, statuses=decision.statuses, next_steps=decision.next_steps))
        if decision.event is Event.MISTAKE:
            self.issue_open = True
            text = decision.say.text if decision.say else "Ojo, hay un error."
            await self.send(
                Issue(
                    step=decision.step,
                    kind=decision.mistake_kind,
                    mistake_id=decision.mistake_id,
                    text_es=text,
                )
            )
        elif self.issue_open and decision.event in (Event.STEP_DONE, Event.MISTAKE_FIXED, Event.TASK_DONE):
            self.issue_open = False
            await self.send(IssueClear(step=decision.step))
        if decision.say is not None and not self.muted:
            say_id = f"s{next(self.say_ids)}"
            audio = await self.voice.synthesize(decision.say)
            await self.send(
                Say(
                    id=say_id, text=decision.say.text, priority=decision.say.priority, audio=audio is not None
                )
            )
            if audio is not None:
                async with self.send_lock:
                    await self.ws.send_bytes(pack_audio(say_id, audio))

    async def on_frame(self, data: bytes) -> None:
        seq, t_ms, jpeg = unpack_frame(data)
        self.frames.append(Frame(seq=seq, t_ms=t_ms, jpeg=jpeg, source=self.hello.source))
        self.last_t_ms = t_ms
        await self.send(Debug(seq=seq))
        if self.perceiving is None or self.perceiving.done():
            self.perceiving = asyncio.create_task(self.perceive(list(self.frames)))
        if self.last_tick_ms is None or t_ms - self.last_tick_ms >= TICK_EVERY_MS:
            self.last_tick_ms = t_ms
            decision = self.controller.tick(t_ms)
            if decision is not None:
                await self.emit(decision)

    async def perceive(self, frames: list[Frame]) -> None:
        try:
            next_steps = list(self.latest.next_steps) if self.latest else []
            observation = await self.perception.observe(frames, self.task, next_steps)
            if observation is None:
                return
            if self.hello.debug:
                await self.send(
                    Debug(
                        seq=observation.seq,
                        latency_ms={"perception": observation.latency_ms},
                        observation=observation,
                    )
                )
            await self.emit(self.controller.decide(observation))
        except Exception:
            log.exception("perception failed")
            await self.send(Error(code="internal", message="La percepción falló; revisa el servidor."))

    async def on_text(self, text: str) -> None:
        message = client_message_adapter.validate_json(text)
        if isinstance(message, SkipStep):
            await self.emit(self.controller.skip(self.last_t_ms))
        elif isinstance(message, Reset):
            await self.emit(self.controller.start(self.task))
        elif isinstance(message, Mute):
            self.muted = message.on
        elif isinstance(message, Label):
            pass  # dataset recording: not implemented yet
        elif isinstance(message, Hello):
            raise ValueError("hello was already received")


async def run_session(
    ws: WebSocket,
    library: TaskLibrary,
    make_perception: Callable[[Task], Perception],
    make_controller: Callable[[], Controller],
    voice: Voice,
) -> None:
    await ws.accept()
    try:
        first = await ws.receive_text()
        try:
            hello = client_message_adapter.validate_json(first)
        except ValidationError as error:
            await ws.send_text(Error(code="bad_message", message=str(error)[:500]).model_dump_json())
            return
        if not isinstance(hello, Hello):
            await ws.send_text(
                Error(code="bad_message", message="first message must be hello").model_dump_json()
            )
            return
        task = library.get(hello.task_id)
        if task is None:
            await ws.send_text(
                Error(code="unknown_task", message=f"no task {hello.task_id!r}").model_dump_json()
            )
            return

        controller = make_controller()
        session = Session(ws, task, hello, make_perception(task), controller, voice)
        await session.send(Ready(session_id=f"s{next(_session_ids)}", task=task))
        await session.emit(controller.start(task))

        while True:
            message = await ws.receive()
            if message["type"] == "websocket.disconnect":
                break
            try:
                if message.get("bytes") is not None:
                    await session.on_frame(message["bytes"])
                elif message.get("text") is not None:
                    await session.on_text(message["text"])
            except (ValidationError, ValueError) as error:
                await session.send(Error(code="bad_message", message=str(error)[:500]))
            except Exception:
                # A bug in a component must not kill the session silently: report it and keep going.
                log.exception("session message failed")
                await session.send(
                    Error(code="internal", message="Error interno del servidor; revisa los logs.")
                )
    except WebSocketDisconnect:
        pass
    finally:
        with contextlib.suppress(Exception):
            await ws.close()
