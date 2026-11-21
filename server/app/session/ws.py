"""The session WebSocket `/ws/session` (owner: Alonso).

Wires the pieces through the interfaces in `contracts.interfaces`:
frames → Perception → Observation → Controller → Decision → Voice → messages to the browser.
Owns timing and concurrency: at most one `observe` call in flight; `Controller.tick` about once a
second of client time; every send goes through one lock. Speech runs in background tasks (one line at
a time, in order) so a slow TTS call never blocks reading frames or the user's messages.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import logging
from collections import deque
from collections.abc import Callable, Coroutine
from typing import Any

from contracts import Controller, Decision, Event, Frame, Perception, SayRequest, Task, Voice
from contracts.protocol import (
    CancelSay,
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
from ..voice.queue import VoiceQueue

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
        make_perception: Callable[[Task], Perception],
        controller: Controller,
        voice: Voice,
        voice_queue: VoiceQueue | None = None,
    ) -> None:
        self.ws, self.task, self.hello = ws, task, hello
        self.make_perception = make_perception
        self.perception = make_perception(task)
        self.controller, self.voice = controller, voice
        self.generation = 0  # bumped by reset: results from an older generation are dropped
        self.frames: deque[Frame] = deque(maxlen=FRAME_WINDOW)
        self.send_lock = asyncio.Lock()
        self.perceiving: asyncio.Task | None = None
        self.muted = False
        self.issue_open = False
        self.last_t_ms = 0
        self.last_tick_ms: int | None = None
        self.say_ids = itertools.count(1)
        self.voice_queue = voice_queue or VoiceQueue()
        self.voice_lock = asyncio.Lock()  # one line decided + synthesized at a time (FIFO)
        self.voice_tasks: set[asyncio.Task] = set()
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
            playing = self.voice_queue.mistake_fixed(self.last_t_ms)
            if playing is not None:
                await self.send(CancelSay(id=playing))
        if decision.say is not None and not self.muted:
            self.in_background(self.offer_line(decision.say, self.last_t_ms, self.generation))

    def in_background(self, work: Coroutine[Any, Any, None]) -> None:
        task = asyncio.create_task(work)
        self.voice_tasks.add(task)
        task.add_done_callback(self.voice_tasks.discard)

    async def offer_line(self, request: SayRequest, now_ms: int, generation: int) -> None:
        async with self.voice_lock:
            if generation != self.generation or self.muted:
                return  # the session was reset or muted while this line waited for the lock
            line = self.voice_queue.offer(request, now_ms)
            if line is not None:
                await self.speak(line)

    async def speak(self, request: SayRequest) -> None:
        """Synthesize and send one line the voice queue let through (caller holds `voice_lock`).
        Errors are reported to the client: a background task must not fail silently."""
        try:
            await self._speak(request)
        except Exception:
            log.exception("voice failed")
            await self.send(Error(code="internal", message="La voz falló; revisa el servidor."))

    async def _speak(self, request: SayRequest) -> None:
        say_id = f"s{next(self.say_ids)}"
        audio = await self.voice.synthesize(request)
        await self.send(Say(id=say_id, text=request.text, priority=request.priority, audio=audio is not None))
        if audio is not None:
            async with self.send_lock:
                await self.ws.send_bytes(pack_audio(say_id, audio))
        self.voice_queue.spoken(say_id, request, self.last_t_ms, audio)

    async def flush_voice(self, now_ms: int, generation: int) -> None:
        """Speak the waiting line once the queue allows it."""
        async with self.voice_lock:
            if generation != self.generation or self.muted:
                return
            request = self.voice_queue.due(now_ms)
            if request is not None:
                await self.speak(request)

    async def close(self) -> None:
        for task in list(self.voice_tasks):
            task.cancel()
        await asyncio.gather(*self.voice_tasks, return_exceptions=True)

    async def on_frame(self, data: bytes) -> None:
        seq, t_ms, jpeg = unpack_frame(data)
        self.frames.append(Frame(seq=seq, t_ms=t_ms, jpeg=jpeg, source=self.hello.source))
        self.last_t_ms = t_ms
        await self.send(Debug(seq=seq))
        if self.perceiving is None or self.perceiving.done():
            self.perceiving = asyncio.create_task(self.perceive(list(self.frames), self.generation))
        if self.last_tick_ms is None or t_ms - self.last_tick_ms >= TICK_EVERY_MS:
            self.last_tick_ms = t_ms
            decision = self.controller.tick(t_ms)
            if decision is not None:
                await self.emit(decision)
            if self.voice_queue.pending is not None:
                self.in_background(self.flush_voice(t_ms, self.generation))

    async def perceive(self, frames: list[Frame], generation: int) -> None:
        try:
            next_steps = list(self.latest.next_steps) if self.latest else []
            observation = await self.perception.observe(frames, self.task, next_steps)
            if observation is None or generation != self.generation:
                return  # nothing new, or the session was reset while the model was thinking
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

    async def reset(self) -> None:
        """Start the task over: drop in-flight perception, old frames and the open issue."""
        self.generation += 1
        if self.perceiving is not None and not self.perceiving.done():
            self.perceiving.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.perceiving
        self.perceiving = None
        self.frames.clear()
        self.perception = self.make_perception(self.task)
        self.last_tick_ms = None
        playing = self.voice_queue.mistake_fixed(self.last_t_ms)
        self.voice_queue.reset()
        if self.issue_open:
            self.issue_open = False
            await self.send(IssueClear(step=None))
        if playing is not None:
            await self.send(CancelSay(id=playing))
        await self.emit(self.controller.start(self.task))

    async def on_text(self, text: str) -> None:
        message = client_message_adapter.validate_json(text)
        if isinstance(message, SkipStep):
            await self.emit(self.controller.skip(self.last_t_ms))
        elif isinstance(message, Reset):
            await self.reset()
        elif isinstance(message, Mute):
            self.muted = message.on
        elif isinstance(message, Label):
            raise ValueError("dataset recording is not implemented yet: label ignored")
        elif isinstance(message, Hello):
            raise ValueError("hello was already received")


async def run_session(
    ws: WebSocket,
    library: TaskLibrary,
    make_perception: Callable[[Task], Perception],
    make_controller: Callable[[], Controller],
    voice: Voice,
    make_voice_queue: Callable[[], VoiceQueue] = VoiceQueue,
) -> None:
    await ws.accept()
    session: Session | None = None
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
        if hello.record:
            message = "dataset recording is not implemented yet: reconnect with record=false"
            await ws.send_text(Error(code="bad_message", message=message).model_dump_json())
            return
        task = library.get(hello.task_id)
        if task is None:
            await ws.send_text(
                Error(code="unknown_task", message=f"no task {hello.task_id!r}").model_dump_json()
            )
            return

        controller = make_controller()
        try:
            session = Session(ws, task, hello, make_perception, controller, voice, make_voice_queue())
        except ValueError as error:  # misconfigured component (e.g. a bad SUP_ setting): say so
            await ws.send_text(Error(code="internal", message=str(error)[:500]).model_dump_json())
            return
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
        if session is not None:
            await session.close()
        with contextlib.suppress(Exception):
            await ws.close()
