"""`VlmPerception`: Qwen3-VL served by vLLM (OpenAI-compatible API) behind the `Perception` interface.

- At least `min_interval_ms` between call starts, and at most `max_in_flight` calls at once (per
  instance, i.e. per session). With 1, `observe` awaits its call. With more, calls are pipelined:
  `observe` starts a call when one is due and returns the oldest answer once it's in, waiting at most
  until the next call is due (else `None`, and the next frame's `observe` picks it up). Answers come in
  launch order; the session keeps one `observe` at a time while vLLM batches several calls at about the
  latency of one (D-018).
- The model sees `frames_per_call` frames spread over the last `span_ms` (downscaled JPEG), the task's
  actions, objects, next steps and mistakes. Guided decoding forces the task-narrowed `VlmOutput` schema.
- A bad answer (invalid JSON, an action outside the task, `null` action with quality `ok`…) becomes an
  uncertain observation (`action=None`, `quality=unknown`) so the supervisor stays silent. Real failures
  (server down, timeout, HTTP error, an undecodable frame) raise, and the session reports them.
- Checked tasks (`check_tasks`, D-020): next to each call, one yes/no question per expected next step asks
  whether that step's `completion_cue` is visible in the newest frame (at `check_max_side_px`). An expected
  step counts only when its result is seen; actions that aren't expected (mistakes) pass straight through.
  The checks run beside their call, so a checked call is 1 + N requests to vLLM (N = expected next steps,
  usually 1-2): `max_in_flight` bounds calls, not requests.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Protocol

from contracts import (
    Frame,
    InvalidVlmOutput,
    Observation,
    Ontology,
    Quality,
    Task,
    VlmOutput,
    parse_vlm_output,
)
from PIL import Image

from .prompt import CHECK_SCHEMA, NOTE_MAX_CHARS, build_messages, check_messages, task_json_schema

log = logging.getLogger(__name__)

MAX_TOKENS = 256  # enough for the JSON answer; a thinking model needs more (SUP_VLM_MAX_TOKENS)
JPEG_QUALITY = 85
CHECKED_CONFIDENCE = 0.9  # an expected step reported because its result was seen, not because of a motion


class ChatCompleter(Protocol):
    """Sends chat messages with a JSON schema for guided decoding; returns the raw answer text."""

    async def __call__(self, messages: list[dict], json_schema: dict) -> str: ...


class OpenAICompleter:
    """`ChatCompleter` over an OpenAI-compatible server (vLLM)."""

    def __init__(
        self, base_url: str, model: str, api_key: str | None, timeout_s: float, max_tokens: int = MAX_TOKENS
    ) -> None:
        from openai import AsyncOpenAI

        # vLLM without --api-key accepts any key; the SDK insists on one.
        self._client = AsyncOpenAI(
            base_url=base_url, api_key=api_key or "none", timeout=timeout_s, max_retries=0
        )
        self._model = model
        self._max_tokens = max_tokens

    async def __call__(self, messages: list[dict], json_schema: dict) -> str:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,  # type: ignore[arg-type]
            temperature=0,
            max_tokens=self._max_tokens,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "vlm_output", "schema": json_schema, "strict": True},
            },
        )
        return response.choices[0].message.content or ""


def pick_frames(frames: Sequence[Frame], span_ms: int, count: int = 2) -> list[Frame]:
    """`count` frames spread over the last `span_ms`, oldest first, newest last. Each pick is the earliest
    frame at or after its target time, so a short window or a slow camera gives fewer, distinct frames."""
    newest = frames[-1]
    if count <= 1:
        return [newest]
    picked: list[Frame] = []
    for k in range(count - 1, 0, -1):
        target = newest.t_ms - span_ms * k / (count - 1)
        frame = next(f for f in frames if f.t_ms >= target)
        if frame is not newest and (not picked or frame is not picked[-1]):
            picked.append(frame)
    return [*picked, newest]


def downscale_jpeg(jpeg: bytes, max_side_px: int) -> bytes:
    """Re-encode so the longest side is at most `max_side_px`; smaller frames pass through untouched.
    Raises for bytes that aren't an image (a broken client is a real failure)."""
    with Image.open(io.BytesIO(jpeg)) as img:
        if max(img.size) <= max_side_px:
            return jpeg
        img = img.convert("RGB")
        img.thumbnail((max_side_px, max_side_px))
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=JPEG_QUALITY)
        return out.getvalue()


