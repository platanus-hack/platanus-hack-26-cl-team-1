"""Runtime settings from environment variables (prefix SUP_)."""

from __future__ import annotations

import enum
import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


class PerceptionMode(enum.StrEnum):
    SCRIPTED = "scripted"  # replays the task's correct run: no model needed
    VLM = "vlm"  # Qwen3-VL on vLLM (OpenAI-compatible API), see gpu/README.md


class VoiceMode(enum.StrEnum):
    BROWSER = "browser"  # no server TTS; the browser speaks the text
    ELEVENLABS = "elevenlabs"  # server TTS; needs ELEVENLABS_API_KEY and SUP_ELEVENLABS_VOICE_ID


@dataclass(frozen=True)
class Settings:
    tasks_dir: Path
    perception: PerceptionMode
    scripted_every_ms: int
    scripted_mistake: str | None  # action id injected before the 2nd step of the scripted run
    voice: VoiceMode
    cors_origins: tuple[str, ...]
    elevenlabs_api_key: str = field(default="", repr=False)  # secret: environment only, never logged
    elevenlabs_voice_id: str = ""
    voice_min_gap_ms: int = 4000  # anti-spam: at least this long between the starts of two normal lines
    vlm_base_url: str | None = None  # OpenAI-compatible base URL, e.g. https://<tunnel>/v1
    vlm_model: str = "qwen3-vl-8b-fp8"  # served model name in vLLM; also recorded in every Observation
    vlm_api_key: str | None = None  # vLLM --api-key; never commit it (gpu/README.md)
    vlm_min_interval_ms: int = 1500  # minimum time between two VLM calls, so we don't hammer the GPU
    vlm_timeout_s: float = 10.0  # a slower answer is a real failure (raises)
    vlm_max_side_px: int = 640  # frames are downscaled so their longest side is at most this
    vlm_span_ms: int = 1000  # the prompt shows the newest frame plus one about this much older

    def __post_init__(self) -> None:
        if self.perception is PerceptionMode.VLM and not self.vlm_base_url:
            raise ValueError("SUP_PERCEPTION=vlm needs SUP_VLM_BASE_URL (e.g. https://<tunnel>/v1)")

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            tasks_dir=Path(os.environ.get("SUP_TASKS_DIR", REPO_ROOT / "tasks")),
            perception=PerceptionMode(os.environ.get("SUP_PERCEPTION", "scripted")),
            scripted_every_ms=int(os.environ.get("SUP_SCRIPTED_EVERY_MS", "4000")),
            scripted_mistake=os.environ.get("SUP_SCRIPTED_MISTAKE") or None,
            vlm_base_url=os.environ.get("SUP_VLM_BASE_URL") or None,
            vlm_model=os.environ.get("SUP_VLM_MODEL", cls.vlm_model),
            vlm_api_key=os.environ.get("SUP_VLM_API_KEY") or None,
            vlm_min_interval_ms=int(os.environ.get("SUP_VLM_MIN_INTERVAL_MS", cls.vlm_min_interval_ms)),
            vlm_timeout_s=float(os.environ.get("SUP_VLM_TIMEOUT_S", cls.vlm_timeout_s)),
            vlm_max_side_px=int(os.environ.get("SUP_VLM_MAX_SIDE_PX", cls.vlm_max_side_px)),
            vlm_span_ms=int(os.environ.get("SUP_VLM_SPAN_MS", cls.vlm_span_ms)),
            voice=VoiceMode(os.environ.get("SUP_VOICE", "browser")),
            elevenlabs_api_key=os.environ.get("ELEVENLABS_API_KEY", ""),
            elevenlabs_voice_id=os.environ.get("SUP_ELEVENLABS_VOICE_ID", ""),
            voice_min_gap_ms=int(os.environ.get("SUP_VOICE_MIN_GAP_MS", "4000")),
            cors_origins=tuple(
                o for o in os.environ.get("SUP_CORS_ORIGINS", "http://localhost:5173").split(",") if o
            ),
        )
