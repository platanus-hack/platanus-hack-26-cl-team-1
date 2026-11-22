"""Rules controller: a forbidden action only counts when its step is due; a missed brief step is inferred."""

from pathlib import Path

import pytest
from contracts import Event, MistakeKind, Observation, Quality, Source, VlmOutput

from app.controller.rules import RulesController
from app.library.store import TaskLibrary

TASKS_DIR = Path(__file__).resolve().parents[2] / "tasks"


@pytest.fixture(scope="module")
def task():
    return TaskLibrary.load(TASKS_DIR).get("hand_hygiene_basic")


def obs(action, seq):
    output = VlmOutput(action=action, confidence=0.9, quality=Quality.OK if action else Quality.UNKNOWN)
    return Observation(seq=seq, t_ms=seq * 1000, source=Source.WEBCAM, model="t", latency_ms=0, output=output)


def run(task, actions, **kwargs):
    controller = RulesController(**kwargs)
    controller.start(task)
    return controller, [controller.decide(obs(a, i)) for i, a in enumerate(actions, start=1)]


def test_a_bare_hand_on_the_faucet_at_the_start_is_not_a_mistake(task):
    _, decisions = run(task, ["touch_faucet_bare", "wet_hands"])
    assert decisions[0].event is Event.NONE
    assert decisions[1].event is Event.STEP_DONE


def test_closing_the_faucet_bare_handed_when_it_is_due_is_a_mistake(task):
    steps = ["wet_hands", "apply_soap", "rub_palms", "rub_backs", "rinse_hands", "dry_hands"]
    _, decisions = run(task, [*steps, "touch_faucet_bare"])
    assert decisions[-1].event is Event.MISTAKE
    assert decisions[-1].mistake_id == "bare_faucet"


def test_a_missed_brief_step_is_inferred_after_repeated_evidence(task):
    """Soap was taken between two perception calls: rubbing is out of order once (said), then after four
    sightings in a row the controller takes soap as done and moves on, saying so."""
    controller, decisions = run(task, ["wet_hands", *["rub_palms"] * 4])
    assert decisions[1].event is Event.MISTAKE and decisions[1].mistake_kind is MistakeKind.OUT_OF_ORDER
    assert [d.event for d in decisions[2:4]] == [Event.NONE, Event.NONE]  # already said
    assert decisions[4].event is Event.STEP_DONE and decisions[4].step == "palms"
    assert "aplicar jabón" in decisions[4].say.text
    assert {"wet", "soap", "palms"} <= controller.done


def test_uncertain_calls_do_not_break_the_streak_but_another_action_does(task):
    _, decisions = run(task, ["wet_hands", "rub_palms", None, "rub_palms", "rub_palms", "rub_palms"])
    assert decisions[-1].event is Event.STEP_DONE
    _, decisions = run(task, ["wet_hands", "rub_palms", "rub_palms", "rub_palms", "wet_hands", "rub_palms"])
    assert all(d.event is not Event.STEP_DONE for d in decisions[1:])


def test_never_infers_more_than_one_missing_step(task):
    """Rinsing right after wetting needs palms and backs (and soap before them): keep warning, never jump."""
    controller, decisions = run(task, ["wet_hands", *["rinse_hands"] * 6])
    assert all(d.event is not Event.STEP_DONE for d in decisions[1:])
    assert controller.done == frozenset({"wet"})


def test_closing_the_faucet_bare_handed_one_step_early_is_still_a_mistake(task):
    """After rinsing, before drying: closing is one step away, so a bare hand on the faucet is corrected."""
    steps = ["wet_hands", "apply_soap", "rub_palms", "rub_backs", "rinse_hands"]
    _, decisions = run(task, [*steps, "touch_faucet_bare"])
    assert decisions[-1].event is Event.MISTAKE and decisions[-1].mistake_id == "bare_faucet"


def test_an_inferred_step_counts_as_progress_for_reminders(task):
    controller, _ = run(task, ["wet_hands", *["rub_palms"] * 4])
    assert controller.tick(5 * 1000 + 1000) is None  # no reminder right after "doy por hecho"


