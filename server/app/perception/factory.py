"""Builds the Perception for a session (owner: Cote). Only the scripted fake exists so far;
the VLM client (Qwen3-VL on vLLM) plugs in here as a new PerceptionMode."""

from __future__ import annotations

from contracts import Perception, Task
from contracts.fakes import ScriptedPerception

from ..settings import PerceptionMode, Settings


def make_perception(settings: Settings, task: Task) -> Perception:
    if settings.perception is PerceptionMode.SCRIPTED:
        if settings.scripted_mistake is not None and settings.scripted_mistake not in task.actions:
            raise ValueError(
                f"SUP_SCRIPTED_MISTAKE={settings.scripted_mistake!r} is not an action of task {task.id!r}"
            )
        return ScriptedPerception.correct_run(
            task, every_ms=settings.scripted_every_ms, mistake=settings.scripted_mistake
        )
    raise ValueError(f"unsupported perception mode {settings.perception!r}")
