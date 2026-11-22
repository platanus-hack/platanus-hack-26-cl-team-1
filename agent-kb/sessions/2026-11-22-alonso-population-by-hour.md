# 2026-11-22 — population-by-hour

- **Who:** alonso (+ agent)
- **Branch / PRs:** `feat/population-by-hour`
- **Goal:** know where people are in all of Chile at any hour (home at night and on weekends, work or school on
  weekdays), baked once, so fires can be recreated anywhere at any time.

## Done
- `pipeline/steps/population.py`, `bake_population.py`, `make population`:
  - Inputs: WorldPop 2024 (homes, 3") and GHSL non-residential building volume 2025 (workplaces and schools, 3"),
    with Argentina, Bolivia and Peru masked out.
  - Origin-constrained gravity on a national 30" grid (FFT, latitude bands, mass exact across band edges).
  - Outputs: the committed national product `web/public/data/national/population_cl.{json,bin}` (255,736 cells,
    4.1 MB, 19,714,431 people in both layers) and the grid's `population_home.bin` (901,349) and
    `population_work.bin` (839,633), refined by mass-conserving supersampling.
- First tries that failed:
  - Masking with Chile's own outline (Natural Earth 1:10M) dropped 144k residents of Punta Arenas and Chiloé:
    masked the neighbours instead.
  - Non-residential *surface* made Santiago's centre empty out by day (work/home 0.42): switched to *volume*
    (now 1.00; El Golf 2.92, Viña centro 2.39, Valparaíso plan 2.19, Puente Alto 0.35).
- `web/src/engine/population` (+ MODEL.md): presence model.
  - Shares: 50.3 % workers (INE ENE Oct-Dec 2024 / Censo 2024); 26.7 % students (Mineduc), only 1 Mar-15 Dec
    without 1-14 Jul.
  - Assumed schedules with commute ramps; weekends at home.
  - `peopleInBurnedArea` counts each burned cell at its arrival time.
- Contract (`types.ts`): `NationalPopulationMeta`, `NationalPopulation`, `PresenceParams`, `POPULATION_DAY`. The
  loader validates both grid layers and the national file; the mock dataset has synthetic layers.
- UI:
  - Stat "Personas donde llega el fuego, a la hora en que llega" (with baseline delta). Default scenario: 52,184
    present vs 54,874 residents; 52,052 on a school weekday. Read off the app, not from a script: not for the
    pitch.
  - Day selector in Evacuación; map layer "Personas a esta hora".
  - Checked in the browser: no console errors, and the weekend count equals the residents.
- Tests: 7 pipeline tests (gravity split and conservation, kernel, supersampling) and 12 web tests (presence
  model, parsers, the committed files). `make check` green.

## Decisions
- → D-024.

## Open / next
- The evacuation engine still uses 2.9 persons per building; wiring the time-of-day layers into it is the next
  step (backlog).
- The job proxy under-weights old mixed-use centres (Santiago, Concepción).
