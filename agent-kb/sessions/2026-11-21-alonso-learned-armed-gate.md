# 2026-11-21 — learned-armed-gate

- **Who:** alonso (+ agent)
- **Branch / PRs:** `fix/learned-controller-armed-gate`
- **Goal:** stop the learned controller from marking steps done from its time prior alone.

## Done
- Reproduced with the committed weights: only null observations (confidence 0, every 1.5 s) still gave
  STEP_DONE (`led_flashlight` `button` at 3 s, `hand_hygiene_basic` `wet` at 3 s and `soap` at 7.5 s,
  `servo_scout_robot` `motors` at 6 s, `c172_takeoff` `master_on` at 4.5 s). The GRU's `p_done` drifts past
  the threshold with time, and the advance loop only checked `p_done >= done_threshold`.
- `LearnedController` gets an `armed` flag: off at `start`, on after an observation with an action at
  `confidence >= min_confidence`, back off after any advance. The advance loop runs only while armed. After
  the fix the null run gives zero STEP_DONE on all four tasks.
- Tests (`server/tests/test_learned_controller.py`): no STEP_DONE from 20 null observations, run for every
  library task; one `place_button` at 0.9/ok marks `button` done; a clean correct run reaches TASK_DONE on
  every task. Without the gate the null test fails on all four tasks.
- `training/results/controller.md` regenerated. Rules rows are unchanged. In the main tables the learned
  rows moved by about 1 point or less, with four exceptions at high noise: final-ok `c172_takeoff` 90.8 → 86.8
  and `servo_scout_robot` 82.6 → 80.2; step acc `hand_hygiene_basic` 61.2 → 58.5 and `led_flashlight`
  56.9 → 54.0. FA/run is unchanged or down by 0.01–0.02. Per-kind recall moved by at most 2.1 points.

## Decisions
- None new (an inference-time guard inside D-013's "outputs restricted to the automaton"). Rejected: a
  per-step evidence gate with a descendant rule. An earlier measurement showed it lets a real skip mark the
  skipped step done, and it costs up to 29 points of final-ok at high noise.

## Open / blocked
- The demo still runs `SUP_CONTROLLER=rules`. Learned mode also needs the perception fix (D-016 on
  `fix/perception-object-guard`) before a live run.

## Next
- Try `SUP_CONTROLLER=learned` on a live webcam run of the demo task.
