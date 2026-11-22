# 2026-11-22 — probabilistic-embers

- **Who:** alonsogacm (+ agents)
- **Branch / PRs:** `feat/probabilistic-embers`
- **Goal:** replace the all-or-nothing ember answer for drawn firebreaks with probabilistic ember landings.

## Done
- Reviewed PR #64 (ember range at 12 / 15 / 25 m per km/h). Its code worked, but every row crosses every
  drawable line: 60 m cells, a 3-cell minimum jump and the 15 km/h wind gate put the reach past 120 m at any of the
  three distances. The 12 and 15 rows came from settings the calibration rejected or never scored, so the range was
  one-sided. 30 m and 60 m lines rasterise to the same cells. #64 merged while this branch was in progress.
- Three prototyped designs (published physics / calibration-preserving / planner-first) and a judge. RandomFront 2.3's
  landing formulas are unusable as printed (μ = 5.6 cm or 5.6 km). Sardoy-shaped landings fit better but change the
  main result.
- Engine: `FireParams.emberSeed` (null = shipped engine), Poisson-thinned jump edges with Schroeder's (1969) ignition
  probability, `hashPair` common random numbers, `FireInput.lineMask` / `FireResult.line` crossing report. One fitted
  scalar, `spotBrandsPerHa` = 356 (`calibrate.ts --embers`).
- Worker and panel: 8 paired members in the background, one simulation per task, cached per side, seed and
  evacuation key; the "¿Las pavesas cruzan estas líneas?" block. #64's range, script and message removed.
- `pnpm embers` (`src/engine/fire/ember-ensemble.ts`) produces every number in fire `MODEL.md` section 5.
- Three reviews. Fixes: a line-report test that catches two mutants, notes on Schroeder's index scale, stability in
  humid air, copy, embers at distance 0 treated as off, and fire starts snapped against the no-lines mask for the
  runs without the lines (after #67).

## Decisions
- D-037: probabilistic ember landings for drawn firebreaks; the main result stays deterministic; supersedes D-034.

## Open / blocked
- Whether a line is crossed is decided by the inherited gates (wind ≥ 15 km/h, source ROS ≥ 15 m/min), not by
  ember chance: on Talca 0 of 32 at wind ×0.6, 32 of 32 at ×0.65.
- Browser-worker timings were measured only by hand (about 1.1–1.7 s to final numbers on Viña); Node numbers are in
  `MODEL.md`.
- In humid air the 8-member median is unstable (Talca RH +30: 497–733 saved by block).

## Next
- Sardoy landings as a full recalibration candidate; revisit the 15 m/min source gate (backlog).
