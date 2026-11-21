"""The VLM prompt and its structured-output schema, built from the task (owner: Cote).

Kept apart from the client so the fine-tuning dataset (training/) can build exactly the same messages.
"""

from __future__ import annotations

import base64
import copy
from collections.abc import Sequence

from contracts import MistakeKind, Ontology, Task
from contracts.perception import vlm_output_json_schema

NOTE_MAX_CHARS = 300

SYSTEM = """You supervise a person doing a step-by-step task in front of a camera. You see the latest \
camera frames, oldest first and newest last, and say which ONE action from the task's list is happening. \
Answer only with JSON.

How to decide:
1. "note" first: describe concretely what the hands do in the frames: what each hand touches and with \
which side (palm, back, fingers), what it holds, whether water runs, and what changes between frames.
2. Then compare that with each action's description and pick the one that matches. Similar actions differ \
in those details (which part of the hand touches what, what the hand holds): check them, don't pick the \
first plausible one.
3. Brief actions (a second or two) may show in only one frame, often an older one: if any frame clearly \
shows an action, report it.

Fields:
- "action": the id of the action you can SEE in the frames, or null when none of the listed actions is \
happening, the view is blocked or blurry, or you are unsure. Never guess: when in doubt, null.
- "quality": "ok" when the action is done correctly, "bad" when it is attempted but done wrongly (see the \
listed mistakes), "unknown" when "action" is null (always).
- "confidence": 0 to 1, how sure you are of "action".
- "objects": ids of the task's objects visible in the frames."""


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


def user_text(task: Task, ontology: Ontology, next_steps: Sequence[str], n_frames: int) -> str:
    """The text after the images in the user turn (shared with the fine-tuning dataset)."""
    which = "the newest camera frame" if n_frames == 1 else f"{n_frames} camera frames, oldest first"
    return f"Above: {which}.\n\n{task_context(task, ontology, next_steps)}\n\nAnswer only the JSON."


def build_messages(
    task: Task, ontology: Ontology, next_steps: Sequence[str], jpegs: Sequence[bytes]
) -> list[dict]:
    """Chat messages for an OpenAI-compatible server: system rules, then the frames (oldest first)
    and the task context."""
    images = [
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(j).decode()}}
        for j in jpegs
    ]
    text = user_text(task, ontology, next_steps, len(jpegs))
    return [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": [*images, {"type": "text", "text": text}]},
    ]


def task_json_schema(task: Task) -> dict:
    """`vlm_output_json_schema()` narrowed to the task: guided decoding can only emit the task's actions
    and objects, and a short note. The note comes first so the model describes the frames before it picks
    an action (guided decoding follows this key order). Answers are still checked by `parse_vlm_output`."""
    schema = copy.deepcopy(vlm_output_json_schema())
    props = schema["properties"]
    props["action"] = {"anyOf": [{"type": "string", "enum": list(task.actions)}, {"type": "null"}]}
    props["objects"] = {"type": "array", "items": {"type": "string", "enum": list(task.objects)}}
    props["note"] = {"type": "string", "maxLength": NOTE_MAX_CHARS}
    order = ["note", "objects", "action", "quality", "confidence"]
    schema["properties"] = {k: props[k] for k in order}
    schema["required"] = order
    return schema
