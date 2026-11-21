"""The VLM prompt and its structured-output schema, built from the task (owner: Cote).

Kept apart from the client so the fine-tuning dataset (training/) can build exactly the same messages.
"""

from __future__ import annotations

import base64
import copy
from collections.abc import Sequence

from contracts import MistakeKind, Ontology, Task
from contracts.perception import vlm_output_json_schema

NOTE_MAX_CHARS = 160

SYSTEM = """You supervise a person doing a step-by-step task in front of a camera. You look at the \
newest camera frames and say which ONE action from the task's list is happening right now. Answer only \
with JSON.

Rules:
- "action": the id of the action you can actually SEE happening in the frames, or null when none of the \
listed actions is happening, the view is blocked, blurry, or you are unsure. Never guess: when in doubt, null.
- "quality": "ok" when the action is done correctly, "bad" when it is attempted but done wrongly (see the \
listed mistakes), "unknown" when "action" is null (always).
- "confidence": 0 to 1, how sure you are of "action".
- "objects": ids of the task's objects visible in the frames.
- "note": one short English sentence on what you see (for debugging)."""


def task_context(task: Task, ontology: Ontology, next_steps: Sequence[str]) -> str:
    """The task, in the words a camera can check: actions with their visual cues, objects, the expected
    next steps and the task's known mistakes."""
    actions = {a.id: a for a in ontology.actions}
    objects = {o.id: o for o in ontology.objects}
    lines = [f"Task: {task.description}", "", "Actions (id: what it looks like on camera):"]
    lines += [f"- {a}: {actions[a].visual_cue} ({actions[a].label_es})" for a in task.actions]
    lines += ["", "Objects (id: what it is):"]
    lines += [f"- {o}: {objects[o].description} ({objects[o].label_es})" for o in task.objects]
    if next_steps:
        lines += ["", "Expected next (the person should be doing one of these now):"]
        for step_id in next_steps:
            step = task.step(step_id)
            lines.append(f"- {step.action}: done when {step.completion_cue}")
    if task.mistakes:
        lines += ["", "Known mistakes:"]
        for m in task.mistakes:
            step = task.step(m.step)
            if m.kind is MistakeKind.WRONG_ACTION:
                lines.append(f"- action {m.action}: {m.visual_cue}")
            elif m.kind is MistakeKind.INCOMPLETE:
                lines.append(f'- {step.action} with quality "bad": {m.visual_cue}')
            else:
                lines.append(f"- {m.visual_cue} (report the action you see; the order is checked elsewhere)")
    return "\n".join(lines)


def build_messages(
    task: Task, ontology: Ontology, next_steps: Sequence[str], jpegs: Sequence[bytes]
) -> list[dict]:
    """Chat messages for an OpenAI-compatible server: system rules, then the frames (oldest first)
    and the task context."""
    images = [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(j).decode()}}
        for j in jpegs
    ]
    which = "the newest camera frame" if len(jpegs) == 1 else f"{len(jpegs)} camera frames, oldest first"
    text = f"Above: {which}.\n\n{task_context(task, ontology, next_steps)}\n\nAnswer only the JSON."
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": [*images, {"type": "text", "text": text}]},
    ]


def task_json_schema(task: Task) -> dict:
    """`vlm_output_json_schema()` narrowed to the task: guided decoding can only emit the task's actions
    and objects, and a short note. Answers are still validated with `parse_vlm_output`."""
    schema = copy.deepcopy(vlm_output_json_schema())
    props = schema["properties"]
    props["action"] = {"anyOf": [{"type": "string", "enum": list(task.actions)}, {"type": "null"}]}
    props["objects"] = {"type": "array", "items": {"type": "string", "enum": list(task.objects)}}
    props["note"] = {"type": "string", "maxLength": NOTE_MAX_CHARS}
    schema["required"] = ["action", "confidence", "quality", "objects", "note"]
    return schema
