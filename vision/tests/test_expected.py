import json
from pathlib import Path

import pytest

from vision.expected import Leg, WireEnd, build_expected, strip_of
from vision.mat import hole_grid

FIX = Path(__file__).parent / "fixtures"


def load(name: str) -> dict:
    return json.loads((FIX / f"{name}.json").read_text())


@pytest.fixture(scope="module")
def blink():
    return build_expected(load("blink-uno"))


def test_strip_of():
    assert strip_of("e10") == strip_of("a10") == "10t"
    assert strip_of("f10") == "10b"
    assert strip_of("T-8") == strip_of("T-1") == "T-"


def test_parts_and_classes(blink):
    assert blink.board == "uno1" and blink.breadboards == {"bb1"}
    assert blink.parts["led1"].yolo == "led_red" and blink.parts["led1"].polarized
    assert blink.parts["r1"].yolo == "resistor" and not blink.parts["r1"].polarized
    assert "uno1" in blink.parts and blink.parts["uno1"].yolo == "arduino_uno"


def test_part_steps_have_their_legs(blink):
    s3, s4 = blink.step(3), blink.step(4)
    assert s3.part == "r1" and set(s3.legs) == {Leg("r1", "a", "e1"), Leg("r1", "b", "e5")}
    assert s4.part == "led1" and set(s4.legs) == {Leg("led1", "anode", "e7"), Leg("led1", "cathode", "e8")}
    assert s4.visual and set(s4.holes) == {"e7", "e8"}
    assert s4.cumulative_legs == set(s3.legs) | set(s4.legs)


def test_wire_steps(blink):
    s5 = blink.step(5)  # Arduino GND → T-1
    assert s5.wire == "w1" and s5.wire_color == "black"
    assert set(s5.wire_ends) == {WireEnd("w1", "from", board_pin="GND1"), WireEnd("w1", "to", hole="T-1")}
    assert s5.visual  # the breadboard end is visible
    s8 = blink.step(8)  # d5 → b7
    assert {e.hole for e in s8.wire_ends} == {"d5", "b7"}
    assert len(s8.cumulative_wire_ends) == 8


def test_non_visual_steps(blink):
    assert not blink.step(1).visual  # board next to the breadboard
    assert not blink.step(2).visual  # prepare breadboard
    assert blink.step(9).kind == "check" and not blink.step(9).visual
    assert blink.step(10).kind == "program"


@pytest.mark.parametrize(
    "name", ["blink-uno", "button-led-uno", "traffic-light-uno", "servo-pot-uno", "motor-transistor-uno"]
)
def test_every_example_is_consistent(name):
    hello = load(name)
    exp = build_expected(hello)
    assert len(exp.steps) == len(hello["steps"])
    all_legs = exp.steps[max(exp.steps)].cumulative_legs
    # every insertion into the breadboard shows up exactly once, in a valid hole
    n_ins = sum(1 for i in hello["netlist"]["insertions"] if i["into"].split(".")[0] in exp.breadboards)
    assert len(all_legs) == n_ins
    assert all(hole_grid(leg.hole) is not None for leg in all_legs)
    # every part step highlights the same holes the expected state has
    for s in hello["steps"]:
        se = exp.steps[s["index"]]
        hl = {h.split(".", 1)[1] for h in s["highlight"] if "." in h and h.split(".")[0] in exp.breadboards}
        if se.part:
            assert hl == {leg.hole for leg in se.legs}


def test_traffic_light_led_colors():
    exp = build_expected(load("traffic-light-uno"))
    assert [exp.parts[p].yolo for p in ("led1", "led2", "led3")] == ["led_red", "led_yellow", "led_green"]