def uncertain(reason: str) -> VlmOutput:
    return VlmOutput(action=None, confidence=0.0, quality=Quality.UNKNOWN, note=reason[:NOTE_MAX_CHARS])


def parse_check(raw: str) -> bool:
    """`{"visible": true|false}`, possibly in a code fence. Anything else raises `ValueError`."""
    text = raw.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError(f"not a JSON object: {raw[:80]!r}")
    value = data.get("visible")
    if not isinstance(value, bool):
        raise ValueError(f"not a yes/no answer: {raw[:80]!r}")
    return value


def combine(output: VlmOutput, task: Task, next_steps: Sequence[str], seen: dict[str, bool]) -> VlmOutput:
    """The main answer, checked against whether each expected step's result is visible (D-020).

    - An expected step's action (quality ok/unknown) stands only if its result is seen; otherwise the
      answer becomes uncertain, so the step isn't ticked on a motion that might not finish (holding a
      padlock next to the switch is not locking it).
    - Any other action (out of order, forbidden, a step done badly) passes unchanged: warnings must be fast.
    - No action, but an expected step's result is seen: report that step's action, so a step whose
      result just sits there (a padlock hanging) still gets ticked.
    """
    expected = {task.step(s).action: s for s in next_steps}
    if output.action is not None:
        step = expected.get(output.action)
        if step is None or output.quality is Quality.BAD:
            return output
        if seen.get(step):
            return output
        return uncertain(f"unchecked {step}: result not visible. {output.note or ''}")
    for step in next_steps:
        if seen.get(step):
            note = f"result of {step} visible: {task.step(step).completion_cue}"
            return VlmOutput(
                action=task.step(step).action,
                confidence=CHECKED_CONFIDENCE,
                quality=Quality.OK,
                note=note[:NOTE_MAX_CHARS],
            )
    return output


