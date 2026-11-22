# Fire-spread engine: model notes

`simulateFire(input)` (`index.ts`) returns the time the fire reaches each cell, starting from the ignitions
and stopping at `params.horizonMin`. The formulas are in `model.ts`, and every calibration knob is in
`FIRE_MODEL`. This is a scenario-exploration model for prevention and planning. It is not a forecast.

## 1. Rate of spread on flat ground (head fire)

Inputs: V is the 10 m wind (km/h), H is relative humidity (%), T is temperature (°C), DF is the drought
factor (0..10) and C is grass curing (%).

| Fuel | Model |
|---|---|
| FOREST (W = 20 t/ha), SHRUB (W = 12 t/ha) | McArthur Mk5 forest meter as equations (Noble et al. 1980): FFDI = 2 exp(−0.45 + 0.987 ln DF − 0.0345 H + 0.0338 T + 0.0234 V); R = 0.0012 · FFDI · W km/h |
| GRASS | CSIRO grassland model, natural pasture (Cheney, Gould & Catchpole 1998): U < 5: R = (0.054 + 0.209 U) φM φC; U ≥ 5: R = (1.4 + 0.838 (U − 5)^0.844) φM φC km/h. MC = 9.58 − 0.205 T + 0.138 H; φM = exp(−0.108 MC) if MC < 12, otherwise 0.684 − 0.0342 MC (U < 10) or 0.547 − 0.0228 MC, never below 0 (moisture of extinction); φC = 1.12 / (1 + 59.2 exp(−0.124 (C − 50))) |
| CROP | 0.6 × grass |
| URBAN_LOW | 0.5 × grass |
| URBAN_DENSE | 0.35 × grass (spread from one structure to the next; embers matter more) |
| NONE | does not burn |

Then each model gets its calibration factor (`FIRE_MODEL.modelFactor`, section 6), and everything is
multiplied by `params.rosMultiplier`.

## 2. Wind and slope as one vector

The slope comes from the DEM by central differences (one-sided at the grid edges). Slope is capped at 40°
(`maxSlopeDeg`): McArthur's slope rule was fitted on slopes up to about 20°, and steeper cells in a 30 m DEM
are cliffs, cuts or artefacts.

- The wind vector is V along the direction the wind blows toward (`windFromDeg + 180`).
- The slope gives an equivalent wind U_s = (0.069 / 0.0234) · slope° ≈ 2.95 km/h per degree, pointing
  upslope. This makes exp(0.0234 U_s) = exp(0.069 slope), McArthur's rule that spread doubles every 10°.
- W_eff = wind vector + U_s · (upslope unit vector), and U = |W_eff|. The head direction is the direction
  of W_eff.
- The head ROS is R_head = R_flat(V) · exp(0.0234 (U − V)).
  - For McArthur fuels this equals R_flat(U), exactly as specified.
  - For grass-based fuels it applies McArthur's slope rule: ×2 per 10° upslope with the wind, ÷2 per 10°
    downslope.
  - **This deviates from the spec on purpose.** The spec fed U into Cheney's wind curve. With that, a 10°
    slope in calm air would make grass spread about 150× faster, and a wind blowing straight downhill
    would almost stop it.

## 3. Fire shape

- Length-to-breadth ratio: LB = 1 + 8.729 (1 − exp(−0.030 U))^2.155 (Alexander 1985), with U = |W_eff|.
- Eccentricity: e = √(1 − 1/LB²).
- Spread at angle φ from the head: R(φ) = R_head (1 − e) / (1 − e cos φ). This is the polar ellipse with
  the ignition at a focus (Van Wagner 1969).

## 4. Propagation

The engine runs a minimum-travel-time search (Finney 2002), implemented as a time-dependent Dijkstra over
typed arrays with an indexed binary heap (`heap.ts`).

- **Stencil:** 16 neighbours, made of the 8 adjacent cells and 8 knight moves.
- **Settling a cell:** when a cell settles at time t, its head ROS, direction and eccentricity come from the
  weather at t. The weather is linearly interpolated, wind direction along the shorter arc, and held
  constant outside the series.
- **Travel time:** each neighbour gets travel time = distance / R(φ), using the source cell's ellipse.
- **Unburnable cells:** NONE and firebreak cells never burn.
- **Knight moves:** both cells the move passes between must be burnable.
- **Diagonal moves:** a diagonal may not cut a corner between two unburnable cells, so 8-connected
  firebreak lines are watertight. This rule is an addition to the spec.
