"""Builds the Controller for each session from SUP_CONTROLLER (owner: Cote)."""

from __future__ import annotations

from collections.abc import Callable
from functools import partial

from contracts import Controller

from ..library.store import TaskLibrary
from ..settings import ControllerMode, PerceptionMode, Settings
from .learned import LearnedController, LearnedWeights
from .rules import RulesController


def make_controller_factory(settings: Settings, library: TaskLibrary) -> Callable[[], Controller]:
    if settings.controller is ControllerMode.RULES:
        # Agreement guards against a model's flickering answers; the scripted fake reports each action once.
        confirm = settings.controller_confirm if settings.perception is PerceptionMode.VLM else 1
        return partial(RulesController, confirm=confirm)
    if settings.controller is ControllerMode.LEARNED:
        # Fail at startup, not mid-session: every task in the library needs matching weights.
        for summary in library.summaries():
            path = settings.controller_weights_dir / f"{summary.id}.npz"
            if not path.exists():
                raise FileNotFoundError(
                    f"SUP_CONTROLLER=learned but task {summary.id!r} has no weights at {path}: "
                    f"train them (training/controller/README.md) or use SUP_CONTROLLER=rules"
                )
            LearnedWeights(path).check(library.get(summary.id))
        return partial(LearnedController, settings.controller_weights_dir)
    raise ValueError(f"unsupported controller mode {settings.controller!r}")
