"""Anti-spam for the supervisor's voice (owner: Alonso). Port of the old `speaker.py`, on the client clock.

Rules, in order:
- The same line is not repeated within `repeat_window_ms` (15 s).
- Urgent lines (mistakes) are spoken at once, even over a line that is still playing.
- A normal line waits until the previous line has ended and `min_gap_ms` (4 s) has passed since it
  started. Only the newest line counts: a line that is spoken (normal or urgent) drops any older
  waiting line, and a newer waiting line replaces an older one.
- When a mistake is fixed, the open mistake line is cancelled if it may still be playing.

The queue decides; the session synthesizes and sends. It runs on the frames' `t_ms` (the browser's
`performance.now()`, wall time since the page loaded), so tests are deterministic; it does not pause
when a clip is paused, but it does stop advancing when frames stop arriving.
"""

from __future__ import annotations

from dataclasses import dataclass

from contracts import Priority, SayRequest

from .elevenlabs import MP3_BYTES_PER_S

MS_PER_CHAR = 65  # speaking-time estimate when there is no audio (browser speech)
TAIL_MS = 600  # pause after a line ends


@dataclass
class Spoken:
    id: str
    request: SayRequest
    start_ms: int
    end_ms: int


class VoiceQueue:
    def __init__(self, min_gap_ms: int = 4000, repeat_window_ms: int = 15_000) -> None:
        self.min_gap_ms = min_gap_ms
        self.repeat_window_ms = repeat_window_ms
        self.reset()

    def reset(self) -> None:
        self.pending: SayRequest | None = None
        self.last: Spoken | None = None
        self.open_mistake: Spoken | None = None
        self._recent: dict[str, int] = {}  # text → start time

    def offer(self, request: SayRequest, now_ms: int) -> SayRequest | None:
        """Return the request if it should be spoken now; otherwise keep or drop it."""
        if self._repeated(request.text, now_ms):
            return None
        if request.priority is Priority.URGENT or self._free(now_ms):
            self.pending = None  # older than this line: it would be stale after it
            return request
        self.pending = request
        return None

    def due(self, now_ms: int) -> SayRequest | None:
        """The waiting line, once it may be spoken (call about once a second)."""
        if self.pending is None or not self._free(now_ms):
            return None
        request, self.pending = self.pending, None
        return None if self._repeated(request.text, now_ms) else request

    def spoken(self, say_id: str, request: SayRequest, now_ms: int, audio: bytes | None) -> None:
        duration = len(audio) * 1000 // MP3_BYTES_PER_S if audio else MS_PER_CHAR * len(request.text)
        line = Spoken(say_id, request, now_ms, now_ms + duration)
        self.last = line
        if request.priority is Priority.URGENT:
            self.open_mistake = line
        self._recent = {t: s for t, s in self._recent.items() if now_ms - s < self.repeat_window_ms}
        self._recent[request.text] = now_ms

    def mistake_fixed(self, now_ms: int) -> str | None:
        """Forget the open mistake line; return its id if it may still be playing (to cancel it)."""
        line, self.open_mistake = self.open_mistake, None
        return line.id if line is not None and now_ms < line.end_ms else None

    def _free(self, now_ms: int) -> bool:
        if self.last is None:
            return True
        return now_ms >= max(self.last.start_ms + self.min_gap_ms, self.last.end_ms + TAIL_MS)

    def _repeated(self, text: str, now_ms: int) -> bool:
        start = self._recent.get(text)
        return start is not None and now_ms - start < self.repeat_window_ms
