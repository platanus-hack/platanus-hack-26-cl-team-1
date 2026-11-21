# 2026-11-21 — no-infer-defined-mistakes

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/no-infer-defined-mistakes` (see the PR list)
- **Goal:** keep the C172 demo's deliberate order mistakes from being "inferred away" by D-017's rule.

## Done
- Read Jose's v2 VLM run on #40: 5/16 per pass (fuel, mixture now pass); he owns the remaining perception work
  (the model describes the older frame or an already-done state); nothing left on the sim side for now.
- Found that #37's inference (4 out-of-order sightings → assume the one missing prerequisite) turns
  `power_with_brake` and `start_not_ready` into "Bien, doy por hecho: …" ~3 s after the warning, with the brake
  still set / fuel still off. Reproduced on `RulesController`.
- `RulesController._infer` skips steps that have an `out_of_order` MistakeDef; two tests (the plane mistake keeps
  warning; a step without one is still inferred). `training/results/controller.md` regenerated (main's copy
  predated #37; this change alone moves rules numbers by ≤0.5 pt).

## Decisions
- D-017 amended: no inference for steps with a defined out-of-order mistake.

## Open / blocked
- Perception on the cockpit: Jose (prompt / frames / model).

## Next
- Re-run the C172 cases after Jose's perception changes; rehearse the four mistakes.
