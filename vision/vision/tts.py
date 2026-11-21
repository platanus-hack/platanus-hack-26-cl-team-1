"""Spanish text-to-speech with Kokoro-82M (GPU server only).

Text is normalised for speech first (hole ids, units, symbols) so the voice
says "e diez" instead of spelling "e10".
"""

from __future__ import annotations

import io
import re
import wave

import numpy as np

SAMPLE_RATE = 24_000
VOICES = ("ef_dora", "em_alex", "em_santa")

_UNITS = [
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*kΩ"), r"\1 kiloohmios"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*Ω"), r"\1 ohmios"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*mA\b"), r"\1 miliamperios"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*V\b"), r"\1 voltios"),
]
_RAIL = re.compile(r"\b([TB])([+\-−])(\d{1,2})\b")
_HOLE = re.compile(r"\b([a-j])(\d{1,2})\b")
_PIN = re.compile(r"\b([DA])(\d{1,2})\b")


def normalize(text: str) -> str:
    t = text.replace("→", " a ").replace("−", "-")
    for rx, rep in _UNITS:
        t = rx.sub(rep, t)
    t = _RAIL.sub(lambda m: f"riel {'positivo' if m.group(2) == '+' else 'negativo'} {m.group(3)}", t)
    t = _HOLE.sub(lambda m: f"{m.group(1)} {m.group(2)}", t)
    t = _PIN.sub(lambda m: f"{'pin' if m.group(1) == 'D' else 'pin A'} {m.group(2)}", t)
    t = t.replace("GND", "tierra").replace("5V", "cinco voltios")
    return re.sub(r"\s+", " ", t).strip()


def to_wav(audio: np.ndarray, rate: int = SAMPLE_RATE) -> bytes:
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


class Tts:
    """Kokoro pipeline kept warm on the GPU (~0.4 GB)."""

    def __init__(self, voice: str = "ef_dora", speed: float = 1.05, device: str | None = None) -> None:
        from kokoro import KPipeline  # heavy import, GPU extra only

        self.voice = voice
        self.speed = speed
        self.pipe = KPipeline(lang_code="e", repo_id="hexgrad/Kokoro-82M", device=device)
        self.synth("Listo.")  # warm-up

    def synth(self, text: str) -> np.ndarray:
        chunks = [
            a.cpu().numpy() if hasattr(a, "cpu") else np.asarray(a)
            for _, _, a in self.pipe(normalize(text), voice=self.voice, speed=self.speed)
        ]
        return np.concatenate(chunks) if chunks else np.zeros(1, dtype=np.float32)

    def wav(self, text: str) -> bytes:
        return to_wav(self.synth(text))
