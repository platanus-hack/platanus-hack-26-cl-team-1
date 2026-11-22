# 2026-11-22 — talca-hipotetico

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** feat/maule-talca (PR link in the PR itself)
- **Goal:** data and a picker option to demo a hypothetical fire in the Maule region (Talca).

## Done
- Question first: why the deployed app covers one rectangle. Measured: one fixed 464 × 529 grid of 60 m
  (27.8 × 31.7 km); with defaults the Viña fire reaches the grid's east edge at 18:31 and stops there silently
  (9.1 km of edge burning by midnight). Not fixed here (see Open).
- Coordinated with the Eaton session (D-030) so Talca plugs into its events framework instead of a second one;
  built on its branch, rebased onto main after #58 merged.
- Chose the Talca box from four candidates by measured WorldCover mix (wildland 65.5 %, crop 27 %; whole city
  inside with margins N 9.4, S 9.9, W 18.1, E 4.2 km), DEM/WorldCover tiles by HTTP HEAD, a 19HBA Sentinel-2
  scene (only tile covering the box), and the reference day by scanning ERA5 Dec-Mar 2016/17-2025/26 at Talca.
- Pipeline: optional fire fields (`FIRE_FIELDS`, `observed_fire`), fire-less bake branch, `TALCA` event,
  `make data-talca`, README section, tests. `bake.py --event talca` reproduced the throwaway bake's binaries
  byte for byte.
- Web: `TIMELINE.TALCA`, `EventDef.observedFire`, picker option, Talca note, hidden scar/validation, sources
  panel wording. Checked in the browser: fire 1,244 ha at 17:00, 14,098 ha by midnight, 34,660 buildings
  reached; Viña unchanged.

## Decisions
- Talca hypothetical scenario as a fire-less baked event (→ decisions.md D-031).

## Open / blocked
- Viña's fire hits the grid's east edge at 18:31 with defaults and is clipped silently; options: a visible
  "edge reached" note (cheap) or widening the grid east and re-validating (pitch numbers change).
- Talca has no firefighters; the national fire-station dataset (bomberos session) could feed them.
- `steps/weather.py` summary and `steps/population.py` bind some paths at import time (they work because
  `bake.py` imports steps before `grid.select`); worth making explicit.

## Next
- Demo link: `https://cortafuego.app/?escenario=talca` once deployed.
