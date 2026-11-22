# 2026-11-22 — firebreak-ember-range

- **Who:** chichitaocss (+ Claude)
- **Branch / PRs:** `feat/firebreak-ember-range`
- **Goal:** show the effect of drawn firebreaks across ember distances, after finding that on Talca the shipped
  ember setting decides whether a line holds.

## Done
- Reviewed PR #60 (Plan de preparación), merged main into it to clear two conflicts (Eaton layers, pipeline README);
  it was merged afterwards.
- Explored "experts draw firebreaks on a Maule scenario": Talca, drawing, base-scenario comparison already exist.
  Measured on Talca that a 60-120 m line changes households cut off by -1 to -5 % with embers at 25 m per km/h, and
  by -27 to -96 % with embers off; -51 % at 10 m per km/h (scratch script, superseded by the committed one below).
- `src/worker/emberRange.ts` (+ test): one ember distance, without and with the drawn lines, households cut off
  and burned cells. The worker runs 12 / 15 / 25 m per km/h after the result, one per task, cached; the panel
  (`FirebreakEmberRange.tsx`) shows the range under the list of firebreaks. Checked in the browser on Talca with an
  8 km x 120 m line drawn by hand: -25 / -12 / -4.9 %; the 25 m row equals the main result (10,060 households).
- `scripts/firebreak-embers.ts`: the same line placed exactly: -35.5 / -19.4 / -5.5 %, embers off -95.8 %.

## Decisions
- D-034: drawn firebreaks shown under several ember distances.

## Open / blocked
- Embers are deterministic (every source throws, every landing ignites), so any line narrower than D_max fails.
  A probabilistic ember model needs a published source.
- Firebreaks exist from the start of the run; a "finished at" time per line (the engine's `defense` windows) is
  not wired.

## Next
- Scenario-specific firebreak optimizer (where and when): running in its own session.