- **Outputs:** `arrivalMin` (Infinity if the fire never arrives), `rosMPerMin` (head ROS at arrival, 0 if
  unburned), `burnedCells`, `elapsedMs`.

### Grid anisotropy and "anchors" (an addition to the spec)

A 16-direction stencil leaves gaps of up to 26.6° between move directions. With an elongated ellipse
(e ≈ 0.97 at 30 km/h), a head that points between two stencil directions has to zig-zag. On those
zig-zag moves R(φ) drops to about 55 % of R_head, so the head runs about 45 % slower depending only on how
the wind lines up with the grid.

The fix is any-angle relaxation in the style of Theta* (Nash et al. 2007):

- Every cell remembers its anchor, the cell whose ellipse gave it its time.
- When a neighbour j is relaxed from cell i, the engine also tries the straight line from i's anchor a,
  using a's ellipse: t_a + |aj| / R_a(φ_aj).
- This only applies while j and a have the same fuel, |aj| ≤ 8 cells (`anchorMaxCells`), and the head at
  i stays within 25 % ROS and 20° of the head at a. Otherwise the chain restarts at i.
- Topology is unchanged: j must still be a legal neighbour of i.

`bench.ts` measures how far the head gets as a fraction of R·t, on flat grass with a 30 km/h wind. The
bearings 90°, 63.4° and 45° are stencil directions; 76.7° and 54° lie between them.

| Head bearing | 90° | 76.7° | 63.4° | 54° | 45° |
|---|---|---|---|---|---|
| With anchors | 1.00 | 0.96 | 0.99 | 0.97 | 0.99 |
| Plain 16-neighbour stencil | 1.00 | 0.56 | 0.98 | 0.73 | 0.99 |

`index.test.ts` checks the 76.7° case. Set `anchorMaxCells = 0` to get the plain spec behaviour.

## 5. Spotting

Spotting runs only when `params.spotting` is on. It starts from settled FOREST, SHRUB, URBAN_LOW or
URBAN_DENSE cells when the 10 m wind (not the slope) is at least 15 km/h.

- **Jump edges:** they go downwind, ±1 cell sideways, to burnable cells from 3 cells away up to
  D_max = `spotMetresPerKmh` · V metres.
- **Travel time:** 4 min + 10 min · d / D_max.
- **Crossing breaks:** jumps skip the cells in between, so embers cross a firebreak narrower than D_max.
  `index.test.ts` checks that a 60 m break stops the fire without spotting and is crossed with spotting
  in a 45 km/h wind.

**Source-intensity gate (an addition to the spec):** only cells whose head ROS is at least
`spotMinSourceRosMPerMin` (15 m/min) throw embers.

- Without the gate, spotting is deterministic from every eligible cell. It then moves the front downwind at
  about D_max / 14 min ≈ 0.86 · V m/min whatever the fuel moisture, and it keeps going all night as long as
  the wind is above 15 km/h.
- On the real domain, the ungated version burned 52,969 ha against a 9,467 ha scar.
- Set the gate to 0 to get the spec behaviour.

## 6. Calibration (`calibrate.ts`)

Run `pnpm exec tsx src/engine/fire/calibrate.ts`, or add `--scan` for a grid search. It uses the baked
dataset, the historical ERA5 weather, the two preset ignitions and an 18 h horizon. It scores the burned
cells against the Sentinel-2 scar, ignoring no-data cells.

`pnpm validate` runs it and writes `public/data/validation.json`, which the app's "Validación" section shows.
Numbers measured on 2026-11-22 00:25 (scar 9,467 ha; Dice = F1 = 2·IoU/(1+IoU)):

| Setup | Dice | IoU | Burned by 06:00 |
|---|---|---|---|
| Spec as written (model factors 1, no gate), spotting on | 0.30 | 0.18 | 52,969 ha |
| McArthur ×3, grass ×0.25, gate 15 m/min, spotting 12 m per km/h, wind ×1 | 0.46 | 0.30 | 9,057 ha |
| Spotting 25 m per km/h, urban as spec (×0.5 / ×0.35, urban embers on) | 0.52 | 0.35 | 20,226 ha |
| **Shipped defaults:** spotting 25, URBAN_LOW ×0.25, URBAN_DENSE ×0.05, no embers from urban cells, scored at **00:00** | **0.57** | 0.40 | 15,576 ha |

