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
| URBAN_LOW (intermix) | 0.5 × grass in the spec; shipped 0.25 (section 6) |
| URBAN_DENSE (consolidated) | 0.35 × grass in the spec; shipped 0.05, and embers do not ignite it (section 6) |
| NONE | does not burn |

Then each fuel gets its own factor (`FIRE_MODEL.fuels[...].factor`: SHRUB ×0.5 since the pace fit, CROP and the
urban fuels as in the table) and each model its calibration factor (`FIRE_MODEL.modelFactor`: McArthur ×4,
CSIRO grass ×0.25; section 6), and everything is multiplied by `params.rosMultiplier`.

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

### Defended cells (firefighters, optional)

`FireInput.defense` (from `src/engine/brigade`, only when "Bomberos" is on) gives each cell a window
[fromMin, toMin] and an intensity limit maxKwM. When the fire reaches a cell at t inside its window and the
cell's Byram fireline intensity I = 18,000 kJ/kg · w · R (w the fuel load in kg/m², 4.5 t/ha for grass-model
fuels; R the head ROS in m/s, `FIRELINE`) is at most maxKwM, the cell does not burn and becomes unburnable for
the rest of the run (the front passed while it was held). While a cell is held, diagonal and knight moves may
not pass between it and another held or unburnable cell, so a held line is as watertight as a firebreak.
Embers still jump it. Without `defense`, or with every fromMin = Infinity, the engine is bit-for-bit the same
(`index.test.ts`).

## 5. Spotting

Spotting runs only when `params.spotting` is on. It starts from settled cells whose fuel has `spotSource`
(shipped: FOREST and SHRUB) when the 10 m wind (not the slope) is at least 15 km/h.

- **Jump edges:** they go downwind, ±1 cell sideways, to burnable cells whose fuel has `spotTarget` (every
  burnable fuel except URBAN_DENSE, the consolidated city) from 3 cells away up to
  D_max = `spotMetresPerKmh` · V · `spotDistanceFactor` metres (the factor is 1 for every fuel as shipped).
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

**Two knobs that are in the engine but off (tested in section 6, "Pace against satellite passes"):**

- `spotIntensityExponent` (0 as shipped): D_max × (source head ROS / `spotRefRosMPerMin`)^exponent, at most
  × `spotMaxScale` (3). For one fuel, fireline intensity is proportional to ROS (Byram) and ember lofting grows
  with intensity (Albini 1979). Its best in-sample setting is a knife edge (section 6), so it stays at 0.
- `spotJitterSigma` (0 as shipped): a lognormal factor (mean 1) on each source cell's D_max, from a hash of
  (cell, `spotJitterSeed`), for ensembles. The median of an ensemble overburns (the fastest path wins), so it
  stays at 0.

### Probabilistic landings (drawn firebreaks)

The main result keeps the deterministic spotting above. When embers are on and the user draws firebreaks, the
panel also runs 8 members with random ember landings (`params.emberSeed` = 1..8, `src/worker/embers.ts`), each
seed once without and once with the drawn lines, and shows in how many members embers cross the lines and the
paired difference in households cut off. Only *where embers ignite* is random. The gates, the band, D_max and
the travel time are the calibrated ones above, and the "m por km/h" slider still sets D_max.

**The model.** For each source cell i that passes the gates when it settles at time t:

- Band: `bandCells = 3 · (kMax − spotMinCells + 1)`, with kMax = ⌊D_max / cellM⌋.
- Brands the source lofts into its band: B = `spotBrandsPerHa` · cellM² / 10⁴ (356 per ha = 128 per 60 m cell).
- Ignition probability of a brand on landing: P_ign(t) = Schroeder (1969), below, from the 10 m air temperature
  and the Cheney grass moisture MC of section 1, recomputed whenever the weather changes.
- Expected igniting brands per band cell, spread evenly over the band: λ_i = B · P_ign / bandCells.
- A jump edge i → j that would improve j's time is kept only if `hashPair(i, j, seed)` < p_i = 1 − exp(−λ_i)
  (`emberCellProbability`, written `-Math.expm1(-λ)`). Brands landing on a firebreak, an unburnable cell or a cell
  without `spotTarget` are lost.

**Why one draw per edge is exact.** The source lofts N ~ Poisson brands, each landing uniformly on a band cell
and igniting with probability P_ign. By Poisson thinning (the colouring theorem, Kingman 1993), the igniting
landings per cell are independent Poisson(λ_i) counts, and a spot fire starts when at least one lands, with
probability 1 − exp(−λ_i).

**Limits.** `emberSeed: null` takes no draws: every existing engine test is unchanged, and during review it was
compared bit for bit with `main`'s engine on the three events' data (24 scenarios; a one-off check). As
`spotBrandsPerHa` grows without bound, p = 1 exactly in floating point (every draw is < 1), so a seeded run equals
the deterministic one (`index.test.ts`): the main result is this model's B → ∞ limit.

**Schroeder (1969), eq. 10 and the fit printed below it** (`emberIgnitionProbability`):
Qig = 144.51 − 0.266 T − 0.00058 T² − T·M + 18.54 (1 − e^(−15.1 M)) + 640 M (cal/g; T in °C, M = MC / 100),
X = (400 − Qig) / 10, P = 0.000048 · X^4.3 / 50.

