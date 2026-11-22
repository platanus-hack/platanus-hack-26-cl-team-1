# Fire pacing back test against satellite passes (design, short)

Date: 2026-11-22, 01:45. Deadline: everything on `main` by 05:30.

## Intent

Check that the simulated fire of 2 February 2024 advances at the right pace, by comparing it with satellite
observations at several moments of the afternoon, and change the model so it matches better. Today's validation
cannot see pacing errors in one direction: the FIRMS score ("detections already reached at detection time",
206/237) only penalises a model that is late, never one that is early. A scratch run of the shipped model shows
the western head is ahead of VIIRS by 1.3 km at 14:47, 3.0 km at 15:38 and 4.7 km at 16:27, while press reports
put it 45–80 min late in Viña. So the pace has the wrong shape (too fast early, too slow later), not just a
wrong level.

## Decisions taken with Anaís

- **Sources:** NASA FIRMS (already baked) **plus GOES-16** ABI fire detections every 10 min, to cover
  16:27–23:18, when no polar-orbiting satellite passed and the fire entered Viña del Mar.
- **Both fires:** western (Las Tablas → Viña) and eastern (Lo Moscoso, Quilpué / Villa Alemana), scored apart.
- **Satellite is the reference.** The four press arrival times stay as a reported contrast, not a target.
- **Allowed changes:** global scalars and model structure. **Ignitions are not changed.**
- **Out of sample:** fit on GOES-16 + the Sentinel-2 scar; report VIIRS / MODIS passes as the independent test.
- **Window:** 12:00–24:00 on 2 Feb (the app horizon). Night passes (02:06–03:46) are informative only.
- **Delivery:** one PR to `main` (pipeline step, back test, model change, refit, docs, session log).
- Coordination with Alonso (owner of "calibrate and validate"): done, by Anaís.

## Approaches

- **A, chosen: measure first, then pick the mechanism.** Bake GOES-16, build a two-sided back test, diagnose
  which phase is off, then change the structure with one or two documented mechanisms and refit scalars.
- **B: commit now to gust-driven / intensity-driven spotting.** Faster, but ERA5 wind barely changes between
  14:00 and 18:00 (25.8 → 27.7 km/h, gusts 54 → 59), so it is unlikely to create "slow then fast" alone.
- **C: a time-of-day ROS multiplier fitted to the satellite curve.** Rejected: it follows the 2 Feb clock even
  when the user changes wind or ignitions, which breaks the scenario simulator and the "no silent fudge" rule.

## Design

1. **`pipeline/steps/goes.py` → `web/public/data/goes.json`.** GOES-16 `ABI-L2-FDCF` (full disk, 10 min, public
   AWS bucket `noaa-goes16`) from 2 Feb 12:00 to 3 Feb 04:00 local. Fixed-grid x/y → lon/lat with the GOES-R
   projection formulas; keep pixels whose centre falls in the grid and whose fire mask is a fire category.
   Record time (scan start, local), lon, lat, mask code and FRP. New type in `types.ts`, parser + boundary
   validation in `data/load.ts`, source in `grid.json` → "Fuentes". Cached in `pipeline/.cache/goes/`.
2. **Two-sided back test (in `calibrate.ts`, `make validate`).** Per fire (split by longitude) and per
   observation time t:
   - *Front lag (minutes):* the observed front distance from the ignition at t (farthest cumulative detection)
     vs the time the model first reaches that distance. Negative = model early, positive = late.
   - *Overrun:* model area burned at t farther than one pixel footprint from any cumulative detection.
   - *Hit share:* as today (detections reached by t).
   - Fit score = GOES lag RMS (both fires, 12:00–24:00) + Dice vs scar + building F1. Test = VIIRS / MODIS lag
     and overrun, reported separately. Press anchors printed for contrast.
3. **Structural change, chosen from the diagnosis.** Candidates, each with a `FIRE_MODEL` knob, a test and a
   MODEL.md entry: (a) point-ignition acceleration / head-width dependence (Cheney & Gould 1995; McAlpine &
   Wakimoto 1991), slows the start; (b) spotting from gusts and source intensity, speeds up the afternoon run;
   (c) lagged fine-fuel moisture. Engine run time must stay under ~150 ms.
4. **Refit** with `calibrate.ts --scan` on the new fit score; update defaults, `validation.json` and the app's
   "Validación" section (new pacing numbers, labelled in / out of sample).
5. **Docs:** MODEL.md §6, `pipeline/README.md`, a decision entry (satellite pacing as calibration target, GOES
   source), session log, backlog.

## Non-goals and anti-goals

- No change to ignition points or times; no suppression model; no calibration on night passes; no map layer.
- Anti-goal: a fit that only works on the 2 Feb clock (approach C), or any number in the pitch without a script.

## Left to the builder (calls to report back)

The longitude split between fires, which GOES mask codes count as fire, the footprint radius per sensor, the
weights of the fit score, and which of (a)–(c) to implement after the diagnosis.

## Outcome (2026-11-22, 02:45)

- Built as designed: GOES-16 step, `pacing.ts`, fit on GOES, test on VIIRS/MODIS, press times shown only.
- Builder calls: fire membership by space-time linking through all sensors (4 km) instead of a longitude split
  (a third fire sits 13.6 km from Lo Moscoso); GOES fire = mask 10-14 and 30-34; footprint 750 m / 1.5 km /
  2 km; objective = mean(pace score, Dice, building F1); robust scan over ERA5 wind ×0.9 / ×1 / ×1.1.
- The Concón METAR (approved mid-way) made every score worse and was dropped; mechanisms (a) and (c) did not
  fit the data (both fires ran at the same clock time, ~16:30, at different ages; no model shows a weather
  change then); (b) was a knife edge. Shipped instead: McArthur ×4 and matorral at half of it, the only change
  better at all three winds. Numbers: `agent-kb/decisions.md` D-027, `web/src/engine/fire/MODEL.md` §6.
