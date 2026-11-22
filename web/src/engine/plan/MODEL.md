# Preparation plan: model notes

The "Plan de preparación" ranks measures that are chosen **before** any fire, without knowing where or when
the next one starts or the exact weather that afternoon. The ranking is computed once, offline, by
`bake.ts` over an ensemble of simulated fires and written to `web/public/data/plan.json` (`PlanFile` in
`../types.ts`). The panel fills a budget from that ranked list and the worker applies the chosen measures
with the same helpers (`index.ts`) the bake used, so what the panel shows is what was measured.

It is a planning aid for scenario exploration, not a prediction. Every outcome below is the evacuation
model's expected number of households that cannot get out by their own means in time
(`EvacResult.expectedTrappedHouseholds`). That is an exposure count, not a count of deaths.

## Measures

Both measures are **planning assumptions**: their definitions are ours, chosen to be plausible and easy to
reason about, not measured effects of a real programme or treatment.

- **Belt (`franja`, cost: hectares).** Wildland (grass, shrub, forest, crop) whose cell centre lies within
  `PLAN_BELT_WIDTH_M` = 200 m (plus half a cell) of *inhabited* built-up land. A built-up cell is inhabited if
  a building lies within its 5 x 5 cell window (about 120 m), which drops road corridors and paved land the
  land-cover map labels as built-up. Belt cells with no building are cleared: they join the firebreak mask and
  do not burn. Belt cells holding houses keep them and become managed intermix (`URBAN_LOW`). The belt is
  split by tile (`PLAN_TILE_CELLS` = 17 cells = 1.02 km). On the baked grid the belt covers 406 tiles and
  10,477 ha. A cell holding an ignition is left untreated (the engine cannot start a fire on an unburnable
  cell); the app says so in its notes.
- **Community preparation programme (`programa`, cost: households).** Drills, go-bags and an agreed way out,
  by sector (the same 1.02 km tiling, each building in the tile of its cell). Households in the programme
  prepare in a median of 5 min instead of 10 (`PLAN_PROGRAMME.prepMedianMin`), and 90 % of them instead of
  65 % leave on environmental cues (seeing the fire, embers or neighbours leaving; `cueShare`). Everything else
  (alert time, cue radius, share on foot, routes) is unchanged. In the app the programme never makes a household
  slower than the Evacuación settings: members get the faster preparation and the higher cue share of the two
  (`programmeFor`'s `current` argument; at the defaults, 10 min and 0.65, it is exactly the values above, which is
  what the bake uses). Households do not interact in the evacuation
  engine (no congestion), so the risk of a household depends only on its own membership; the bake checks this
  against the engine.

## Ensemble

- **Ignitions.** Grass, shrub or forest cells with no building, outside the belt, between 400 and 3,000 m
  from inhabited land (the wildland-urban interface, where most fires near cities start), at least 10 cells
  from the grid edge and more than 2,000 m from both 2 February 2024 ignitions (so 2 February is a fair
  test). On the baked grid that leaves 105,123 candidates. The fires are picked by farthest-point sampling
  from a seeded random start (mulberry32, seed 20240202), so they spread over the whole interface.
- **Time and weather.** Fire k starts at 12:00, 13:00, 14:00 or 15:00 (k mod 4) on 2 February 2024 and uses
  one of five weather members (k mod 5): the real ERA5 afternoon, wind speed x0.8, x1.2, wind direction -10
  or +10 degrees, applied exactly like the panel's weather adjustments.
- **Alert.** It reaches everyone 240 min after the ignition (a planning assumption, not a statement about
  any real alert); environmental cues as by default.
- **Split.** 120 fires: fire k is held out for testing when k mod 3 = 2 (40 test fires), the other 80 rank.
- Fire and evacuation run exactly as the worker does for the 2024 timeline (`DEFAULT_FIRE_PARAMS`, the
  calibrated ERA5 wind-direction correction, `DEFAULT_EVAC_PARAMS`, the default behaviour of the app).

## Ranking (training fires only)

- **Belt tiles: solo gain per hectare.** For each training fire and each tile, the fire is rerun with the
  belt in that tile alone, and the gain is the drop in expected households cut off. A tile can only change a
  fire that reaches at least one of its treated cells, so only those (tile, fire) pairs are run. Fires with
  less than one expected household cut off are skipped. `savedPerFire` = summed gain / training fires; tiles
  are ordered by `savedPerFire / ha`, best first.
- **Programme sectors: exact gain per household.** One evacuation without and one with the programme in
  every sector per training fire; the per-building difference summed by sector is the sector's exact gain
  (households do not interact). `savedPerFire` = summed gain / training fires; sectors are ordered by
  `savedPerFire / households`.
- Only tiles and sectors with a positive gain are kept. Gains are solo gains: tiles interact (two adjacent
  tiles can protect the same houses), so the sum of `savedPerFire` over a fill is not its measured effect;
  the validation below is.

## Validation (scored, never used to rank)

