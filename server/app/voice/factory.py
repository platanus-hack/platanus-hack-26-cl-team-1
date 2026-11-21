"""Builds the Voice (owner: Alonso): the browser fallback or ElevenLabs. A misconfigured voice stops the
server at startup."""

from __future__ import annotations

from contracts import Voice
from contracts.fakes import SilentVoice

from ..settings import Settings, VoiceMode
from .elevenlabs import ElevenLabsVoice


def make_voice(settings: Settings) -> Voice:
    if settings.voice is VoiceMode.BROWSER:
        return SilentVoice()
    if settings.voice is VoiceMode.ELEVENLABS:
        return ElevenLabsVoice(settings.elevenlabs_api_key, settings.elevenlabs_voice_id)
    raise ValueError(f"unsupported voice mode {settings.voice!r}")
