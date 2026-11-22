# 2026-11-22 — eaton-2025

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `feat/eaton-2025` (draft PR, core)
- **Goal:** add the 2025 California fires as a second simulated scenario and use its real data to test and
  improve the model.

## Done
- Asked first, then built. Choices: Eaton fire; Viña's global sources + US data only to score; test then fit on
  both fires; top-bar picker; firefighters and population for Eaton after the core; alert 19:25, 2.70 persons
  per household, 4 % on foot.
- Pipeline per event (`steps/events.py`, `bake.py --event`); Viña byte-identical (re-baked from scratch and
  compared). Eaton baked: grid 306 × 337, Overture (184,603 buildings), OSM (84,641 edges), ERA5, Sentinel-2
  scar (S2A 2025-01-02 / S2C 2025-02-21), FIRMS, GOES-18, CAL FIRE ignition, WFIGS perimeter, CAL FIRE DINS.
- Web: `data/events.ts`, `TIMELINE.EATON_2025` in main's picker (merged origin/main after D-028 landed),
  nullable brigades / population, per-event evacuation defaults with sources, out-of-sample block in Validación.
- `validate-event.ts` / `make validate-eaton`: Dice 0.34 (scar) / 0.43 (perimeter) at 12:00 on 8 Jan, model
  burns 14,942 ha vs 5,689 ha (fire MODEL.md 6b).

## Decisions
- D-030: second baked event; out-of-sample test; per-event wind correction and evacuation defaults.

## Open / blocked
- LA County's after-action PDFs (McChrystal, Citygate) block automated download: alert times rest on LA County's
  HTML release, CAL FIRE updates and press; open the PDFs in a browser for page references.
- Viña's scar reflectance offset (decisions §2).
- MapLibre logs "Expected value to be of type number, but found null" in the browser; not investigated.

## Next
- Fit on both fires; Eaton population and firefighters (separate PRs).
