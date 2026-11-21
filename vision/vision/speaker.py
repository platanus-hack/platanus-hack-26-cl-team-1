"""Anti-spam voice queue (plan §3).

- At most one clip every `min_gap` seconds (4 s), and never before the previous clip ended.
- Errors jump ahead of pending info lines.
- The same text is not repeated within `repeat_window` seconds (15 s).
- `cancel(key)` drops a pending clip (e.g. the user fixed the error) and tells the client
  to drop it too if it was already sent.
- Muted: the text is still sent (subtitles) but no audio is synthesised.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

from .protocol import encode_audio

log = logging.getLogger(__name__)

Priority = Literal["error", "info"]
SendJson = Callable[[dict], Awaitable[None]]
SendBytes = Callable[[bytes], Awaitable[None]]


@dataclass
class _Item:
    id: str
    text: str
    priority: Priority
    key: str | None
    created: float = field(default=0.0)


class Speaker:
    def __init__(
        self,
        send_json: SendJson,
        send_bytes: SendBytes,
        synth: Callable[[str], bytes] | None,
        *,
        min_gap: float = 4.0,
        repeat_window: float = 15.0,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._send_json = send_json
        self._send_bytes = send_bytes
        self._synth = synth
        self.min_gap = min_gap
        self.repeat_window = repeat_window
        self._clock = clock
        self._sleep = sleep
        self._pending: list[_Item] = []
        self._recent: dict[str, float] = {}
        self._sent_keys: dict[str, str] = {}  # key → clip id already sent
        self._next_ok = 0.0
        self._wake = asyncio.Event()
        self._ids = itertools.count(1)
        self.muted = False
        self.spoken: list[str] = []  # history (tests, recorder)

    @property
    def pending(self) -> list[str]:
        return [i.text for i in self._pending]

    def say(self, text: str, priority: Priority = "info", key: str | None = None) -> str | None:
        """Queue a line. Returns its clip id, or None if dropped as spam."""
        text = text.strip()
        if not text:
            return None
        now = self._clock()
        last = self._recent.get(text)
        if last is not None and now - last < self.repeat_window:
            return None
        if any(i.text == text for i in self._pending):
            return None
        if key is not None:  # a newer line for the same key replaces the pending one
            self._pending = [i for i in self._pending if i.key != key]
        item = _Item(f"c{next(self._ids)}", text, priority, key, now)
        if priority == "error":
            idx = next((n for n, i in enumerate(self._pending) if i.priority != "error"), len(self._pending))
            self._pending.insert(idx, item)
        else:
            self._pending.append(item)
        self._wake.set()
        return item.id

    async def cancel(self, key: str) -> None:
        self._pending = [i for i in self._pending if i.key != key]
        clip = self._sent_keys.pop(key, None)
        if clip:
            await self._send_json({"type": "cancel_say", "id": clip})

    def clear(self) -> None:
        self._pending.clear()

    async def run(self) -> None:
        while True:
            if not self._pending:
                self._wake.clear()
                await self._wake.wait()
                continue
            wait = self._next_ok - self._clock()
            if wait > 0:
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=wait)
                except TimeoutError:
                    pass
                continue  # re-evaluate: an error may have jumped the queue meanwhile
            item = self._pending.pop(0)
            await self._emit(item)

    async def flush_once(self) -> bool:
        """Emit the next clip if allowed now (tests drive the queue with this)."""
        if not self._pending or self._next_ok > self._clock():
            return False
        await self._emit(self._pending.pop(0))
        return True

    async def _emit(self, item: _Item) -> None:
        now = self._clock()
        self._recent[item.text] = now
        self._recent = {t: ts for t, ts in self._recent.items() if now - ts < self.repeat_window}
        if item.key:
            self._sent_keys[item.key] = item.id
        wav: bytes | None = None
        if self._synth is not None and not self.muted:
            try:
                wav = await asyncio.to_thread(self._synth, item.text)
            except Exception:  # noqa: BLE001 — a TTS failure must not kill the session
                log.exception("tts failed")
        duration = (len(wav) - 44) / 48_000 if wav else 0.065 * len(item.text)
        self._next_ok = now + max(self.min_gap, duration + 0.6)
        self.spoken.append(item.text)
        await self._send_json(
            {"type": "say", "id": item.id, "text": item.text, "priority": item.priority, "audio": wav is not None}
        )
        if wav is not None:
            await self._send_bytes(encode_audio(item.id, wav))