- 30 °C and 6 % give 0.53, the value of the usual ignition-probability tables.
- **Scale:** the printed fit is on Schroeder's index scale, about twice his own lognormal tail (σ = 0.139, mean
  log₁₀ Qig = 2.1761): he notes that the probability of 0.5 "has been raised to 1.0" for the index. His full-curve
  probability at 30 °C and 6 % is about 0.26. Only B · P_ign enters the model, and B is fitted, so the scale is
  absorbed; B counts brands relative to this scale, not physical firebrands.
- The fit passes 1 below Qig ≈ 149 cal/g, Schroeder's truncation point; P is capped at 1 there. It returns 0
  when X ≤ 0, which this domain never reaches (Qig is at most ≈ 312 cal/g, at 0 °C and RH 100 %).
- **An approximation:** Schroeder's inputs are fuel temperature and fine dead-fuel moisture; the engine feeds the
  10 m air temperature and Cheney's grass moisture. B absorbs a constant scale, not the shape or the cap.
- On Viña (`pnpm embers`), P_ign is 0.37 / 0.41 / 0.33 / 0.22 / 0.15 / 0.08 at 12:00 / 14:00 / 16:00 / 18:00 /
  20:00 / 22:00, i.e. 47 / 52 / 42 / 29 / 19 / 11 igniting brands per source cell. On the Talca afternoon it is
  0.60–0.75 (14:00–20:00); over the Eaton run (18:00 to 12:00) 0.20–0.37.

**Draws.** `hashPair(a, b, seed)` (`index.ts`): two chained lowbias32 rounds keyed on (source cell, target cell,
seed). The draw does not depend on the order cells are processed in or on any other draw, so a run is
deterministic per seed, and the runs with and without lines share every uniform (common random numbers). If a line
changes when source i settles, p_i moves monotonically against the same uniform. `index.test.ts` checks the
deciles of 10⁵ draws (10 % ± 0.5 % each) and that a fire the added break never touches stays bit-identical.

| Item | Status |
|---|---|
| Schroeder P_ign | Published (Schroeder 1969) |
| Cheney grass moisture | Published, already in the engine (section 1) |
| One Bernoulli draw per jump edge | Mathematical result (Poisson thinning, Kingman 1993) |
| Band geometry, wind and ROS gates, travel time 4 + 10 · d / D_max | Inherited calibration (this section and section 6) |
| Uniform landing across the band | The engine's existing modelling assumption, not a published distribution |
| `spotBrandsPerHa` = 356 | **The only fitted scalar** (below) |

**Fit** (`pnpm exec tsx src/engine/fire/calibrate.ts --embers`, which prints only and writes no file): the robust
objective of section 6 (mean over ERA5 wind ×0.9 / ×1 / ×1.1 of pace score, Dice and building F1), scored on the
per-cell median arrival of 8 members (seeds 1–8):

| Brands per ha (per 60 m cell) | Robust objective | Dice at ×0.9 / ×1 / ×1.1 | Buildings in scar at ×1 |
|---|---|---|---|
| Deterministic (main result) | 0.470 | 0.650 / 0.639 / 0.616 | 5,784 |
| 178 (64) | 0.460 | 0.632 / 0.656 / 0.644 | 4,365 |
| 267 (96) | 0.487 | 0.640 / 0.654 / 0.633 | 5,315 |
| **356 (128), shipped** | **0.487** | 0.650 / 0.653 / 0.628 | 5,646 |
| 533 (192) | 0.483 | 0.649 / 0.647 / 0.622 | 5,736 |
| 711 (256) | 0.475 | 0.650 / 0.644 / 0.619 | 5,774 |

- The optimum is flat from 267 to 356 per ha; 356 is the end closer to the deterministic run (buildings in scar).
- At 178 per ha the western head stalls at wind ×0.9 (GOES RMS lag west 120 min, 1,832 buildings in the scar): a
  percolation knife edge, as with the intensity-scaled embers of section 6.
- One-off, from a scratch prototype during the design: a constant "every landing ignites" (P_ign = 1) at its own
  best yield scored 0.486, the same as Schroeder in-sample. Schroeder is kept because it is published and makes
  humidity and temperature act on embers; Viña cannot tell the two apart.
- In-sample, one fire, flat optimum; Eaton (below) shows no gain out of sample.

**Viña 2024 and Eaton 2025, deterministic vs 32 members** (`pnpm embers`; no drawn lines; each event as the app
runs it: Viña alert 18:00, 2.9 persons per household, 50 % on foot; Eaton alert 19:25, 2.7, 4 %):

| Measure | Viña, deterministic | Viña, members: median [P10–P90] | Eaton, deterministic | Eaton, members |
|---|---|---|---|---|
| Area (burnedCells) | 18,008 ha | 17,173 [16,995–17,301] ha | 14,942 ha | 14,522 [14,353–14,684] ha |
| Dice vs the scar, per member | 0.639 | 0.649 [0.646–0.652] | 0.344 | 0.338 [0.336–0.349] |
| Burned in ≥ half the members | – | 17,264 ha, Dice 0.649 | – | 14,595 ha, Dice 0.338 |
| Households cut off at the alert | 4,061 | 3,763 [3,696–3,829] (−7.3 %) | 1,670 | 1,585 [1,561–1,613] (−5.1 %) |

