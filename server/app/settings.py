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


class ControllerMode(enum.StrEnum):
    RULES = "rules"  # automaton tracker (baseline)
    LEARNED = "learned"  # tiny GRU trained on simulator runs (training/controller), numpy inference


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
    controller: ControllerMode = ControllerMode.RULES
    controller_weights_dir: Path = REPO_ROOT / "training" / "controller" / "weights"
    vlm_base_url: str | None = None  # OpenAI-compatible base URL, e.g. https://<tunnel>/v1
    vlm_model: str = "qwen3-vl-8b-fp8"  # served model name in vLLM; also recorded in every Observation
    vlm_api_key: str | None = None  # vLLM --api-key; never commit it (gpu/README.md)
    controller_confirm: int = 2  # rules: act on an action once 2 of the last 3 answers agree (D-019)
    vlm_max_in_flight: int = 3  # pipelined calls per session; vLLM batches them (D-018)
    vlm_min_interval_ms: int = 250  # minimum time between two VLM calls, so we don't hammer the GPU
    vlm_timeout_s: float = 10.0  # a slower answer is a real failure (raises)
    vlm_max_side_px: int = 640  # frames are downscaled so their longest side is at most this
    vlm_record_dir: Path | None = None  # if set, every VLM call's frames + answer are saved here
    vlm_span_ms: int = 1100  # the frames shown to the model cover about this much time
    vlm_max_tokens: int = 256  # answer budget; a thinking model needs ~2000
    vlm_frames: int = 3  # frames per call, spread over vlm_span_ms (vLLM's --limit-mm-per-prompt caps it)

    def __post_init__(self) -> None:
        if (
            self.vlm_frames < 1
            or self.vlm_max_in_flight < 1
            or self.vlm_min_interval_ms < 0
            or self.vlm_span_ms < 0
        ):
            raise ValueError(
                "SUP_VLM_FRAMES and SUP_VLM_MAX_IN_FLIGHT must be ≥ 1, "
                "SUP_VLM_MIN_INTERVAL_MS and SUP_VLM_SPAN_MS ≥ 0"
            )
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
            controller_confirm=int(os.environ.get("SUP_CONTROLLER_CONFIRM", cls.controller_confirm)),
            vlm_max_in_flight=int(os.environ.get("SUP_VLM_MAX_IN_FLIGHT", cls.vlm_max_in_flight)),
            vlm_min_interval_ms=int(os.environ.get("SUP_VLM_MIN_INTERVAL_MS", cls.vlm_min_interval_ms)),
            vlm_timeout_s=float(os.environ.get("SUP_VLM_TIMEOUT_S", cls.vlm_timeout_s)),
            vlm_max_side_px=int(os.environ.get("SUP_VLM_MAX_SIDE_PX", cls.vlm_max_side_px)),
            vlm_record_dir=Path(d) if (d := os.environ.get("SUP_VLM_RECORD_DIR")) else None,
            vlm_span_ms=int(os.environ.get("SUP_VLM_SPAN_MS", cls.vlm_span_ms)),
            vlm_max_tokens=int(os.environ.get("SUP_VLM_MAX_TOKENS", cls.vlm_max_tokens)),
            vlm_frames=int(os.environ.get("SUP_VLM_FRAMES", cls.vlm_frames)),
            voice=VoiceMode(os.environ.get("SUP_VOICE", "browser")),
            elevenlabs_api_key=os.environ.get("ELEVENLABS_API_KEY", ""),
            elevenlabs_voice_id=os.environ.get("SUP_ELEVENLABS_VOICE_ID", ""),
            voice_min_gap_ms=int(os.environ.get("SUP_VOICE_MIN_GAP_MS", "4000")),
            controller=ControllerMode(os.environ.get("SUP_CONTROLLER", "rules")),
            controller_weights_dir=Path(
                os.environ.get("SUP_CONTROLLER_WEIGHTS", REPO_ROOT / "training" / "controller" / "weights")
            ),
            cors_origins=tuple(
                o for o in os.environ.get("SUP_CORS_ORIGINS", "http://localhost:5173").split(",") if o
            ),
        )
