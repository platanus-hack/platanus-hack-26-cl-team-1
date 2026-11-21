"""System prompt + tool definitions built from /shared."""
import sys
from pathlib import Path

# `uv run pytest` from backend/ does not put backend/ on sys.path (no pythonpath in pyproject yet).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json

from app.agent.prompt import SYSTEM_BLOCKS, SYSTEM_PROMPT, TOOLS, build_system_prompt
from app.agent.reference import load_shared
from app.settings import settings

SHARED = settings.shared_dir


def test_prompt_lists_every_part_type():
    for path in sorted((SHARED / "parts").glob("*.json")):
        part = json.loads(path.read_text(encoding="utf-8"))
        assert f"`{part['type']}`" in SYSTEM_PROMPT, part["type"]
        for pin in part["pins"]:
            assert f"`{pin['id']}`" in SYSTEM_PROMPT


def test_prompt_lists_every_board_pin_id():
    for path in sorted((SHARED / "boards").glob("*.json")):
        board = json.loads(path.read_text(encoding="utf-8"))
        for pin in board["pins"]:
            assert f"`{pin['id']}`" in SYSTEM_PROMPT, f"{board['id']}:{pin['id']}"
        assert board["name"] in SYSTEM_PROMPT


def test_prompt_lists_examples_and_ir_reference():
    examples = json.loads((SHARED / "examples.json").read_text(encoding="utf-8"))
    for ex in examples:
        assert f"`{ex['id']}`" in SYSTEM_PROMPT
    assert "# Referencia del Block IR" in SYSTEM_PROMPT
    for kind in ["led", "buttonPressed", "servo", "potPercent", "serialPrint", "waitUntil", "onboardRgb"]:
        assert f"`{kind}`" in SYSTEM_PROMPT


def test_prompt_is_spanish_and_has_worked_example():
    assert "Quién eres" in SYSTEM_PROMPT
    assert "resistencia" in SYSTEM_PROMPT
    assert "`set_program`" in SYSTEM_PROMPT and "`simulate`" in SYSTEM_PROMPT
    assert "<contexto_app>" in SYSTEM_PROMPT


def test_prompt_is_byte_stable():
    again = build_system_prompt(load_shared(SHARED))
    assert again == SYSTEM_PROMPT


def test_system_block_has_cache_breakpoint():
    assert len(SYSTEM_BLOCKS) == 1
    assert SYSTEM_BLOCKS[-1]["cache_control"] == {"type": "ephemeral"}
    assert SYSTEM_BLOCKS[-1]["text"] == SYSTEM_PROMPT


def test_tools_match_shared_file_plus_eager_streaming():
    raw = json.loads((SHARED / "agent-tools.json").read_text(encoding="utf-8"))
    assert [t["name"] for t in TOOLS] == [t["name"] for t in raw]
    for tool, original in zip(TOOLS, raw):
        assert tool["eager_input_streaming"] is True
        assert {k: v for k, v in tool.items() if k != "eager_input_streaming"} == original
