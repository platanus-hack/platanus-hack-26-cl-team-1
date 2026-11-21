"""Generate a task (recipe) from a natural-language description with Claude (owner: Alonso).

The model only sees ids from the domain's ontology: the output schema restricts every action and object
to the ontology's enums, so Claude can't invent vocabulary. The answer is then validated at the boundary
with `Task` + `check_against`; on a validation error the error goes back to Claude for another attempt,
and after `max_attempts` the generator raises. A task that fails validation is never written.

    cd server && uv run python -m app.library.generate robot_assembly servo_arm_robot "Arma un ..."

Env: ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL for the hackathon proxy), SUP_TASKGEN_MODEL.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import anthropic
from contracts import MistakeKind, Ontology, Task
from pydantic import ValidationError

from ..settings import REPO_ROOT
from .store import check_objects_cover_actions

DEFAULT_MODEL = "claude-opus-5-5"
MAX_ATTEMPTS = 3

SYSTEM_PROMPT = """\
You turn a description of a hands-on task into a recipe for a supervisor that watches the task through a
camera and talks to the person doing it (in Spanish, Chile; neutral and short, using "tú").

The recipe is a list of steps. Rules:
- 5 to 10 steps. Each step is completed by exactly ONE action from the ontology, and no two steps share an
  action. Pick actions whose result is clearly visible on camera in a still frame.
- `requires` lists the step ids that must be done before this step (a DAG). List the steps in a valid order:
  a step may only require steps listed before it. Only add a prerequisite when the order really matters
  (physically or for safety); steps that can be done in any order should not require each other.
- Step ids are short snake_case nouns (e.g. "bracket", "horn", "battery").
- `title_es`: a checklist line, 2-6 words, imperative ("Montar el servo").
- `instruction_es`: what the supervisor says to prompt the step, one short sentence ("Ahora inserta el servo
  en su soporte, con el eje hacia arriba.").
- `completion_cue`: English, the visible evidence that the step is done.
- `min_duration_s`: only for steps that must last a while; otherwise null.
- `mistakes`: 3 to 5 realistic, visible mistakes. Kinds:
  - "out_of_order": doing a step before its prerequisites (e.g. connecting the battery before the wiring).
    The step must have at least one prerequisite.
  - "wrong_action": an action from the ontology that is NOT any step's action and reveals a mistake (e.g.
    inserting a part upside down). Set `action` to it; for every other kind, `action` is null.
  - "incomplete": the right action done badly (loose, partial, too short).
  - "repeated": doing a finished step again (rarely useful; prefer the others).
  `correction_es` is what the supervisor says: one short sentence that starts with "Ojo," and says how to
  fix it.
  `description` and `visual_cue` are English.
- `title_es`: the task's name in Spanish. `description`: one or two English sentences.
- `objects`: every object the steps and mistakes use (from the ontology).
"""


def task_output_schema(ontology: Ontology) -> dict[str, Any]:
    """JSON Schema for the model's answer: the generated parts of a `Task`, with ids restricted to the
    ontology. The fixed parts (id, version, domain, ontology version, action list) are filled in by code."""
    actions = [a.id for a in ontology.actions]
    objects = [o.id for o in ontology.objects]
    text = {"type": "string"}
    nullable = lambda schema: {"anyOf": [schema, {"type": "null"}]}  # noqa: E731
    step = _closed_object(
        id=text,
        title_es=text,
        instruction_es=text,
        action={"type": "string", "enum": actions},
        requires={"type": "array", "items": text},
        completion_cue=text,
        min_duration_s=nullable({"type": "number"}),
    )
    mistake = _closed_object(
        id=text,
        kind={"type": "string", "enum": [k.value for k in MistakeKind]},
        step=text,
        action=nullable({"type": "string", "enum": actions}),
        description=text,
        visual_cue=text,
        correction_es=text,
    )
    return _closed_object(
        title_es=text,
        description=text,
        objects={"type": "array", "items": {"type": "string", "enum": objects}},
        steps={"type": "array", "items": step},
        mistakes={"type": "array", "items": mistake},
    )


def _closed_object(**properties: dict[str, Any]) -> dict[str, Any]:
    """An object schema where every property is required (nullable ones say so) and nothing else is allowed,
    as structured outputs expect."""
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


def assemble_task(raw: dict[str, Any], ontology: Ontology, task_id: str, version: int = 1) -> Task:
    """Build and validate a `Task` from the model's answer. Raises `ValidationError` / `ValueError`."""
    steps = [{k: v for k, v in s.items() if not (k == "min_duration_s" and v is None)} for s in raw["steps"]]
    mistakes = [{k: v for k, v in m.items() if not (k == "action" and v is None)} for m in raw["mistakes"]]
    actions = [s["action"] for s in steps]
    actions += [m["action"] for m in mistakes if m.get("action") and m["action"] not in actions]
    task = Task.model_validate(
        {
            "id": task_id,
            "version": version,
            "title_es": raw["title_es"],
            "description": raw["description"],
            "domain": ontology.domain,
            "ontology_version": ontology.version,
            "objects": list(dict.fromkeys(raw["objects"])),
            "actions": actions,
            "steps": steps,
            "mistakes": mistakes,
        }
    )
    task.check_against(ontology)
    check_objects_cover_actions(task, ontology)
    return task


