"""Expected physical state per guide step, from the hello payload.

    hello.project + hello.netlist.insertions (which leg goes in which hole)
    + hello.steps (order, ids 'part-<id>' / 'wire-<id>', highlight)
    → for every step: the legs / wire ends it adds, and the cumulative set up to it.

Breadboard semantics: what matters electrically is the *strip* (a column's a–e or f–j, or a
whole rail), so every leg/wire end also carries its strip. A leg in d10 instead of e10 is
fine; e11 instead of e10 is `wrong_hole`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .mat import BB_RAILS

POLARIZED = {"led", "led-rgb", "diode", "buzzer", "npn", "battery-9v", "battery-aa4"}
# YOLO classes (training/yolo). Parts without a class are checked by the VLM only.
YOLO_CLASS = {
    "arduino-uno": "arduino_uno",
    "resistor": "resistor",
    "button": "button",
    "potentiometer": "potentiometer",
    "buzzer": "buzzer",
}
LED_CLASS = {"red": "led_red", "green": "led_green", "yellow": "led_yellow"}
WIRE_COLORS_ES = {
    "red": "rojo",
    "black": "negro",
    "blue": "azul",
    "green": "verde",
    "yellow": "amarillo",
    "orange": "naranjo",
    "white": "blanco",
    "purple": "morado",
}


def strip_of(hole: str) -> str:
    """'e10' → '10t' (top half), 'h10' → '10b', 'T+3' → 'T+' (the whole rail)."""
    if hole[:2] in BB_RAILS:
        return hole[:2]
    row, col = hole[0], hole[1:]
    return f"{col}{'t' if row in 'abcde' else 'b'}"


def split_ref(ref: str) -> tuple[str, str]:
    i = ref.find(".")
    return (ref, "") if i <= 0 else (ref[:i], ref[i + 1 :])


@dataclass(frozen=True)
class Leg:
    part: str
    pin: str
    hole: str

    @property
    def strip(self) -> str:
        return strip_of(self.hole)


@dataclass(frozen=True)
class WireEnd:
    wire: str
    end: str  # 'from' | 'to'
    hole: str | None = None  # breadboard hole
    board_pin: str | None = None  # Arduino header pin id ('D13', 'GND1')
    part_pin: str | None = None  # directly on another part's leg ('led1.anode')

    @property
    def strip(self) -> str | None:
        return strip_of(self.hole) if self.hole else None


@dataclass
class PartInfo:
    id: str
    type: str
    label: str
    yolo: str | None
    polarized: bool
    pins: list[str]
    props: dict[str, Any] = field(default_factory=dict)


@dataclass
class StepExpect:
    index: int
    id: str
    kind: str
    title: str
    part: str | None = None
    wire: str | None = None
    wire_color: str | None = None
    legs: list[Leg] = field(default_factory=list)
    wire_ends: list[WireEnd] = field(default_factory=list)
    cumulative_legs: set[Leg] = field(default_factory=set)
    cumulative_wire_ends: set[WireEnd] = field(default_factory=set)

    @property
    def visual(self) -> bool:
        """Can the camera verify this step (something goes into the breadboard)?"""
        return bool(self.legs) or any(e.hole for e in self.wire_ends)

    @property
    def holes(self) -> list[str]:
        return [leg.hole for leg in self.legs] + [e.hole for e in self.wire_ends if e.hole]


@dataclass
class Expected:
    parts: dict[str, PartInfo]
    steps: dict[int, StepExpect]
    breadboards: set[str]
    board: str | None

    def step(self, index: int) -> StepExpect | None:
        return self.steps.get(index)

    def legs_of(self, part: str) -> list[Leg]:
        out: list[Leg] = []
        for s in self.steps.values():
            out += [leg for leg in s.legs if leg.part == part]
        return out

    def part_at_strip(self, strip: str, upto: int) -> list[Leg]:
        """Legs expected in a strip once step `upto` is done."""
        s = self.steps.get(upto)
        return [] if s is None else [leg for leg in s.cumulative_legs if leg.strip == strip]


def build_expected(hello: dict[str, Any]) -> Expected:
    project = hello.get("project") or {}
    defs: dict[str, dict] = hello.get("parts") or {}
    netlist = hello.get("netlist") or {}

    parts: dict[str, PartInfo] = {}
    breadboards: set[str] = set()
    board: str | None = None
    for p in project.get("parts", []):
        d = defs.get(p["type"], {})
        model = (d.get("electrical") or {}).get("model")
        if model == "bus" or p["type"].startswith("breadboard"):
            breadboards.add(p["id"])
            continue
        if model == "mcu" or p["type"] in ("arduino-uno", "esp32c6-devkit"):
            board = board or p["id"]
        props = {**{k: v.get("default") for k, v in _props(d).items()}, **(p.get("props") or {})}
        yolo = LED_CLASS.get(str(props.get("color"))) if p["type"] == "led" else YOLO_CLASS.get(p["type"])
        parts[p["id"]] = PartInfo(
            id=p["id"],
            type=p["type"],
            label=p.get("label", p["id"]),
            yolo=yolo,
            polarized=p["type"] in POLARIZED,
            pins=[pin["id"] for pin in d.get("pins", [])],
            props=props,
        )

    legs_by_part: dict[str, list[Leg]] = {}
    for ins in netlist.get("insertions", []):
        part, pin = split_ref(ins["pin"])
        into_part, hole = split_ref(ins["into"])
        if into_part in breadboards and part in parts:
            legs_by_part.setdefault(part, []).append(Leg(part, pin, hole))

    wires = {w["id"]: w for w in project.get("wires", [])}

    def wire_end(wid: str, end: str, ref: str) -> WireEnd:
        part, pin = split_ref(ref)
        if part in breadboards:
            return WireEnd(wid, end, hole=pin)
        if part == board:
            return WireEnd(wid, end, board_pin=pin)
        return WireEnd(wid, end, part_pin=ref)

    steps: dict[int, StepExpect] = {}
    cum_legs: set[Leg] = set()
    cum_ends: set[WireEnd] = set()
    for s in sorted(hello.get("steps", []), key=lambda x: x["index"]):
        se = StepExpect(index=s["index"], id=s["id"], kind=s["kind"], title=s.get("title", ""))
        sid: str = s["id"]
        if sid.startswith("part-") and sid[5:] in parts:
            se.part = sid[5:]
            se.legs = list(legs_by_part.get(se.part, []))
        elif sid.startswith("wire-") and sid[5:] in wires:
            w = wires[sid[5:]]
            se.wire = w["id"]
            se.wire_color = w.get("color")
            se.wire_ends = [wire_end(w["id"], "from", w["from"]), wire_end(w["id"], "to", w["to"])]
        cum_legs |= set(se.legs)
        cum_ends |= set(se.wire_ends)
        se.cumulative_legs = set(cum_legs)
        se.cumulative_wire_ends = set(cum_ends)
        steps[se.index] = se
    return Expected(parts=parts, steps=steps, breadboards=breadboards, board=board)


def _props(d: dict) -> dict[str, dict]:
    props = d.get("props") or []
    if isinstance(props, dict):
        return props
    return {p["key"]: p for p in props if "key" in p}
