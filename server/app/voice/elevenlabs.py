"""ElevenLabs text-to-speech (owner: Alonso). Flash v2.5: ~75 ms model time, Spanish supported.

A failed call returns `None` with an error in the log: the `Voice` contract says the browser then speaks
the text itself, so the user still hears the line and the failure is visible in the server log.
"""

from __future__ import annotations

import logging
import re

import httpx
from contracts import SayRequest

log = logging.getLogger(__name__)

API_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
MODEL = "eleven_flash_v2_5"
OUTPUT_FORMAT = "mp3_44100_128"  # what the browser plays; the protocol's audio frames are audio/mpeg
MP3_BYTES_PER_S = 128_000 // 8

# Symbols a TTS model reads badly: say them in words (D-004: everything spoken is Spanish).
_SPOKEN = [
    (re.compile(r"\bGND\b"), "tierra"),
    (re.compile(r"(\d+(?:[.,]\d+)?)\s*V\b"), r"\1 voltios"),
    (re.compile(r"→"), " a "),
]


def normalize(text: str) -> str:
    for pattern, replacement in _SPOKEN:
        text = pattern.sub(replacement, text)
    return re.sub(r"\s+", " ", text).strip()


class ElevenLabsVoice:
    def __init__(
        self,
        api_key: str,
        voice_id: str,
        *,
        model: str = MODEL,
        timeout_s: float = 10.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("SUP_VOICE=elevenlabs needs ELEVENLABS_API_KEY")
        if not voice_id:
            raise ValueError("SUP_VOICE=elevenlabs needs SUP_ELEVENLABS_VOICE_ID")
        self.voice_id, self.model = voice_id, model
        self._client = httpx.AsyncClient(
            headers={"xi-api-key": api_key}, timeout=timeout_s, transport=transport
        )

    async def synthesize(self, request: SayRequest) -> bytes | None:
        try:
            response = await self._client.post(
                API_URL.format(voice_id=self.voice_id),
                params={"output_format": OUTPUT_FORMAT},
                json={"text": normalize(request.text), "model_id": self.model, "language_code": "es"},
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            log.error("elevenlabs %s: %s", error.response.status_code, error.response.text[:300])
            return None
        except httpx.HTTPError as error:
            log.error("elevenlabs request failed: %r", error)
            return None
        if not response.content:
            log.error("elevenlabs returned no audio for %r", request.text)
            return None
        return response.content

    async def aclose(self) -> None:
        await self._client.aclose()