def _ontology_brief(ontology: Ontology) -> str:
    objects = "\n".join(f"- {o.id}: {o.description}" for o in ontology.objects)
    actions = "\n".join(
        f"- {a.id}: {a.verb}({a.object or ''}{', ' + a.target if a.target else ''}) | {a.visual_cue}"
        for a in ontology.actions
    )
    return f"Ontology `{ontology.domain}` v{ontology.version}.\n\nObjects:\n{objects}\n\nActions:\n{actions}"


def generate_task(
    description: str,
    ontology: Ontology,
    task_id: str,
    *,
    client: anthropic.Anthropic | None = None,
    model: str | None = None,
    max_attempts: int = MAX_ATTEMPTS,
) -> Task:
    client = client or anthropic.Anthropic()
    model = model or os.environ.get("SUP_TASKGEN_MODEL", DEFAULT_MODEL)
    schema = task_output_schema(ontology)
    prompt = f"{_ontology_brief(ontology)}\n\nTask to turn into a recipe:\n{description}"
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    errors: list[str] = []
    for _ in range(max_attempts):
        response = client.messages.create(
            model=model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=messages,
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": schema}},
        )
        if response.stop_reason != "end_turn":
            raise RuntimeError(f"task generation stopped early: stop_reason={response.stop_reason!r}")
        text = next(b.text for b in response.content if b.type == "text")
        try:
            return assemble_task(json.loads(text), ontology, task_id)
        except (ValidationError, ValueError) as error:
            errors.append(str(error))
            messages.append({"role": "assistant", "content": response.content})
            messages.append(
                {
                    "role": "user",
                    "content": f"That recipe is invalid:\n{error}\n\nFix it and send the full recipe again.",
                }
            )
    raise ValueError(f"no valid task after {max_attempts} attempts; last error:\n{errors[-1]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate a task.json with Claude.")
    parser.add_argument("domain", help="folder under tasks/ that holds ontology.json")
    parser.add_argument("task_id", help="snake_case id; also the output file name")
    parser.add_argument("description", help="what the task is, in any language")
    parser.add_argument("--tasks-dir", type=Path, default=REPO_ROOT / "tasks")
    parser.add_argument("--force", action="store_true", help="overwrite an existing task file")
    args = parser.parse_args(argv)

    domain_dir = args.tasks_dir / args.domain
    ontology = Ontology.model_validate_json((domain_dir / "ontology.json").read_text())
    out = domain_dir / f"{args.task_id}.json"
    if out.exists() and not args.force:
        print(f"{out} exists; pass --force to overwrite", file=sys.stderr)
        return 1
    task = generate_task(args.description, ontology, args.task_id)
    out.write_text(task.model_dump_json(indent=2, exclude_defaults=True) + "\n")
    print(f"wrote {out} ({len(task.steps)} steps, {len(task.mistakes)} mistakes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