(burnedCells counts every cell; section 6 scores 17,934 ha because it skips the scar's no-data cells.)

**Talca: an 8 km line drawn across the fire's path** (built in `ember-ensemble.ts`: perpendicular to the head bearing at the
17:00 alert, 28°, centred 1 km from the 14:00 ignition), the same 32 seeds without and with it, summarised with the
panel's own `summariseEmbers`. Without the line: 10,580 [10,511–10,585] households cut off.

| Width | Cells | Reached | Crossed | Households with the line | Saved (paired), median [P10–P90] | % | Spot fires beyond |
|---|---|---|---|---|---|---|---|
| 30 m | 182 | 32/32 | 32/32 | 10,053 [10,017–10,060] | 527 [480–531] | −5.0 [−4.6, −5.0] | 127 [125–128] |
| 60 m | 182 (the same cells) | 32/32 | 32/32 | 10,053 [10,017–10,060] | 527 [480–531] | −5.0 [−4.6, −5.0] | 127 [125–128] |
| 90 m | 202 | 32/32 | 32/32 | 10,053 [10,017–10,060] | 527 [480–531] | −5.0 [−4.6, −5.0] | 123 [121–124] |
| 120 m | 274 | 32/32 | 32/32 | 10,000 [9,963–10,003] | 580 [537–586] | −5.5 [−5.1, −5.5] | 81 [79–83] |

- The fire reaches the line at 14:45 and the first spot fire beyond it starts at 14:59 (medians, every width).
  The 14 min come mostly from the travel-time formula, so the panel does not report "minutes bought".
- References, one run each: deterministic spotting 10,582 → 10,055 (30, 60 and 90 m) and 10,001 (120 m), crossed;
  embers off 2,534 → 107, never crossed.

**Sensitivity on the 120 m line** (same line, 32 paired members):

| Variant | Deterministic: without → with | Crossed | Saved (paired), median [P10–P90] | % |
|---|---|---|---|---|
| Wind ×0.55 | 1,842 → 217, not crossed | 0/32 | 1,625, every member | −88.2 |
| Wind ×0.6 | 1,828 → 199, not crossed | 0/32 | 1,629, every member | −89.1 |
| Wind ×0.65 | 1,988 → 1,535, crossed | 32/32 | 454, every member | −22.8 |
| Wind ×0.7 | 2,079 → 1,534, crossed | 32/32 | 546, every member | −26.2 |
| RH +30 points | 4,619 → 3,843, crossed | 32/32 | 687 [440–775] | −15.5 [−10.9, −18.3] |
| 1 brand per cell (2.8 per ha; no longer reproduces Viña) | 10,582 → 10,001, crossed | 32/32 | 2,168 [1,063–5,242] | −31.5 [−15.3, −71.7] |

**What this does and does not show.**

- **Crossed or not is a step function of the inherited gates** (wind ≥ 15 km/h, source head ROS ≥ 15 m/min), not
  of ember chance. On Talca it switches between wind ×0.6 (0 of 32) and ×0.65 (32 of 32), and on both sides of the
  step every member equals the deterministic run. An 8 km line meets thousands of independent jumps, so even at
  about 1 brand per cell it is crossed in every member. The count is nearly always 0 of N or N of N; it is not a
  breach rate.
- **The spread is ember chance only:** not uncertainty in the model, the weather or the ember reach. In hot, dry
  weather nearly every edge is kept and the range collapses (Talca at wind ×0.65–0.7).
- **Width barely matters at 60 m cells.** 30 and 60 m rasterise to the same one-cell trace, 90 m adds 20 cells,
  120 m is two cells. A wider line drops more brands on bare ground and lengthens the shortest jumps (spot fires
  beyond the line 127 → 81), so the paired saving grows from 5.0 % to 5.5 %; it never changes whether the line is
  crossed. Fireguard-width rules apply "in the absence of spotting" (Alexander 2001). There is no sub-cell width and no surface-breaching model.
- **The ensemble sits a few % below the main result** (Viña −7.3 % households, Eaton −5.1 %) because not every
  landing ignites. The panel leads with the paired difference and says so.
- **Stability.** Medians of the 4 disjoint 8-seed blocks: Viña households 3,745 / 3,763 / 3,791 / 3,753 (32
  members: 3,763); Eaton 1,585 / 1,574 / 1,595 / 1,590 (1,585); Talca 120 m saved 581 / 561 / 579 / 575 (580).
  That is in hot, dry weather, where nearly every edge is kept. With more humid air the 8-member median moves much
  more: Talca 120 m at RH +30 points saved 497 / 733 / 595 / 717 by block (32 members: 687), and at about 1 brand
  per cell 2,691 / 2,899 / 1,746 / 1,972. The panel always uses seeds 1–8 and shows their P10–P90 range, which is
  wide exactly when its median is unstable.
- **Cost** (`pnpm embers`, Node 26.12.1, medians): fire 42 ms on Viña, 31 ms on Eaton, 34 ms on Talca; evacuation
  41, 52 and 31 ms. The panel's 8 paired members are 16 fires and 16 evacuations; not timed in the browser worker.
- The crossing report samples each jump every quarter cell and can miss or double-count at line corners. It only
  reports; it never changes the fire (`index.test.ts`).

