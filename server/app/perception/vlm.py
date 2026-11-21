"""`VlmPerception`: Qwen3-VL served by vLLM (OpenAI-compatible API) behind the `Perception` interface.

- One call in flight, and at least `min_interval_ms` between calls: anything in between returns `None`.
  Both hold per instance, i.e. per session: N open sessions can have N calls in flight on the GPU (vLLM
  batches up to `--max-num-seqs 4`). The demo runs one session.
- The model sees the newest frame plus one about `span_ms` older (downscaled JPEG), and the task's actions,
  objects, next steps and mistakes. Guided decoding forces the task-narrowed `VlmOutput` schema.
- A bad answer (invalid JSON, an action outside the task, `null` action with quality `ok`…) becomes an
  uncertain observation (`action=None`, `quality=unknown`) so the supervisor stays silent. Real failures
  (server down, timeout, HTTP error, an undecodable frame) raise, and the session reports them.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import time
import uuid
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

from .prompt import NOTE_MAX_CHARS, build_messages, task_json_schema

log = logging.getLogger(__name__)

MAX_TOKENS = 200
JPEG_QUALITY = 85


class ChatCompleter(Protocol):
    """Sends chat messages with a JSON schema for guided decoding; returns the raw answer text."""

    async def __call__(self, messages: list[dict], json_schema: dict) -> str: ...


class OpenAICompleter:
    """`ChatCompleter` over an OpenAI-compatible server (vLLM)."""

    def __init__(self, base_url: str, model: str, api_key: str | None, timeout_s: float) -> None:
        from openai import AsyncOpenAI

        # vLLM without --api-key accepts any key; the SDK insists on one.
        self._client = AsyncOpenAI(
            base_url=base_url, api_key=api_key or "none", timeout=timeout_s, max_retries=0
        )
        self._model = model

    async def __call__(self, messages: list[dict], json_schema: dict) -> str:
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=messages,  # type: ignore[arg-type]
            temperature=0,
            max_tokens=MAX_TOKENS,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": "vlm_output", "schema": json_schema, "strict": True},
            },
        )
        return response.choices[0].message.content or ""


def pick_frames(frames: Sequence[Frame], span_ms: int) -> list[Frame]:
    """The newest frame plus the oldest one at most `span_ms` before it (if it's a different frame)."""
    newest = frames[-1]
    older = next(f for f in frames if newest.t_ms - f.t_ms <= span_ms)
    return [newest] if older is newest else [older, newest]


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


class VlmPerception:
    def __init__(
        self,
        completer: ChatCompleter,
        ontology: Ontology,
        model: str,
        min_interval_ms: int = 1500,
        max_side_px: int = 640,
        span_ms: int = 1000,
        clock: Callable[[], float] = time.monotonic,
        record_dir: Path | None = None,
    ) -> None:
        self._completer = completer
        self._ontology = ontology
        self.model = model
        self._min_interval_s = min_interval_ms / 1000
        self._max_side_px = max_side_px
        self._span_ms = span_ms
        self._clock = clock
        self._lock = asyncio.Lock()
        self._last_call_at: float | None = None
        self._schemas: dict[str, dict] = {}
        self._record_dir = record_dir
        self._calls = 0
        self._session = uuid.uuid4().hex[:8]  # one VlmPerception per session: groups recorded calls

    def _encode(self, frames: Sequence[Frame]) -> list[bytes]:
        return [downscale_jpeg(f.jpeg, self._max_side_px) for f in frames]

    def _record(self, record: dict, jpegs: list[bytes]) -> None:
        """Keep what the model saw and answered, to tune the prompt on real frames (SUP_VLM_RECORD_DIR)."""
        assert self._record_dir is not None
        self._record_dir.mkdir(parents=True, exist_ok=True)
        names = []
        for i, jpeg in enumerate(jpegs):
            name = f"{self._session}_{record['call']:05d}_{i}.jpg"  # unique across sessions
            (self._record_dir / name).write_bytes(jpeg)
            names.append(name)
        with (self._record_dir / "calls.jsonl").open("a") as f:
            f.write(json.dumps({**record, "frames": names}) + "\n")

    async def observe(
        self, frames: Sequence[Frame], task: Task, next_steps: Sequence[str]
    ) -> Observation | None:
        if not frames or self._lock.locked():
            return None
        now = self._clock()
        if self._last_call_at is not None and now - self._last_call_at < self._min_interval_s:
            return None
        async with self._lock:
            self._last_call_at = now
            picked = pick_frames(frames, self._span_ms)
            jpegs = await asyncio.to_thread(self._encode, picked)
            messages = build_messages(task, self._ontology, next_steps, jpegs)
            if task.id not in self._schemas:
                self._schemas[task.id] = task_json_schema(task)
            schema = self._schemas[task.id]
            t0 = time.perf_counter()
            raw = await self._completer(messages, schema)
            latency_ms = round((time.perf_counter() - t0) * 1000)
            try:
                output = parse_vlm_output(raw, task)
            except InvalidVlmOutput as error:
                log.warning("VLM answer rejected as uncertain (%s): %r", error, raw[:200])
                output = uncertain(f"invalid model output: {error}")
            last = picked[-1]
            self._calls += 1
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
                    "call": self._calls,
                    "task": task.id,
                    "next_steps": list(next_steps),
                    "seqs": [f.seq for f in picked],
                    "t_ms": [f.t_ms for f in picked],
                    "latency_ms": latency_ms,
                    "raw": raw,
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
