"""Write the JSON Schemas of every contract to contracts/schemas/ (consumed by web/ and by prompts).

uv run python -m contracts.export           # write
uv run python -m contracts.export --check   # fail if the committed schemas are stale (CI)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import BaseModel, TypeAdapter

from .dataset import ClipRecord, Trajectory
from .decision import Decision
from .ontology import Ontology
from .perception import Observation, VlmOutput
from .protocol import client_message_adapter, server_message_adapter
from .task import Task, TaskSummary

SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "schemas"

# Messages and outputs use the serialization schema: fields with defaults are always present, so
# they are required (e.g. `type`, which TypeScript needs to narrow the WebSocket unions).
SERIALIZATION = {"task_summary", "observation", "decision", "ws_client_message", "ws_server_message"}

TARGETS: dict[str, type[BaseModel] | TypeAdapter] = {
    "ontology": Ontology,
    "task": Task,
    "task_summary": TaskSummary,
    "vlm_output": VlmOutput,
    "observation": Observation,
    "decision": Decision,
    "ws_client_message": client_message_adapter,
    "ws_server_message": server_message_adapter,
    "trajectory": Trajectory,
    "clip_record": ClipRecord,
}


def render() -> dict[str, str]:
    out = {}
    for name, target in TARGETS.items():
        mode = "serialization" if name in SERIALIZATION else "validation"
        if isinstance(target, TypeAdapter):
            schema = target.json_schema(mode=mode)
        else:
            schema = target.model_json_schema(mode=mode)
        out[f"{name}.schema.json"] = json.dumps(schema, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    rendered = render()
    if args.check:
        on_disk = {p.name: p.read_text() for p in SCHEMAS_DIR.glob("*.schema.json")}
        if on_disk != rendered:
            stale = sorted(set(on_disk.items()) ^ set(rendered.items()))
            names = sorted({name for name, _ in stale})
            print(f"schemas are stale: {names}; run `uv run python -m contracts.export`")
            return 1
        print(f"{len(rendered)} schemas up to date")
        return 0
    SCHEMAS_DIR.mkdir(exist_ok=True)
    for old in SCHEMAS_DIR.glob("*.schema.json"):
        if old.name not in rendered:
            old.unlink()
    for name, text in rendered.items():
        (SCHEMAS_DIR / name).write_text(text)
    print(f"wrote {len(rendered)} schemas to {SCHEMAS_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
