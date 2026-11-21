"""Builds the Perception for a session (owner: Cote): the scripted fake, or the VLM (Qwen3-VL on vLLM)."""

from __future__ import annotations

from functools import cache
from pathlib import Path

from contracts import Ontology, Perception, Task
from contracts.fakes import ScriptedPerception

from ..settings import PerceptionMode, Settings
from .vlm import OpenAICompleter, VlmPerception


@cache
def _ontology(path: Path) -> Ontology:
    # The library already validated every task against this file at startup.
    return Ontology.model_validate_json(path.read_text())


@cache
def _completer(base_url: str, model: str, api_key: str | None, timeout_s: float) -> OpenAICompleter:
    return OpenAICompleter(base_url, model, api_key, timeout_s)  # one HTTP connection pool for all sessions


def make_perception(settings: Settings, task: Task) -> Perception:
    if settings.perception is PerceptionMode.SCRIPTED:
        if settings.scripted_mistake is not None and settings.scripted_mistake not in task.actions:
            raise ValueError(
                f"SUP_SCRIPTED_MISTAKE={settings.scripted_mistake!r} is not an action of task {task.id!r}"
            )
        return ScriptedPerception.correct_run(
            task, every_ms=settings.scripted_every_ms, mistake=settings.scripted_mistake
        )
    if settings.perception is PerceptionMode.VLM:
        assert settings.vlm_base_url  # checked by Settings
        completer = _completer(
            settings.vlm_base_url, settings.vlm_model, settings.vlm_api_key, settings.vlm_timeout_s
        )
        return VlmPerception(
            completer,
            _ontology(settings.tasks_dir / task.domain / "ontology.json"),
            model=settings.vlm_model,
            min_interval_ms=settings.vlm_min_interval_ms,
            max_side_px=settings.vlm_max_side_px,
            span_ms=settings.vlm_span_ms,
        )
    raise ValueError(f"unsupported perception mode {settings.perception!r}")
