"""Builds the Voice (owner: Alonso). Only the browser fallback exists so far; ElevenLabs plugs in
here as a new VoiceMode."""

from __future__ import annotations

from contracts import Voice
from contracts.fakes import SilentVoice

from ..settings import Settings, VoiceMode


def make_voice(settings: Settings) -> Voice:
    if settings.voice is VoiceMode.BROWSER:
        return SilentVoice()
    raise ValueError(f"unsupported voice mode {settings.voice!r}")
