# 2026-11-22 — eaton-firefighters

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `feat/eaton-firefighters`
- **Goal:** the firefighter layer for the Eaton fire.

## Done
- Asked first: one engine (supuesto) for departments that publish no list; LA County's "other" unit as a brush
  patrol (supuesto); every department leaves at 18:18 (supuesto); ambulances not counted.
- `web/public/data/eaton-2025/brigades.json`, hand-curated: 17 stations inside the grid (LA County LMS), Pasadena
  FD trucks from its 2025 Standards of Cover (figures 2, 96, 98), LA County Fire counts from figure 4 of the same
  report. 17 engines, 4 brush, 1 water tender, 3 ladders. Test parses it against the Eaton grid.
- Eaton's `layers.brigades` on; the firefighter toggle no longer calls Eaton's "off" state calibrated.
- Browser: 25 trucks, all working, 140 cells defended; small effect on the default scenario (-26 ha, -572
  buildings, households cut off unchanged).

## Decisions
- None new (per-event layers, D-030).

## Open / blocked
- No mutual aid or real dispatch times; Chilean tank sizes.

## Next
- Fit the fire model on both fires.