def test_a_defined_out_of_order_mistake_is_never_inferred_away():
    """The task says doing this step early *is* the mistake: full power with the parking brake still set
    keeps the warning however long it's held, instead of "doy por hecho: soltar el freno"."""
    plane = TaskLibrary.load(TASKS_DIR).get("c172_takeoff")
    ready = ["turn_master_on", "set_fuel_both", "set_mixture_rich", "start_engine", "set_flaps_takeoff"]
    controller, decisions = run(plane, [*ready, "turn_landing_light_on", *["apply_full_throttle"] * 8])
    assert decisions[6].event is Event.MISTAKE and decisions[6].mistake_id == "power_with_brake"
    assert all(d.event is Event.NONE for d in decisions[7:])  # said once, never assumed done
    assert "brake_release" not in controller.done and "full_power" not in controller.done


def test_a_step_without_a_defined_out_of_order_mistake_is_still_inferred():
    """flaps_10 has no out-of-order MistakeDef: seen four times before the engine start, the start is
    taken as done (the inference D-017 added still works where the task doesn't forbid it)."""
    plane = TaskLibrary.load(TASKS_DIR).get("c172_takeoff")
    controller, decisions = run(
        plane, ["turn_master_on", "set_fuel_both", "set_mixture_rich", *["set_flaps_takeoff"] * 4]
    )
    assert decisions[-1].event is Event.STEP_DONE and {"engine_start", "flaps_10"} <= controller.done


def test_fast_sightings_need_the_minimum_span_before_inferring(task):
    """Four sightings within a second (pipelined perception) aren't enough: the span must reach 2 s."""
    controller = RulesController()
    controller.start(task)

    def at(action, t_ms):
        output = VlmOutput(action=action, confidence=0.9, quality=Quality.OK)
        o = Observation(seq=t_ms, t_ms=t_ms, source=Source.WEBCAM, model="t", latency_ms=0, output=output)
        return controller.decide(o)

    at("wet_hands", 0)
    fast = [at("rub_palms", t) for t in (1000, 1250, 1500, 1750, 2000, 2250)]
    assert all(d.event is not Event.STEP_DONE for d in fast)
    assert at("rub_palms", 3000).event is Event.STEP_DONE


def test_a_single_flicker_does_nothing_with_two_of_three(task):
    """One stray answer neither completes a step nor triggers a spoken warning; two agreeing ones do."""
    _, decisions = run(
        task, ["wet_hands", "wet_hands", "rinse_hands", "wet_hands", "apply_soap", "apply_soap"], confirm=2
    )
    assert [d.event for d in decisions] == [
        Event.NONE,
        Event.STEP_DONE,
        Event.NONE,
        Event.NONE,
        Event.NONE,
        Event.STEP_DONE,
    ]


def test_agreement_counts_within_the_last_three_answers(task):
    _, decisions = run(task, ["wet_hands", None, "wet_hands"], confirm=2)
    assert decisions[-1].event is Event.STEP_DONE
    _, decisions = run(task, ["wet_hands", None, None, "wet_hands"], confirm=2)
    assert decisions[-1].event is Event.NONE


def test_the_live_server_confirms_only_real_model_answers(tmp_path):
    from app.controller.factory import make_controller_factory
    from app.settings import PerceptionMode, Settings, VoiceMode

    library = TaskLibrary.load(TASKS_DIR)
    base = dict(tasks_dir=TASKS_DIR, scripted_every_ms=0, scripted_mistake=None, voice=VoiceMode.BROWSER,
                cors_origins=())  # fmt: skip
    vlm = Settings(perception=PerceptionMode.VLM, vlm_base_url="http://x/v1", **base)
    scripted = Settings(perception=PerceptionMode.SCRIPTED, **base)
    assert make_controller_factory(vlm, library)().confirm == 2
    assert make_controller_factory(scripted, library)().confirm == 1
