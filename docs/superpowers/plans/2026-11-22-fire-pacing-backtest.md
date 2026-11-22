# Fire pacing back test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score the simulated fire's pace against satellite passes (GOES-16 every 10 min, VIIRS/MODIS) in both
directions, then change the model so the pace matches better.

**Architecture:** A new pipeline step bakes GOES-16 fire pixels into `goes.json` (same shape as `firms.json`). A
pure module `pacing.ts` computes front lag and overrun per fire and per observation time; `calibrate.ts` uses it
as the fit target (GOES) and the test (VIIRS/MODIS) and writes the numbers to `validation.json`, which the panel
shows. The structural change is picked from the diagnosis among three documented candidates.

**Tech Stack:** Python 3.12 + uv (numpy, rasterio/GDAL netCDF driver, requests, pytest); TypeScript, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-22-fire-pacing-backtest-design.md`

## Global Constraints

- Everything on `main` by 05:30 (America/Santiago); one PR, conventional-commit title.
- Ignition presets are not changed. No suppression model. Window 2 Feb 12:00 – 3 Feb 00:00 for scoring.
- Satellite is the reference; press anchors are printed and shown, never in the objective.
- Fit on GOES-16 + Sentinel-2 scar; VIIRS/MODIS reported as out-of-sample test.
- No new dependencies; GDAL's netCDF driver (in rasterio's wheel) reads GOES files.
- Never fail silently: a missing GOES slot or an unparseable file stops the bake with a clear message.
- UI copy in Spanish; code, identifiers, docs in English. No game language.
- Engine run stays under ~150 ms on the real dataset.

## Review Focus

- A fire region with no detection yet at time t (early frames): lag is undefined and skipped, never scored as 0.
- The model never reaches the observed front by the horizon: lag is censored at a documented cap (180 min), never
  Infinity or NaN inside an RMS.
- An isolated GOES false alarm far from the fire: dropped by a persistence filter (another GOES pixel within
  3 km and 30 min), so one hot pixel cannot move the observed front.
- A GOES slot missing from the S3 listing: bake raises, naming the slot.
- Detections on the split longitude between fires: assigned by one constant, `FIRE_SPLIT_LON = -71.40`.

---

### Task 1: GOES-16 fire pixels in the pipeline

**Files:**
- Create: `pipeline/steps/goes.py`
- Modify: `pipeline/bake.py` (SOURCES, OUTPUTS, `validate_outputs`, `main`), `pipeline/README.md` (outputs table,
  method), `pipeline/tests/test_steps.py`

**Interfaces:**
- Produces: `web/public/data/goes.json`: list of `{lon, lat, timeLocal, satellite: "GOES-16 ABI", frp}` (exactly
  the `FirmsPoint` keys), sorted by `(timeLocal, lat, lon)`.
- `fixed_grid_to_lonlat(x_rad: np.ndarray, y_rad: np.ndarray, lon0_deg: float, h_m: float, r_eq: float, r_pol: float) -> tuple[np.ndarray, np.ndarray]`
  (GOES-R PUG vol. 3 §5.1.2.8.1 formulas).
- `FIRE_MASK_CODES = {10, 11, 12, 13, 14, 30, 31, 32, 33, 34}` (low-probability 15/35 excluded).
- `bake() -> tuple[list[dict], dict]` like `firms.bake`.

- [ ] **Step 1: Failing tests** in `test_steps.py`:
  `test_goes_fixed_grid_pug_example`: `fixed_grid_to_lonlat(np.array([-0.024052]), np.array([0.095340]), -75.0, 35786023.0, 6378137.0, 6356752.31414)`
  → lat 33.846162 ± 1e-4, lon −84.690932 ± 1e-4.
  `test_goes_mask_codes`: 13 and 30 in `FIRE_MASK_CODES`; 15, 35, 0, 40 not.
- [ ] **Step 2:** `cd pipeline && uv run pytest -k goes` → FAIL (no module).
- [ ] **Step 3: Implement `steps/goes.py`.** List `ABI-L2-FDCF/2024/{doy}/{hh}/` keys from
  `https://noaa-goes16.s3.amazonaws.com/?list-type=2&prefix=…` for 2 Feb 15 UTC … 3 Feb 06 UTC; raise if any hour
  has fewer than 6 files. Cache in `.cache/goes/`. Read `netcdf:{f}:Mask` and `netcdf:{f}:Power` with rasterio;
  x_rad = projection x (m, from the GDAL transform) / perspective_point_height; projection constants from the
  file's tags (`goes_imager_projection#…`), raise if absent. Keep pixels with mask in `FIRE_MASK_CODES` whose
  centre has `grid.cell_index(lon, lat) >= 0`. Time = scan start (`s…` in the filename) + 5 min (mid-scan), UTC−3.
  FRP = Power (MW), NaN → 0 is not allowed: raise.