**Considered and not adopted.**

- **RandomFront 2.3** (Trucchia et al. 2019), eq. 12 and eq. 10 with their Table 1 constants, at I = 5 MW/m,
  r = 3 cm, U = 7.8 m/s: the distance parameter μ comes out at 5.6 cm in consistent SI units, or 5.6 km if I is
  taken in W/m with Hc in kJ/kg, and σ = 5.9. Neither is a usable landing distance (recomputed once during the
  design; one-off).
- **Sardoy et al. (2008)** lognormal landing distances, coefficients as given by López-De-Castro et al. (2024),
  eqs. 6–8 (Sardoy's paper itself was not read). One-off measurements from a scratch prototype during the design,
  not reproduced by this repo's scripts: with one fitted yield (200 igniting embers per ha) the robust objective
  was 0.508, the Viña P ≥ 0.5 Dice 0.676 and the Eaton Dice ≈ 0.41 (vs 0.470, 0.639 and 0.344), but Viña households
  cut off fell to 2,681 (−34 %) and building recall to 0.69 (vs 0.89); fire runs took 55–69 ms; and in the
  buoyancy-driven regime weaker wind throws embers farther (Talca at wind ×0.7: 8,234 households vs 2,079
  deterministic). It would change the main result, its coefficients are second-hand and their validity range
  unknown, so it stays a candidate for a full recalibration (backlog).

## 6. Calibration (`calibrate.ts`)

Run `pnpm exec tsx src/engine/fire/calibrate.ts`, or add `--scan` for a grid search (`--embers` fits the
probabilistic landings of section 5 and writes no file). It uses the baked
dataset, the historical ERA5 weather (direction corrected, see below), the two preset ignitions and the UI horizon (midnight). It scores the burned
cells against the Sentinel-2 scar, ignoring no-data cells.

`pnpm validate` runs it and writes `public/data/validation.json`, which the app's "Validación" section shows.
Numbers measured on 2026-11-22 00:25, last row at 02:30 (scar 9,467 ha; Dice = F1 = 2·IoU/(1+IoU)):

| Setup | Dice | IoU | Burned by 06:00 |
|---|---|---|---|
| Spec as written (model factors 1, no gate), spotting on | 0.30 | 0.18 | 52,969 ha |
| McArthur ×3, grass ×0.25, gate 15 m/min, spotting 12 m per km/h, wind ×1 | 0.46 | 0.30 | 9,057 ha |
| Spotting 25 m per km/h, urban as spec (×0.5 / ×0.35, urban embers on) | 0.52 | 0.35 | 20,226 ha |
| Spotting 25, URBAN_LOW ×0.25, URBAN_DENSE ×0.05, no embers from urban cells, scored at 00:00 (before the urban fix below) | 0.57 | 0.40 | 15,576 ha |
| The above + WUI fuel split, no embers on consolidated city, ERA5 direction −10°, scored at **00:00** | 0.63 | 0.46 | 18,043 ha (by 00:00) |
| **Shipped:** the above + McArthur ×4 and matorral at half of it (pace fit, below) | **0.64** | 0.47 | 17,934 ha (by 00:00) |

- **Spotting 25 m per km/h** (≈ 700 m at the afternoon's 28 km/h): with 12 m per km/h the western front was
  still ~9 km south of Viña del Mar at 18:30, while the real fire was in Villa Independencia around then
  (press reports). Eucalyptus spotting of 0.5–2 km is common, so 700 m is conservative. The model has no
  suppression, so it keeps spreading at night; the simulation therefore stops at midnight (`horizonMin` 12 h).

### Where in the city it burns (fix of 2026-11-22, 01:30)

**Diagnosis.** With the previous defaults the model reached 21,339 buildings by midnight but only 1,875 of the
6,505 inside the scar. Two causes, measured with scratch scripts and confirmed by `calibrate.ts`:

1. **The western head went NNE instead of N.** ERA5 blows from 195–207° in the afternoon, so the downwind
   embers (which drive the spread: with spotting off the fire covers 2,473 ha) pushed the head toward ~20°,
   into flat, dense Quilpué at 18:00–19:00. The scar's main axis from Las Tablas is ~5°, and the FIRMS
   northernmost points lie at 1–10°; the real fire ran to El Salto and the Jardín Botánico (17:00–18:00) and
   crossed into El Olivar and Villa Independencia (burning at 18:30). No other gridded model shows a more
   southerly wind (GFS, ICON, GEM, UKMO, JMA, ARPEGE all 190–225°:
   https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=-33.17,-33.10,-33.04&longitude=-71.51,-71.50,-71.50&start_date=2024-02-02&end_date=2024-02-02&hourly=wind_speed_10m,wind_direction_10m&models=gfs_global,icon_global,gem_global,ukmo_global_deterministic_10km,jma_gsm,meteofrance_arpege_world&timezone=America%2FSantiago),
   and the Concón airport METAR (SCVM) reads 220° at 16:00–18:00
   (https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=SCVM&data=drct&data=sknt&year1=2024&month1=2&day1=2&year2=2024&month2=2&day2=3&tz=America%2FSantiago&format=onlycomma).
2. **Interior city blocks burned like the wildland-urban interface.** Embers landed on any burnable cell, so
   12,911 of the 19,464 out-of-scar buildings were in cells reached through an ember landing on an urban cell.
   Burned urban cells sit next to vegetation: URBAN_DENSE cells inside the scar have a median 0.24 share of
   shrub/forest within ±210 m and are 60 m from it; the ones wrongly burned in Quilpué, 0.04 and 180 m. The
   previous split by roof coverage could not see that (3,663 of the 6,505 in-scar buildings were "dense").

**Fixes, all from pre-fire inputs plus global scalars:**

- **Fuel layer (`pipeline/steps/wui.py`):** built-up cells are split by the vegetation within 180 m
  (WorldCover 2021 + Sentinel-2 NDVI of 2024-01-18): ≥ 40 % green → URBAN_LOW, *intermix*; otherwise
  URBAN_DENSE, *consolidated*. Inside the scar 41 % of buildings are now intermix (11 % before); outside, 20 %.
  The scar is never read by the pipeline.
- **Embers do not ignite consolidated city** (`spotTarget: false` on URBAN_DENSE); intermix keeps them. Damage
  studies support the asymmetry: in seven central-Chile WUI fires, damage odds rose within ~60 m of vegetation
  (Aguirre et al. 2024, https://nhess.copernicus.org/articles/24/1521/2024/); in Australian fires the chance of
  destruction falls with distance from bushland and the furthest destroyed homes are usually < 700 m in
  (Chen & McAneney 2004, https://ui.adsabs.harvard.edu/abs/2004GeoRL..3112212C/abstract). Spread rates stay
  as before (intermix 0.25 × grass, consolidated 0.05 × grass).
- **ERA5 wind direction −10°** (`ERA5_WIND_DIR_CORRECTION_DEG`, applied to the historical series only, shown
  in the wind hint of the panel). This is **one fitted scalar, not an observation**: it stands in for terrain
  channelling along the N–S quebradas that a 0.25° reanalysis cannot resolve, and the only nearby station
  contradicts it (see above). Being a site fit, it belongs to the event, not to the model: it lives in
  `EventDef.windDirCorrectionDeg` (`src/data/events.ts`) and is 0 for any other event (section 6b).

**Before / after** (`pnpm validate`, horizon 00:00, scar 9,467 ha; anchors = first arrival within 300 m):

| Setup | Dice | Model ha | Buildings reached | In scar (recall) | Precision (≤ 120 m) | FIRMS | J. Botánico / Pompeya / El Olivar / V. Independencia | Objective |
|---|---|---|---|---|---|---|---|---|
| Before (roof split, embers everywhere, ERA5 as is) | 0.571 | 15,576 | 21,339 | 1,875 (0.29) | 0.09 (–) | 203/237 | 20:26 / 18:07 / never / never | – |
| Only the wind correction removed (0°) | 0.575 | 15,408 | 15,768 | 1,875 (0.29) | 0.12 (0.39) | 203/237 | 20:26 / 18:12 / never / never | 0.461 |
| Only embers allowed back on consolidated | 0.626 | 18,187 | 32,725 | 5,914 (0.91) | 0.18 (0.49) | 206/237 | 18:23 / 18:04 / 19:14 / 19:36 | 0.595 |
| Shipped until the pace fit (below) | 0.628 | 18,043 | 28,119 | 5,423 (0.83) | 0.19 (0.52) | 206/237 | 18:23 / 18:04 / 19:14 / 19:36 | 0.599 |
| Reported (press, CIGIDEN) | – | 9,467 | – | 6,505 | – | – | ~17:00 / 18:10 / < 18:30 / ~18:30 | – |

"Objective" = mean of Dice, building F1, FIRMS share and a timing score (1 at the reported time, 0 at 2 h off).
`calibrate.ts --scan` (wind −20…0°, intermix ×0.25/0.5/1, embers on consolidated yes/no, McArthur ×2/3/4) puts
−15°/×0.25 at 0.602, −10°/×0.25 at 0.599 and −10°/×0.5 at 0.597: the optimum is flat, so the shipped values
keep the old spread factors and the smaller rotation. −5° falls to 0.473 and 0° to 0.460: the result hinges
on the rotation. Precision is "share of reached buildings inside the scar"; the scar misses houses in
built-up cells (the Copernicus EMSR715 grading counts 333 ha of residential damage where the scar marks 225 ha
of built-up land, https://rapidmapping.emergency.copernicus.eu/backend/dashboard-api/public-activations/?code=EMSR715),
so the "≤ 120 m" column is the fairer reading.

**Honest caveats.**

- In-sample: the rotation and the urban rule were chosen on this same fire.
- The western head is ~45–65 min late at El Olivar / Villa Independencia and ~80 min late at the Jardín
  Botánico; the model's speed is ~40 m/min throughout, while the real head crawled until ~16:30 and then ran
  ~100 m/min.
- (Before the pace fit below.) The eastern fire (preset at 14:17) still burns sideways: 5,745 ha against ~1,300 ha of scar there, 4,756
  buildings reached of which 357 are in the scar.
- The model has no suppression, so precision stays low: about 28,000 buildings are reached against roughly
  6,000 homes destroyed (MINVU's preliminary count, 21 Feb 2024: 6,019 homes with non-repairable damage,
  https://www.minvu.gob.cl/noticia/ministro-montes-presenta-primeros-lineamientos-de-la-estrategia-de-reconstruccion-para-las-comunas-afectadas-por-los-incendios-en-la-region-de-valparaiso/).

- **McArthur ×4, matorral ×0.5 of it** (×3 for both until the pace fit below): Project Vesta (Cheney et al.
  2012) found that the Mk5 meter under-predicts summer spread in dry eucalypt forest by about 2–3×; ×4 is
  above that range and is a fit to this fire.
- **Grass ×0.25:** fitted to the scar. Much of the domain's WorldCover "grassland" is grazed or sparse
  cover, which spreads slower than Cheney's natural pasture.
- **Scope of the scores:** these IoUs measure agreement with one historical event under one reanalysis
  weather series. They are not an accuracy figure for predictions.

### Pace against satellite passes (2026-11-22, 02:30)

**Why.** The FIRMS score above ("detections already reached at detection time") only catches a model that is
late: a fire that burned everything at once would score 237/237. The pace back test scores both directions.

**Data.** GOES-16 ABI fire pixels every 10 min (`goes.json`, `pipeline/steps/goes.py`, ~2.5 km pixels) fill
the 16:27–23:18 gap between polar passes, exactly when the fire reached Viña del Mar. VIIRS (375 m) and MODIS
(1 km) passes from `firms.json` are the test set.

**Method (`pacing.ts`, run by `calibrate.ts`).**

- Each preset fire gets its own detections: a pixel belongs to it if it lies within 4 km of the ignition or
  of a detection of that fire seen at the same time or earlier, linking through all three sensors
  (`fireCluster`). This drops a third, unrelated fire at −71.286, −32.984 (15:25–16:55).
- Observed front at t = farthest detection of that fire seen by t. Each fire is also run alone, so its model
  front is measured without the other fire.
- **Front lag** = minutes the model is late (+) or early (−) at reaching the observed front. It is 0 within
  half a pixel (GOES 1 km, VIIRS 0.19 km, MODIS 0.5 km) and capped at ±180 min.
- **Overrun** = model area burned farther than one footprint (750 m VIIRS, 1.5 km MODIS) from every detection.
- **Fit:** RMS lag over the GOES frames 12:00–24:00 per fire. Objective = mean of the pace score
  (1 − RMS/120, both fires), Dice and building F1; the press times are printed, not scored.
- **Robust scan** (`calibrate.ts --scan`): each configuration is run at ERA5 wind ×0.9, ×1 and ×1.1 and
  ranked by the mean, so a setting that only works at one exact wind does not win.

**What the satellites show.**

- The western head stalled at 5.2–5.7 km from Las Tablas from 14:05 to 16:25. GOES saw it there, and VIIRS
  at 16:27 drew a straight east–west front at lat −33.145. Then it ran at ~100 m/min, reaching 21.1 km by
  19:05, and stopped there.
- The eastern fire also began its run at ~16:30. Both fires are 20 km apart and of different ages, which
  points to a regional cause.
- The first GOES pixel within 2 km of the Jardín Botánico is at 17:55 (press: ~17:00); for El Olivar and Villa
  Independencia it is 18:25 (press: ~18:30).
- The eastern preset ignition (14:17, approximate) is later than GOES's first pixels of that fire (14:15,
  2 km away); its first lags (+65 / +35 min at 14:35 / 15:05) measure that offset, not the pace.

**What was tried (wind ×0.9 / ×1 / ×1.1; RMS lag west, east; VIIRS/MODIS mean |lag|).**

| Setup | Robust objective | GOES RMS west (min) | GOES RMS east (min) | Test \|lag\| (min) | Dice | Buildings in scar |
|---|---|---|---|---|---|---|
| Before (McArthur ×3, matorral as forest) | 0.372 | 121 / 47 / 83 | 87 / 110 / 116 | 56 / 62 / 67 | 0.63 / 0.63 / 0.61 | 2,311 / 5,423 / 5,865 |
| Embers × source intensity (exp. 1, 20 m per km/h), old fuels | 0.353 | 131 / **28** / 117 | 128 / **22** / 113 | 48 / 44 / 79 | 0.53 / 0.64 / 0.60 | 391 / 2,673 / 5,436 |
| Ensemble, per-cell ember jitter σ 0.5, median of 7 (15 m per km/h) | 0.430 | 22 / 99 / 114 | 95 / 28 / 112 | 34 / 53 / 63 | 0.67 / 0.67 / 0.63 | 2,370 / 5,025 / 5,845 |
| Faster ember jumps (2 + 2 min, 12 m per km/h) | 0.444 | 22 / 63 / 103 | 133 / 19 / 87 | 23 / 49 / 70 | 0.65 / 0.66 / 0.64 | 1,802 / 3,533 / 5,770 |
| **Shipped: McArthur ×4, matorral ×0.5** | **0.470** | 34 / 55 / 83 | 24 / 76 / 98 | 27 / 55 / 62 | 0.65 / 0.64 / 0.62 | 3,004 / 5,784 / 5,971 |

- **Intensity-scaled embers** gave the best single run (28 / 22 min at wind ×1) but are a knife edge: at
  ±10 % wind (in `calibrate.ts`, and in the robust table) or at 19 or 21 m per km/h (one-off), the lag goes
  back to 100–130 min; while the real fire was still advancing it is worse than the shipped model (37 / 31
  min) (deterministic spotting has a
  percolation threshold, and with ERA5's near-constant afternoon the time it is crossed is arbitrary).
The next three bullets (METAR, Lago Peñuelas, grass ×0.8) are one-off measurements made with scratch scripts
during the fit, not reproduced by `calibrate.ts`:

- **Concón airport METAR (SCVM)** shows a NNW sea breeze until ~14:30, then SSW wind with 33–35 °C and 25–30 %
  RH (ERA5: 28–30 °C, 37–43 %). Blending it in made things worse: with its direction the western head never
  reaches Viña (Dice 0.28); with only its temperature and humidity, Dice 0.56 and objective 0.386 (vs 0.429).
  A coastal station 25 km north does not stand for the fire area. Seven other models (IFS, ICON, GFS, ARPEGE,
  GEM, JMA, UKMO; Open-Meteo historical forecast API) show smooth S–SSW afternoons with peak fire weather at
  13–15 h, none with a change at 16:30.
- **Lago Peñuelas:** 206 of its 524 water cells (Sentinel-2, Feb 2024) are CROP in WorldCover 2021 (dry lake
  bed). Making them unburnable changes no score; left as is.
- **Grass ×0.8** on top of the split scored 0.485 (vs 0.470) and was not shipped: the optimum is flat, and it
  would add one more fitted scalar.
- **The fuel split** (matorral half of forest) is the only change that is better at all three winds. It
  mainly fixes the eastern fire: its advance is on time with GOES from 16:05 to 18:05 and VIIRS tests at
  +21 / −3 / +4 min (before: −4 / −38 / −25).

**Most of the full-window RMS comes after the real fires stopped.** The observed front last grew at 19:05
(west) and 19:15 (east); after that the model keeps spreading (no suppression) and its lag falls by 10 min a
frame down to the cap. `calibrate.ts` reports both parts (`pacing.fit.rmsAdvanceMin` / `rmsAfterMin` in
`validation.json`):

| GOES RMS lag at wind ×1 (min) | West, advancing | West, after | East, advancing | East, after | VIIRS/MODIS \|lag\|, advancing |
|---|---|---|---|---|---|
| Before the pace fit | 30 | 63 | 39 | 154 | 42 |
| **Shipped** | **30** | 78 | **28** | 105 | **34** |

**Shipped at wind ×1** (`pnpm validate`): GOES RMS lag over 12:00–24:00 west 55 min (was 47), east 76 (was
110), and while advancing 30 (30) and 28 (39); VIIRS/MODIS mean |lag| 55 min (was 62), 34 (42) while advancing; Dice 0.639 (0.628); buildings in the scar 5,784 / 6,505 (5,423); FIRMS reached
193/237 (206: the one-sided score drops because the eastern fire is no longer early); households cut off at an
18:00 alert 4,061 (4,753, `../evac/MODEL.md`).

**Still wrong.** The western stall from 14:05 to 16:25 is not reproduced (the model is ~1 h early at 16:05 and
~40 min late at 19:05), and both fires keep spreading after ~19:30 when the real ones stopped (no suppression).
The pace grows worse with wind ×1.1 (RMS 83 / 98 min). Everything here is in-sample except the VIIRS/MODIS
test, and the test passes all fall before 16:30 except one.

## 6b. Out of sample: the Eaton fire, California, 7–8 January 2025 (`validate-event.ts`)

Everything above was fitted on one fire. `pnpm validate:eaton` (`make validate-eaton`) runs the model exactly as
shipped (`FIRE_MODEL`, `DEFAULT_FIRE_PARAMS`, no knob touched) on the Eaton fire's data, baked by the same
pipeline from the same global sources (`pipeline/bake.py --event eaton-2025`), and scores it against the
Sentinel-2 scar (same dNBR method) and the official final perimeter, at 12 h after the start (Viña's span) and
at the event's horizon (18 h: 18:00 on 7 Jan to 12:00 on 8 Jan, Pacific time). It runs with the event's own
wind-direction correction (0°, no site fit) and, for comparison, with Viña's −10°. It writes
`public/data/eaton-2025/validation.json`, shown in the app's "Validación" section.

**Result** (`pnpm validate:eaton`, real ERA5 ×1, spotting on, CAL FIRE ignition at 18:18; Sentinel-2 scar 4,246 ha,
official perimeter 5,689 ha; for comparison Viña's in-sample Dice is 0.639):

| Checkpoint | Model burns | Dice vs scar | Dice vs perimeter | Recall / precision (perimeter) | Buildings in the scar reached | FIRMS reached |
| --- | --- | --- | --- | --- | --- | --- |
| 06:00 on 8 Jan (12 h) | 10,827 ha | 0.235 | 0.313 | 0.455 / 0.239 | 3,632 / 6,706 | 243 / 394 |
| 12:00 on 8 Jan (18 h) | 14,942 ha | 0.344 | 0.429 | 0.778 / 0.296 | 6,382 / 6,706 | 256 / 413 |
| same, Viña's −10° wind | 12,609 ha | 0.341 | 0.424 | 0.682 / 0.308 | 5,016 / 6,706 | 209 / 413 |

- **The model calibrated on Viña overburns Eaton about 2.6×** (14,942 ha vs 5,689 ha by noon; by 06:00 it already
  burns 1.9× the final perimeter), although ERA5 smooths the downslope windstorm (18–37 km/h, gusts to 97 km/h at the
  reanalysis point 7 km west of Altadena). It reaches 95 % of the buildings inside the scar, but 119,849 of the grid's
  184,603 buildings in all (11,162 lie inside the perimeter): the run spreads south through consolidated Pasadena.
- Likely causes, not yet tested: the McArthur ×4 factor (fitted on Viña, above Project Vesta's 2–3×), urban spread
  and embers into consolidated city, and no suppression. This is the case for fitting on both fires together
  (backlog), keeping a fit only if Viña does not get worse.
- The Eaton scar uses true surface reflectance; Viña's keeps a −0.1 offset that its COGs do not need (see
  `pipeline/README.md`), so the two scars are not computed identically. The official perimeter is the
  method-independent check.

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

- The weather is a single point (ERA5), with no terrain-channelled winds and no gusts. The −10° direction
  correction (section 6) is a fitted stand-in for channelling, not an observation.
- The "starts today" scenario (`src/data/timeline.ts`) runs 00:00 to 24:00 today (`horizonMin` 24 h; the 2024
  replay keeps its validated 12 h) and feeds the engine today's Open-Meteo forecast at the same point
  **without** that correction: it was fitted on 2 Feb 2024's ERA5 and says nothing about a forecast model.
  Fuels are still the pre-2024 layer (no regrowth in the scar) and the drought factor starts at 10.
- The grid is a hard boundary: spread and embers that would leave it are dropped, since there is no terrain,
  fuel or weather beyond it. From the first contact on, burned area, buildings and households leave out what the
  fire would reach on the other side. `edge.ts` finds when and where the fire reaches the outer ring of cells;
  the explorer says so on the map and under the final burned area, and draws the simulated area's outline.
- The main result's spotting is deterministic. The firebreak ensemble samples only where embers ignite (uniform
  within the calibrated band). It has no long-range spotting beyond D_max and no uncertainty in reach or weather.
- Structures are modelled as a grass fraction, in two classes (intermix / consolidated). There is no
  building-to-building ignition model.
- Time-dependent Dijkstra assumes FIFO, meaning leaving later never arrives earlier. This holds only
  approximately when the weather changes quickly.
- With anchors, a cell's time can be slightly underestimated where the straight line from its anchor
  clips the corner of a firebreak or NONE cell. The topology is never affected.
- Slope makes the fire very elongated upslope, with LB up to about 7 at 20°, so fire backs down slopes very
  slowly.
- The pace is fitted to one fire with one reanalysis point; the western stall of 14:05–16:25 (satellite) is
  not reproduced and the result degrades with +10 % wind (section 6, "Pace against satellite passes").

## References

- Alexander, M.E. (1985). Estimating the length-to-breadth ratio of elliptical forest fire patterns. Proc. 8th Conf. Fire and Forest Meteorology, 287–304.
- Alexander, M.E. (2001). Fire behaviour as a factor in forest and rural fire suppression. New Zealand Fire Service Commission Research Report 21.
- Cheney, N.P., Gould, J.S., Catchpole, W.R. (1998). Prediction of fire spread in grasslands. Int. J. Wildland Fire 8(1), 1–13.
- Cheney, N.P., Gould, J.S., McCaw, W.L., Anderson, W.R. (2012). Predicting fire behaviour in dry eucalypt forest in southern Australia. Forest Ecology and Management 280, 120–131.
- Finney, M.A. (2002). Fire growth using minimum travel time methods. Can. J. For. Res. 32, 1420–1424.
- Kingman, J.F.C. (1993). Poisson Processes. Oxford University Press (Oxford Studies in Probability 3).
- López-De-Castro, M., Trucchia, A., Morra di Cella, U., Fiorucci, P., Cardillo, A., Pagnini, G. (2024). Fire-spotting modelling in operational wildfire simulators based on Cellular Automata: a comparison study. Agric. For. Meteorol. 350, 109989.
- Nash, A., Daniel, K., Koenig, S., Felner, A. (2007). Theta*: any-angle path planning on grids. AAAI-07.
- Noble, I.R., Bary, G.A.V., Gill, A.M. (1980). McArthur's fire-danger meters expressed as equations. Aust. J. Ecol. 5, 201–203.
- Rothermel, R.C. (1972). A mathematical model for predicting fire spread in wildland fuels. USDA For. Serv. Res. Pap. INT-115.
- Sardoy, N., Consalvi, J.L., Kaiss, A., Fernandez-Pello, A.C., Porterie, B. (2008). Numerical study of ground-level distribution of firebrands generated by line fires. Combust. Flame 154(3), 478–488.
- Schroeder, M.J. (1969). Ignition probability. USDA Forest Service Office Report 2106-1, Rocky Mountain Forest and Range Experiment Station.
- Trucchia, A., Egorova, V., Butenko, A., Kaur, I., Pagnini, G. (2019). RandomFront 2.3: a physical parameterisation of fire spotting for operational fire spread models. Geosci. Model Dev. 12, 69–87.
- Van Wagner, C.E. (1969). A simple fire-growth model. Forestry Chronicle 45, 103–104.
