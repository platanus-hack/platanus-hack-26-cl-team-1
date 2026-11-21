"""Contract 1: the action ontology, the global vocabulary a task picks its actions from."""

from __future__ import annotations

from collections import Counter

from pydantic import model_validator

from .common import ActionId, Id, NonEmptyText, ObjectId, Strict


class ObjectDef(Strict):
    id: ObjectId
    label_es: NonEmptyText
    description: NonEmptyText  # English, used in prompts


class ActionDef(Strict):
    """One atomic, visible action: `verb(object, target)`.

    `visual_cue` says what the action looks like on camera. It feeds the perception prompt and the
    video-generation prompt, so it must describe something a camera can see.
    """

    id: ActionId
    verb: Id
    object: ObjectId | None = None
    target: ObjectId | None = None
    label_es: NonEmptyText
    visual_cue: NonEmptyText


class Ontology(Strict):
    domain: Id
    version: int
    objects: tuple[ObjectDef, ...]
    actions: tuple[ActionDef, ...]

    @model_validator(mode="after")
    def _check(self) -> Ontology:
        _require_unique("object", [o.id for o in self.objects])
        _require_unique("action", [a.id for a in self.actions])
        known = {o.id for o in self.objects}
        for action in self.actions:
            for ref in (action.object, action.target):
                if ref is not None and ref not in known:
                    raise ValueError(f"action {action.id!r} references unknown object {ref!r}")
        return self

    def action(self, action_id: str) -> ActionDef:
        for action in self.actions:
            if action.id == action_id:
                return action
        raise KeyError(action_id)


def _require_unique(kind: str, ids: list[str]) -> None:
    duplicates = sorted(i for i, n in Counter(ids).items() if n > 1)
    if duplicates:
        raise ValueError(f"duplicate {kind} ids: {duplicates}")