- [ ] **Step 4:** `uv run pytest` → PASS. Copy the scratch downloads into `.cache/goes/`, run `uv run python bake.py`;
  `goes.json` exists, summary prints pixels per hour.
- [ ] **Step 5:** wire into bake: SOURCES key "Detecciones de fuego GOES-16 (cada 10 min)", OUTPUTS, key check in
  `validate_outputs`. README row + method paragraph. Commit `feat(pipeline): bake GOES-16 fire pixels every 10 min`.

### Task 2: Loader for goes.json

**Files:** Modify `web/src/engine/types.ts` (doc comment: goes.json uses `FirmsPoint`), `web/src/data/load.ts`,
`web/src/data/load.test.ts`.

**Interfaces:**
- `parseFirePoints(file: string, j: unknown): FirmsPoint[]`; `parseFirms = (j) => parseFirePoints('firms.json', j)`;
  `parseGoes = (j) => parseFirePoints('goes.json', j)`. Not loaded by the browser app (Node scoring only).

- [ ] **Step 1:** test `parseGoes rejects a point without frp` (throws `DataError` naming `goes.json`).
- [ ] **Step 2:** `pnpm vitest run src/data` → FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(data): parse goes.json`.

### Task 3: Two-sided pacing back test

**Files:** Create `web/src/engine/fire/pacing.ts`, `web/src/engine/fire/pacing.test.ts`; modify
`web/src/engine/fire/calibrate.ts`.

**Interfaces:**
- `FIRE_SPLIT_LON = -71.40`; `type FireId = 'west' | 'east'`; `fireOf(lon: number): FireId`.
- `interface Obs { lon: number; lat: number; tMin: number }`.
- `persistentObs(obs: Obs[], radiusKm = 3, windowMin = 30): Obs[]` — keeps points with another point within
  radius and |Δt| ≤ window (different time).
- `frontCurve(arrival: Float32Array, grid: GridMeta, origin: [lon, lat], inFire: (cell) => boolean, binKm = 0.1): Float64Array`
  — element k = earliest arrival among cells at distance ≥ k·binKm from origin.
- `observedFrontKm(obs: Obs[], origin, tMin): number | null` — max distance of obs with `tMin ≤ t`; null if none.
- `frontLagMin(curve, binKm, dObsKm, tMin, halfPixelKm, capMin = 180): number` — 0 if the model front at t is within
  ±halfPixel of dObs; else (time the model reaches dObs ∓ halfPixel) − t, clamped to ±cap (documented cap).
- `overrunHa(arrival, grid, inFire, obsUpToT: Obs[], tMin, radiusM): number`.
- `HALF_PIXEL_KM = { goes: 1.0, viirs: 0.19, modis: 0.5 }`, `FOOTPRINT_M = { goes: 2000, viirs: 750, modis: 1500 }`.

- [ ] **Step 1: Failing tests** (synthetic radial fire, arrival = distance/0.05 km·min⁻¹):
  `frontLagMin` (halfPixel 0) = 0 when dObs equals the model front at t; = +40 when dObs is 2 km beyond it
  (model late); = −40 when dObs is 2 km short of it (model early); = +180 when the model never reaches dObs.
  With halfPixel 1 km and dObs 0.5 km beyond the model front → 0. `observedFrontKm` → null with no obs ≤ t.
  `persistentObs` drops a single point 10 km away; keeps two points 1 km / 10 min apart.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS.
- [ ] **Step 5: Wire into `calibrate.ts`.** Load `goes.json` (persistent-filtered), FIRMS split by sensor (VIIRS,
  MODIS). For each fire and each GOES frame 12:00–24:00: lag; `rmsLag[fire]`; `lagScore = max(0, 1 − rms/120)`
  averaged over fires. Objective = mean(lagScore, Dice, building F1) (press timing removed from the objective,
  still printed). Test table per VIIRS/MODIS pass ≤ 24:00 and per fire: observed km, model km, lag, overrun ha.
  Night passes printed as informative. `validation.json` gains
  `pacing: { fit: { sensor, rmsLagMin: {west, east} }, test: [{ time, satellite, fire, obsKm, modelKm, lagMin, overrunHa }] }`.
- [ ] **Step 6:** `pnpm validate` runs, prints both tables. Commit `feat(fire): two-sided pacing back test vs GOES-16 and FIRMS`.

### Task 4: Diagnose and change the structure

**Files:** `web/src/engine/fire/model.ts`, `index.ts`, `index.test.ts` or `model.test.ts`, `MODEL.md`.

- [ ] **Step 1:** From Task 3's output, plot observed vs model front km over time per fire (scratch); state in one
  paragraph which phase is off and by how much. Report to Anaís before coding.
- [ ] **Step 2:** Implement the candidate the diagnosis points to, each behind a `FIRE_MODEL` knob whose neutral
  value reproduces today's model:
  (a) `accelerationMin`: ROS × (1 − exp(−Δt/τ)) with Δt = minutes since that fire's ignition (relative, follows
  the user's ignition); (b) `spotWindSource: 'mean' | 'gust'` and `spotDistancePerSourceRos`: D_max from gusts and
  scaled with the source head ROS; (c) `fuelMoistureLagMin`: grass moisture follows an exponential lag of the
  weather's equilibrium value.
- [ ] **Step 3:** unit test: neutral knob = identical arrival grid to today on a small synthetic grid; non-neutral
  changes it in the expected direction. **Step 4:** `pnpm test` PASS; run time measured with `pnpm validate`.
- [ ] **Step 5:** MODEL.md section for the mechanism with source. Commit `feat(fire): <mechanism>`.

### Task 5: Refit, validation, docs

**Files:** `calibrate.ts` (scan grid adds the new knob), `index.ts` defaults, `public/data/validation.json`,
`web/src/ui/Panel.tsx` (Validación copy), `MODEL.md` §6, `agent-kb/decisions.md` (D-027), session log, backlog.

- [ ] **Step 1:** `pnpm exec tsx src/engine/fire/calibrate.ts --scan`; pick the top config on the fit objective;
  record the before/after table (fit RMS lag, test lag per pass, Dice, buildings, run ms).
- [ ] **Step 2:** set defaults; `pnpm validate` writes `validation.json`.
- [ ] **Step 3:** Panel: one paragraph "Ritmo del avance": GOES RMS lag per fire (en muestra) and VIIRS/MODIS lag
  per pass (fuera de muestra), sober wording.
- [ ] **Step 4:** `make check` PASS. Commit `feat(fire): recalibrate pace against satellite passes`.
- [ ] **Step 5:** D-027, session log, backlog; commit `docs: …`.

### Task 6: PR

- [ ] Push branch, open PR to `main` (draft until `make check` is green, then ready), body with before/after table
  and the builder calls. End body with the Claude Code attribution line.