class VlmPerception:
    def __init__(
        self,
        completer: ChatCompleter,
        ontology: Ontology,
        model: str,
        min_interval_ms: int = 1500,
        max_side_px: int = 640,
        span_ms: int = 1000,
        frames_per_call: int = 2,
        clock: Callable[[], float] = time.monotonic,
        record_dir: Path | None = None,
        session: str | None = None,
        max_in_flight: int = 1,
        check_tasks: frozenset[str] = frozenset(),
        check_max_side_px: int = 1280,
    ) -> None:
        self._completer = completer
        self._ontology = ontology
        self.model = model
        self._min_interval_s = min_interval_ms / 1000
        self._max_side_px = max_side_px
        self._span_ms = span_ms
        self._count = frames_per_call
        self._clock = clock
        self._lock = asyncio.Lock()
        self._last_call_at: float | None = None
        self._schemas: dict[str, dict] = {}
        self._record_dir = record_dir
        self._record_lock = threading.Lock()  # pipelined calls record from several threads
        self._max_in_flight = max_in_flight
        self._pending: deque[asyncio.Task[Observation]] = deque()
        self._calls = 0
        self._check_tasks = check_tasks
        self._check_max_side_px = check_max_side_px
        # One VlmPerception per session: the id groups recorded calls (re-judging keeps the original id).
        self._session = session or uuid.uuid4().hex[:8]

    def _encode(self, frames: Sequence[Frame]) -> list[bytes]:
        return [downscale_jpeg(f.jpeg, self._max_side_px) for f in frames]

    def _record(self, record: dict, jpegs: list[bytes]) -> None:
        """Keep what the model saw and answered, to tune the prompt on real frames (SUP_VLM_RECORD_DIR).
        Only answered calls are recorded: a call that raises has no answer to label, and the session
        reports it as an error."""
        assert self._record_dir is not None
        self._record_dir.mkdir(parents=True, exist_ok=True)
        names = []
        for i, jpeg in enumerate(jpegs):
            name = f"{self._session}_{record['call']:05d}_{i}.jpg"  # unique across sessions
            (self._record_dir / name).write_bytes(jpeg)
            names.append(name)
        with self._record_lock, (self._record_dir / "calls.jsonl").open("a") as f:
            f.write(json.dumps({**record, "frames": names}) + "\n")

    async def observe(
        self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]
    ) -> Observation | None:
        if self._max_in_flight > 1:
            return await self._observe_pipelined(frames, task, next_steps)
        if not frames or self._lock.locked() or not self._due():
            return None
        async with self._lock:
            self._last_call_at = self._clock()
            return await self._judge(frames, task, next_steps)

    def _due(self) -> bool:
        return self._last_call_at is None or self._clock() - self._last_call_at >= self._min_interval_s

    async def _observe_pipelined(
        self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]
    ) -> Observation | None:
        if frames and len(self._pending) < self._max_in_flight and self._due():
            self._last_call_at = self._clock()
            self._pending.append(asyncio.create_task(self._judge(list(frames), task, list(next_steps))))
        if not self._pending:
            return None
        head = self._pending[0]
        if not head.done():
            # Wait for the oldest call, but only until the next call is due (until it finishes, at
            # capacity), so calls keep their cadence. An answer that finishes later is delivered by the
            # next `observe`, which the session makes on the next frame.
            full = len(self._pending) >= self._max_in_flight
            await asyncio.wait({head}, timeout=None if full else self._until_due())
        if head.done():
            self._pending.popleft()
            return head.result()  # re-raises a real failure of that call
        return None

    def _until_due(self) -> float:
        if self._last_call_at is None:
            return 0.0
        return max(0.0, self._min_interval_s - (self._clock() - self._last_call_at))

    async def _judge(self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]) -> Observation:
        self._calls += 1
        call = self._calls  # numbered at launch: pipelined calls can finish out of order
        picked = pick_frames(frames, self._span_ms, self._count)
        jpegs = await asyncio.to_thread(self._encode, picked)
        messages = build_messages(task, self._ontology, next_steps, jpegs)
        if task.id not in self._schemas:
            self._schemas[task.id] = task_json_schema(task)
        schema = self._schemas[task.id]
        checked = list(next_steps) if task.id in self._check_tasks else []
        t0 = time.perf_counter()
        if checked:
            newest = await asyncio.to_thread(downscale_jpeg, picked[-1].jpeg, self._check_max_side_px)
            raw, *answers = await asyncio.gather(
                self._completer(messages, schema),
                *(
                    self._completer(check_messages(task.step(s).completion_cue, newest), CHECK_SCHEMA)
                    for s in checked
                ),
            )
        else:
            raw, answers = await self._completer(messages, schema), []
        latency_ms = round((time.perf_counter() - t0) * 1000)
        try:
            output = parse_vlm_output(raw, task)
        except InvalidVlmOutput as error:
            log.warning("VLM answer rejected as uncertain (%s): %r", error, raw[:200])
            output = uncertain(f"invalid model output: {error}")
        seen: dict[str, bool] = {}
        for step, answer in zip(checked, answers, strict=True):
            try:
                seen[step] = parse_check(answer)
            except ValueError as error:  # json.JSONDecodeError is a ValueError
                log.warning("completion check for %s rejected as not seen (%s)", step, error)
                seen[step] = False
        if checked:
            output = combine(output, task, checked, seen)
        last = picked[-1]
        log.info(
            "VLM %s seq=%d %d ms: %s %.2f %s",
            task.id,
            last.seq,
            latency_ms,
            output.action,
            output.confidence,
            output.note,
        )
        if self._record_dir is not None:
            record = {
                "session": self._session,
                "call": call,
                "task": task.id,
                "next_steps": list(next_steps),
                "seqs": [f.seq for f in picked],
                "t_ms": [f.t_ms for f in picked],
                "latency_ms": latency_ms,
                "raw": raw,
                "seen": seen,
                "output": output.model_dump(mode="json"),
            }
            await asyncio.to_thread(self._record, record, jpegs)
        return Observation(
            seq=last.seq,
            t_ms=last.t_ms,
            source=last.source,
            model=self.model,
            latency_ms=latency_ms,
            output=output,
        )
