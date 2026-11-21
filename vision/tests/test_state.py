import json
from pathlib import Path

import pytest

from vision import messages as M
from vision.detector import Det, Placed
from vision.expected import build_expected
from vision.state import Tracker

FIX = Path(__file__).parent / "fixtures"
# blink-uno steps: 1 board, 2 breadboard, 3 R1 e1–e5, 4 LED e7/e8, 5 GND→T-1, 6 a8→T-8, 7 D13→a1, 8 d5→b7, 9 check, 10 program


class Clock:
    t = 0.0

    def __call__(self):
        return self.t


@pytest.fixture
def exp():
    return build_expected(json.loads((FIX / "blink-uno.json").read_text()))


def mk(cls, gx, gy, holes=None, box=(0, 0, 1, 1), w=1.0, h=1.0):
    return Placed(Det(cls, 0.9, box), (gx, gy), (gx - w, gy - h, gx + w, gy + h), holes or [])


R1 = mk("resistor", 4.0, 9.0, w=2.3, h=0.4)  # e1–e5: grid x 2..6, y 9
LED_OK = mk("led_red", 8.5, 9.0)  # e7/e8: grid x 8 and 9


def run(tr, step, placed, n, calibrated=True, clock=None, dt=1 / 6):
    events = []
    for _ in range(n):
        if clock:
            clock.t += dt
        events += tr.update(step, placed, calibrated)
    return events


def kinds(events):
    return [e.kind for e in events]


def test_part_complete_after_8_frames(exp):
    tr = Tracker(exp)
    assert run(tr, 4, [R1, LED_OK], 7) == []
    ev = run(tr, 4, [R1, LED_OK], 1)
    assert kinds(ev) == ["step_candidate"] and ev[0].holes == ["e7", "e8"]
    assert run(tr, 4, [R1, LED_OK], 20) == []  # fires once


def test_flicker_resets_the_count(exp):
    tr = Tracker(exp)
    run(tr, 4, [R1, LED_OK], 6)
    run(tr, 4, [R1], 1)  # missed detection
    assert run(tr, 4, [R1, LED_OK], 7) == []
    assert kinds(run(tr, 4, [R1, LED_OK], 1)) == ["step_candidate"]


def test_resistor_shifted_one_column_then_fixed(exp):
    tr = Tracker(exp)
    shifted = mk("resistor", 5.0, 9.0, w=2.3, h=0.4)
    ev = run(tr, 3, [shifted], 8)
    assert kinds(ev) == ["issue_candidate"]
    v = ev[0].verdict
    assert v.issue == "wrong_hole" and v.shift == 1 and v.target == "r1"
    tr.issue_reported(v)
    line = M.issue_line("wrong_hole", exp, exp.step(3), shift=1)
    assert "una columna a la derecha" in line and "e1 y e5" in line
    ev = run(tr, 3, [R1], 8)
    assert kinds(ev) == ["issue_gone", "step_candidate"]


def test_row_inside_the_same_strip_is_fine(exp):
    tr = Tracker(exp)
    led_row_c = mk("led_red", 8.5, 7.0)  # c7/c8: same strips as e7/e8
    assert kinds(run(tr, 4, [R1, led_row_c], 8)) == ["step_candidate"]
    tr2 = Tracker(exp)
    led_bottom = mk("led_red", 8.5, 12.0)  # f7/f8: other half of the board
    assert "step_candidate" not in kinds(run(tr2, 4, [R1, led_bottom], 10))


def test_wrong_part(exp):
    tr = Tracker(exp)
    ev = run(tr, 4, [R1, mk("led_green", 8.5, 9.0)], 8)
    assert kinds(ev) == ["issue_candidate"] and ev[0].verdict.issue == "wrong_part"


def test_earlier_parts_are_not_wrong_parts(exp):
    tr = Tracker(exp)
    assert "issue_candidate" not in kinds(run(tr, 4, [R1], 20))


def test_hand_pauses_without_resetting(exp):
    tr = Tracker(exp)
    hand = mk("hand", 9, 9, w=4, h=4)
    run(tr, 4, [R1, LED_OK], 5)
    ev = run(tr, 4, [R1, LED_OK, hand], 10)
    assert kinds(ev) == ["paused"]
    ev = run(tr, 4, [R1, LED_OK], 3)
    assert kinds(ev) == ["resumed", "step_candidate"]


def wire(hole):
    return mk("wire_end", 0, 0, holes=[hole])


def test_wire_step_complete_and_wrong_end(exp):
    tr = Tracker(exp)
    base = [R1, LED_OK, wire("T-1")]  # step 5 done: GND → T-1
    ok = base + [wire("T-8"), wire("a8")]
    assert kinds(run(tr, 6, ok, 8)) == ["step_candidate"]
    tr2 = Tracker(exp)
    bad = base + [wire("T-8"), wire("a9")]
    ev = run(tr2, 6, bad, 8)
    assert kinds(ev) == ["issue_candidate"]
    v = ev[0].verdict
    assert v.issue == "wire_wrong_end" and v.observed_hole == "a9"
    assert (
        M.issue_line("wire_wrong_end", exp, exp.step(6), observed_hole="a9")
        == "Ojo, el cable negro va en a8, no en a9."
    )


def test_board_and_breadboard_steps(exp):
    clock = Clock()
    tr = Tracker(exp, clock=clock)
    assert kinds(run(tr, 1, [mk("arduino_uno", -10, 8)], 8, clock=clock)) == ["step_candidate"]
    tr = Tracker(exp, clock=clock)
    assert run(tr, 2, [], 8, calibrated=False, clock=clock) == []
    assert kinds(run(tr, 2, [], 20, clock=clock)) == ["step_candidate"]


def test_stall_hint_once(exp):
    clock = Clock()
    tr = Tracker(exp, clock=clock, stall_s=25)
    ev = run(tr, 4, [R1], 6 * 30, clock=clock)
    assert kinds(ev) == ["stall"]


def test_without_detector_the_vlm_checks_periodically(exp):
    clock = Clock()
    tr = Tracker(exp, clock=clock, detector=False)
    ev = run(tr, 4, [], 6 * 16, clock=clock)  # 16 s
    assert kinds(ev).count("vlm_check") == 3  # at ~3 s, ~9 s, ~15 s


def test_program_step_is_manual(exp):
    tr = Tracker(exp)
    assert run(tr, 10, [], 30) == []
