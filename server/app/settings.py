"""Runtime settings from environment variables (prefix SUP_)."""

from __future__ import annotations

import enum
import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class PerceptionMode(enum.StrEnum):
    SCRIPTED = "scripted"  # replays the task's correct run: no model needed


class VoiceMode(enum.StrEnum):
    BROWSER = "browser"  # no server TTS; the browser speaks the text


@dataclass(frozen=True)
class Settings:
    tasks_dir: Path
    perception: PerceptionMode
    scripted_every_ms: int
    scripted_mistake: str | None  # action id injected before the 2nd step of the scripted run
    voice: VoiceMode
    cors_origins: tuple[str, ...]

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            tasks_dir=Path(os.environ.get("SUP_TASKS_DIR", REPO_ROOT / "tasks")),
            perception=PerceptionMode(os.environ.get("SUP_PERCEPTION", "scripted")),
            scripted_every_ms=int(os.environ.get("SUP_SCRIPTED_EVERY_MS", "4000")),
            scripted_mistake=os.environ.get("SUP_SCRIPTED_MISTAKE") or None,
            voice=VoiceMode(os.environ.get("SUP_VOICE", "browser")),
            cors_origins=tuple(
                o for o in os.environ.get("SUP_CORS_ORIGINS", "http://localhost:5173").split(",") if o
            ),
        )
