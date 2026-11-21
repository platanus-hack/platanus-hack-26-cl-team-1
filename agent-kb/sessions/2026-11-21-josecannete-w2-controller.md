# 2026-11-21 — W2: symbolic simulator + learned controller

- **Who:** josecannete (+ Claude)
- **Branch / PRs:** #18 (contracts: `observed_quality`), #23 (`sim/symbolic`), learned controller + eval + wiring.
- **Goal:** trajectories from any task's automaton; a learned controller compared against the rules under noise.

## Done
- D-011: `TrajectoryEvent.observed_quality` (so `incomplete` is observable); null action ⇒ quality unknown.
- `sim/symbolic` (`symsim`): true timelines with 0–2 injected mistakes + correction, perception noise levels,
  splits per run (same timeline and split at every noise level), JSONL CLI. CI job `symsim`.
- `training/controller` (`ctrl.train`, `ctrl.evaluate`), `server/app/controller/learned.py` (numpy GRU),
  `factory.py`, `SUP_CONTROLLER`. Weights for `hand_hygiene_basic` and `servo_scout_robot`.
- Ownership: symbolic simulator → Cote (D-008 amended, STACK).

## Findings
- First version fed the controller's tracked state to the GRU (teacher-forced on the true state): it was
  barely better than rules. Dropping the state inputs fixed it (exposure bias), see D-013.
- Under medium noise the learned controller ends ~92% of runs in the true state vs ~41–59% for rules, with
  4–6x fewer false alarms, but lower mistake recall. Numbers: `training/results/controller.md`.

## Next
- Mistake recall (hybrid with rules?), noise calibration against the real M_VL, retrain when the demo task changes.