For each budget the ranked list is filled in order (`fillBudget`, skipping items that would overflow it), the
same as the panel. Percentages are of the summed expected households cut off without the plan.

- `unseenPct`: the 40 held-out fires.
- `randomUnseenPct`: the same budget filled in a random order over all belt tiles (or all sectors with
  households), 10 seeded draws: min, median, max on the held-out fires.
- `feb2Pct`: 2 February 2024, both preset ignitions, alert 18:00, real ERA5 weather.
- `feb2MeanPct`: the mean of the per-member percentages over the five weather members.

Measured by `pnpm plan` on 2026-11-22 (120 fires, the baked data on `main`; two runs gave a byte-identical
`plan.json`). Baselines, expected households cut off without the plan: held-out fires 4,153.7 per fire on
average (training 5,660.9); 2 February 4,061 with the real weather (1,229 wind -20 %, 13,214 wind +20 %,
3,488 direction -10 degrees, 3,757 direction +10 degrees). "Households" are buildings, as everywhere in the
evacuation model (321,533 on the grid).

| Measure | Budget | Filled | Held-out, ranked | Held-out, random fill (min / median / max) | 2 Feb, real weather | 2 Feb, mean of 5 members |
| --- | --- | --- | --- | --- | --- | --- |
| Belt | 300 ha | 20 tiles | 8.4 % | 1.6 / 2.2 / 4.9 % | 0.0 % | 0.8 % |
| Belt | 1,000 ha | 40 tiles | 24.8 % | 5.2 / 7.9 / 13.0 % | 0.0 % | 1.6 % |
| Belt | 3,000 ha | 99 tiles | 49.1 % | 16.2 / 25.8 / 27.9 % | 2.5 % | 8.8 % |
| Programme | 5,000 households | 26 sectors | 1.1 % | 0.3 / 0.9 / 2.0 % | 1.1 % | 2.3 % |
| Programme | 20,000 households | 57 sectors | 4.9 % | 1.9 / 3.0 / 4.7 % | 3.2 % | 6.1 % |
| Programme | 50,000 households | 98 sectors | 12.6 % | 5.4 / 8.6 / 10.5 % | 9.1 % | 11.7 % |
| Reference (not in the file): belt in every tile | 10,477 ha | 406 tiles | 65.4 % | | 37.0 % | 37.8 % |
| Reference (not in the file): programme everywhere | 321,533 households | 616 sectors | 52.9 % | | 43.9 % | 50.2 % |

Reading:

- **Belt.** On fires the ranking never saw, the ranked tiles remove about 2-4 times what a random choice of
  the same hectares removes (median), and more than the best of the 10 random draws, at every budget. On
  2 February they do almost nothing up to 1,000 ha with the real weather; the belt everywhere removes 37 %.
  The tiles that matter most on average over many possible fires are not the ones that mattered for that
  fire: a belt chosen without knowing the ignition protects the typical fire, not a particular one.
- **Programme.** Its benefit is spread over many sectors, so the ranking adds less: at 20,000 households the
  ranked sectors remove 4.9 % on held-out fires against a 3.0 % random median (4.7 % at best), and 3.2 %
  on 2 February. Enrolling everyone would remove about half (52.9 % held-out, 43.9 % on 2 February), under
  the programme's assumed effect.
- Run time on a laptop, one Node process: about 4.5 min (baselines 15 s; 3,062 solo belt runs 184 s;
  validation 70 s; 4,251 fire runs and 4,514 evacuation runs in total).

## Limitations

- **Same weather as 2 February.** Every fire uses that afternoon's weather or a small perturbation of it. The
  plan says which places matter under a hot, dry, strong-wind afternoon like that one, not under other fire
  weather.
- **Ignitions outside the belt favour belts.** The ensemble never starts a fire inside the belt or in town;
  a fire that starts among the houses is not stopped by a belt.
- **Exposure, not deaths.** The outcome is the expected number of households that cannot get out by their
  own means in time; it does not model sheltering, rescue or who dies.
- **No suppression.** Firefighters are off in every run (as in the calibrated model). Real belts also give
  crews a place to work; that is not counted.
- **Solo ranking.** Tiles and sectors are ranked one at a time; the two measures are ranked separately and
  their combination is not optimised.
- **The measures are assumptions.** A 200 m belt kept clear every summer, and a programme that halves
  preparation time and raises cue response to 90 %, are targets, not observed outcomes.
- **One ensemble.** 80 training fires; the held-out set is 40 fires. Different seeds would move the ranking
  of marginal tiles.

## Rerun

```bash
cd web && pnpm plan                 # or: make plan  (writes web/public/data/plan.json)
pnpm plan --fires 12 --out /tmp/plan.json   # quick smoke run on a small ensemble
```

The run prints every number in the table above, and checks that `parsePlan` (`src/data/load.ts`) accepts the
file it wrote. `parsePlan` also refuses a `plan.json` whose tile size, belt width or programme differ from the
constants in `index.ts`: change them, then rerun the bake.
