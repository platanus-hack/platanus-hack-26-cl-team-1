# 2026-11-22 — fire-pacing-backtest

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/fire-simulation-validation-vina-b7e479`
- **Goal:** back-test the pace of the simulated Viña del Mar fire against satellite passes at several times,
  and make the simulation more accurate with what the test shows.

## Done
- `pipeline/steps/goes.py`: GOES-16 ABI fire pixels every 10 min, 12:00–04:00 (1,379 pixels in the grid),
  `goes.json`, PUG fixed-grid conversion tested against the PUG worked example.
- `web/src/engine/fire/pacing.ts`: two-sided front lag and overrun per fire, fire membership by space-time
  linking (drops a third fire at the grid's NE corner); `calibrate.ts` fits on GOES and tests on VIIRS/MODIS;
  robust scan over ERA5 wind ×0.9 / ×1 / ×1.1.
- Findings: the western head stalled at ~5.7 km from 14:05 to 16:25, then ran ~100 m/min to 21 km by 19:05;
  both fires started their run at ~16:30; GOES puts the Jardín Botánico at ~17:55 (press: 17:00).
- Tried and rejected with numbers (MODEL.md §6): Concón METAR weather, intensity-scaled embers (knife edge),
  ember-jitter ensemble, faster ember jumps, Lago Peñuelas as unburnable.
- Shipped McArthur ×4 + matorral ×0.5: robust objective 0.372 → 0.470, Dice 0.639, cut-off households at an
  18:00 alert 4,061 (was 4,753). Panel "Validación" shows the pace and the three times per neighbourhood.
- `evac/sensitivity.ts` now also prints the alert-time curve and the eastern fire alone.

## Decisions
- Satellite pace as calibration target, GOES-16 source, matorral at half of forest (→ decisions.md D-027).

## Open / blocked
- The western stall (14:05–16:25) is not reproduced; the pace degrades at wind ×1.1.
- WorldCover marks part of Lago Peñuelas' bed as cropland (no effect measured).

## Next
- Find an observed cause for the stall (local wind records near Peñuelas, initial attack reports with a
  citable source) before adding any mechanism.