- **Spotting 25 m per km/h** (≈ 700 m at the afternoon's 28 km/h): with 12 m per km/h the western front was
  still ~9 km south of Viña del Mar at 18:30, while the real fire was in Villa Independencia around then
  (press reports). With 25 the front reaches lat −33.045 (Villa Independencia) at 19:00 under the unmodified
  ERA5 wind, and 203 of the 237 NASA FIRMS detections of 2 Feb are already reached by the model at the
  satellite's detection time. Eucalyptus spotting of 0.5–2 km is common, so 700 m is conservative.
- **The cost:** the model has no suppression, so it keeps spreading at night; the simulation therefore stops at
  midnight (`horizonMin` 12 h). With the spec's urban factors the fire ran through dense Viña overnight (about
  53,000 buildings reached against ~6,500 inside the real scar), so built-up cells now spread much slower and
  do not throw embers. Even so the model reaches only ~1,900 of the 6,505 buildings inside the scar while
  reaching many outside it: where in the city it burns is the weakest part of the model.

- **McArthur ×3:** Project Vesta (Cheney et al. 2012) found that the Mk5 meter under-predicts summer
  spread in dry eucalypt forest by about 2–3×.
- **Grass ×0.25:** fitted to the scar. Much of the domain's WorldCover "grassland" is grazed or sparse
  cover, which spreads slower than Cheney's natural pasture.
- **Scope of the scores:** these IoUs measure agreement with one historical event under one reanalysis
  weather series. They are not an accuracy figure for predictions.

## 7. Performance (`bench.ts`)

`pnpm exec tsx src/engine/fire/bench.ts` runs a synthetic 464 × 529 grid of 60 m cells, with mixed fuels,
hills and a diurnal wind, on Node 26 on the author's laptop. It reports the median of 7 runs:

| Run | Time | Cells burned |
|---|---|---|
| Default params | 30 ms | 14 % |
| Spotting off | 14 ms | |
| Worst case (rosMultiplier 6) | 136 ms | 73 % |
| Worst case without anchors | 103 ms | |

On the real dataset a run takes 20–130 ms.

## 8. Known limitations

- The weather is a single point (ERA5), with no terrain-channelled winds and no gusts.
- Spotting is deterministic: there is no ember probability and no long-range spotting beyond D_max.
- Structures are modelled as a grass fraction. There is no building-to-building ignition model.
- Time-dependent Dijkstra assumes FIFO, meaning leaving later never arrives earlier. This holds only
  approximately when the weather changes quickly.
- With anchors, a cell's time can be slightly underestimated where the straight line from its anchor
  clips the corner of a firebreak or NONE cell. The topology is never affected.
- Slope makes the fire very elongated upslope, with LB up to about 7 at 20°, so fire backs down slopes very
  slowly.

## References

- Alexander, M.E. (1985). Estimating the length-to-breadth ratio of elliptical forest fire patterns. Proc. 8th Conf. Fire and Forest Meteorology, 287–304.
- Cheney, N.P., Gould, J.S., Catchpole, W.R. (1998). Prediction of fire spread in grasslands. Int. J. Wildland Fire 8(1), 1–13.
- Cheney, N.P., Gould, J.S., McCaw, W.L., Anderson, W.R. (2012). Predicting fire behaviour in dry eucalypt forest in southern Australia. Forest Ecology and Management 280, 120–131.
- Finney, M.A. (2002). Fire growth using minimum travel time methods. Can. J. For. Res. 32, 1420–1424.
- Nash, A., Daniel, K., Koenig, S., Felner, A. (2007). Theta*: any-angle path planning on grids. AAAI-07.
- Noble, I.R., Bary, G.A.V., Gill, A.M. (1980). McArthur's fire-danger meters expressed as equations. Aust. J. Ecol. 5, 201–203.
- Rothermel, R.C. (1972). A mathematical model for predicting fire spread in wildland fuels. USDA For. Serv. Res. Pap. INT-115.
- Van Wagner, C.E. (1969). A simple fire-growth model. Forestry Chronicle 45, 103–104.
