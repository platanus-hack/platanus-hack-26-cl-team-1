# 2026-11-22 — fire-edge-notice

- **Who:** alonsogacm (+ agent)
- **Branch / PRs:** `fix/fire-edge-notice`
- **Goal:** check that vegetation (fuel) data drives the fire simulation, then stop the fire from being cut off
  silently at the edge of the simulated area, with the Maule (Talca) scenario as the focus.

## Done
- **Vegetation audit** (`origin/main` a4a6270, read-only, six checks with an independent re-check each):
  - Each scenario's own `fuel.bin` reaches `simulateFire` unchanged: hoy and vina-2024 `/data/fuel.bin`, talca
    `/data/talca/fuel.bin`, eaton-2025 `/data/eaton-2025/fuel.bin`. Changing the file on the wire changes the
    worker's burned area exactly as a direct run on the changed bytes.
  - It matters: Viña 180 km² with the real vegetation, 42 km² with vegetated cells set to grass, 278 km² set to
    forest; Talca 141 / 55 / 345 km². The files are real WorldCover-derived rasters, aligned (sea = NONE,
    best road/building match at zero offset), and Talca's is not a copy of Viña's.
  - Not all of Chile: fuel exists for two Chilean boxes (Viña, also used by hoy, and Talca), 884 km² each,
    about 0.23 % of the country. `national/` has population and fire companies only.
- **Edge notice** (this PR): the grid is a hard boundary (spread and embers that would leave it are dropped),
  and the explorer now says so.
  - `src/engine/fire/edge.ts`: `edgeContact()` finds when and where the fire reaches the outer ring of cells.
  - Map note and a line under "Al final": when and on which side; the date is added when it falls on a later day.
  - Map: dashed outline of the simulated area, always on; the stretch the fire reaches turns orange from its
    arrival time.
  - Browser check: Talca default stays inside (no note, 14,098 ha); Talca at wind ×1.5 reaches the north edge
    at 21:21 (16,623 ha); Viña default reaches the east edge at 18:31 (18,008 ha); Eaton reaches the south edge
    at 21:53 and the west edge at 08:42 on 8 Jan.

## Decisions
- None (applies the "never fail silently" rule in CLAUDE.md).

## Open / blocked
- Fire starts and firebreaks outside the area are refused by
  https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/67 (merged); the outline here shows where
  that area is before anyone clicks.

## Next
- Maule: the Talca box puts the preset start in its south fifth, so a strong-wind fire runs out of box to the
  north. Re-centre or move the box north in `pipeline/steps/events.py` and re-bake (`make data-talca`).
- Maule vegetation, from the audit, not addressed:
  - 61 % of Talca is grass-model fuel (grass, cropland); the cropland factor 0.6 was never fitted.
  - 37.5 % of its FOREST cells are on flat valley floor, probably orchards, simulated as forest.
  - Grass curing is fixed at 100 % in every scenario.
- Engine: travel time uses only the fuel of the cell the fire leaves; a 1-cell slow strip adds no delay.
