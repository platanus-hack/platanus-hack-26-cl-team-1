# Evacuation model

Scenario exploration, not a prediction. Given one fire (an arrival time per grid cell), the engine
estimates for each building the probability that its household does **not** reach a safe zone before
the fire cuts its way, and how that changes with the alert time and the user's edits to the streets.
"Trapped" means "could not get out by its own means in time"; it does not say the house burned or that
the people in it died.

## Prepare (does not depend on the fire)

- Positions are projected to grid metres (x east of the grid's west edge, y south of its north edge).
- The street graph is undirected (every edge usable both ways), stored as CSR adjacency.
- Each edge is mapped to the cells it passes through: its polyline (or the straight segment between its
  nodes when there is no geometry) sampled every `cellM / 2`. Each node is mapped to its cell.
- Distance from every cell to the nearest wildland cell (GRASS, SHRUB, FOREST, CROP): two-pass chamfer
  distance transform (weights 1 and sqrt 2). Wildland patches (8-connected) under 5 ha
  (`MIN_WILDLAND_PATCH_HA`) are parks, gardens and isolated trees: they still burn, but they do not
  disqualify a safe zone. On the real 60 m grid this drops 406 of 436 patches and raises the nodes
  >= 800 m from wildland from 175 to about 6,000 (without it, the city centre has almost no safe zone).
- Each building is snapped to its nearest node (uniform-grid spatial hash; the access distance is kept),
  among non-isolated nodes whose connected component holds a node at least `safeDistanceM` from
  wildland: a house is never attached to a disconnected fragment nobody can leave (a parking aisle, a
  street cut by the data clip). `Prepared.snapNodes` says how many nodes qualified.
- Car households start from the nearest node with a drivable edge whose drivable component holds such a
  candidate, within 300 m (`CAR_SNAP_MAX_M`): on the real data 24k buildings are nearest to a footway
  node, with a drivable node at a median of 53 m.

## Simulate

- **Fire next to a road closes it.** The arrival field is min-filtered over 3x3 cells, so "fire on or
  next to" means the cell or any of its 8 neighbours. `closes(e)` = min over the edge's cells -
  `safetyMarginMin` (Infinity if none burn). `deadline(node)` = same over the node's cells.
- **User edits.** Closed edges close at -Infinity (reported as `-Infinity` in `edgeClosesMin`).
  Emergency links are extra LOCAL edges, length 1.3 x the straight line, closing with the cells of the
  straight segment (reported in `addedLinkFlow` / `addedLinkClosesMin`, outside the contract arrays).
- **Safe zone.** A node at least `safeDistanceM` from wildland whose cells (and neighbours) never burn.
  Nodes outside the grid count as safe exits (leaving the modelled area). No safe node: error.
- **Latest departure** per mode (foot: `walkKmh` everywhere; car: `carKmhByClass`, PATH excluded),
  free-flow travel:

  ```
  L(safe) = +Inf
  L(u)    = min(deadline(u), max over edges e = (u, v) of (min(L(v), closes(e)) - travel(e)))
  ```

  solved by label-setting from the safe nodes in decreasing `L` (a max-heap), keeping the edge that
  achieves the max as the next hop (checked against brute force in `internals.test.ts`).
- **Fire-free pockets.** A connected street component the fire never touches is a refuge in that
  scenario: its nodes get `L = +Inf` even without a safe node in it.
- **Household.** Latest departure from home `D = min(arrival at its own cell - margin, L(node) - access)`,
  access at walking speed (car: capped at 1 min, the car is at home). Departure = start of the response +
  preparation delay, lognormal (median `prepMedianMin`, log-sd `prepSigma`). For a start time `s`,
  `P(out | s) = footShare F(D_foot - s) + (1 - footShare) F(D_car - s)`.
- **Environmental cues (spontaneous evacuation).** Many households leave when they see flames, embers or
  their neighbours leaving, not only after an official alert. A share `cueShare` of the households
  responds to cues: its response starts at `cue`, the earliest fire arrival within `cueRadiusM` of the
  home, if that is before the alert; the rest wait for the alert:

  ```
  P(out) = (1 - cueShare) P(out | alert) + cueShare P(out | min(alert, cue))
  ```

  risk = 1 - P(out). `cueShare = 0` or `cueRadiusM = 0` turns cues off and reproduces the alert-only
  model bit for bit (checked against the pre-cue engine in `cues.test.ts`). The cue time is a min filter
  of the arrival grid over an octagon of radius `cueRadiusM / cellM` cells (rounded to whole cells) around
  the building's cell
  (`minfilter.ts`): the Minkowski sum of a square and the two diagonal segments, four 1D running-min
  passes (van Herk / Gil-Werman) on a grid padded with +Infinity, O(cells) whatever the radius (6-7 ms
  on the real grid; matches brute force in `cues.test.ts`). The octagon holds every cell centre within
  the radius and none beyond 1.11 x the radius (1.17 x below 10 cells): with the default 900 m on the
  60 m grid, all cells within 900 m and none beyond about 990 m. Line of sight is not modelled (smoke
  and embers rise above ridges and roofs).
- **Status.** UNAFFECTED if its cell never burns and every used mode has `L = +Inf`; otherwise
  SAFE < 0.1 <= AT_RISK < 0.5 <= TRAPPED.
- **No drivable way out.** If there is no drivable node within 300 m of the house, or the user's
  closures cut that node off from every node far from wildland, its car share walks
  (`carHouseholdsWalking` counts them; 1,676 of 321,533 buildings on the real data). A drivable route
  cut by the fire still counts against the car.
- **Flow.** Each threatened household sends its mode shares along that mode's next-hop chain to safety;
  accumulated per edge in one pass in increasing-`L` order.
- **riskByAlert.** Same fire and same cue behaviour, alert at 0, 10, ... up to the last arrival rounded
  up to the hour. `D` does not depend on the alert, so this bins `D` (0.1 min) and correlates with a
  tabulated CDF. Cue responders are split by their cue time, binned the same way: those not cued yet at
  an alert time start at the alert (a second histogram, filled while sweeping the alert time downwards),
  those cued earlier keep their risk at the cue time (prefix sums). Each building's term is exactly
  non-decreasing in the alert time, and the curve with cues never exceeds the alert-only one. Worst
  difference against full runs on the bench: 0.003 % without cues, 0.08 % with the default cues.

## Performance

`pnpm exec tsx src/engine/evac/bench.ts`: synthetic city with 29,929 nodes, 54,685 edges, 50,000
buildings and a 700 x 800 grid of 30 m cells (the 900 m cue window is 30 cells there). prepareEvac takes
about 25-35 ms (median; about 50-70 ms on the first, cold run) and simulateEvac with the default cues
about 40-50 ms (median; 60-80 ms cold; 20-30 ms without cues). On the real data (55,185 nodes, 71,321
edges, 321,533 buildings, 464 x 529 grid) prepareEvac takes 80-130 ms and simulateEvac 45-60 ms median
with the default cues (80-100 ms cold; about 30-40 ms without cues; `sensitivity.ts` prints it). All measured with Node 26 on an
Apple M1 Pro.

## Defaults for the cues, and what they do on the real data

- `cueShare = 0.65` (`DEFAULT_CUE_SHARE`). In the NIST household survey of the 2016 Chimney Tops 2 fire
  (Gatlinburg, Tennessee; 323 households; https://doi.org/10.6028/NIST.TN.2103), 82.0 % evacuated, and
  81.4 % of those who evacuated said they left after observing a fire cue (77.5 % saw, heard or smelled
  the fire; 15.7 % saw neighbours leave), while 11.4 % cited an official evacuation order and 83.0 % did
  not remember getting any official warning. 0.82 x 0.81 = 0.67 of all households, rounded down. It is a
  US fire with weak official warnings, not a measurement in Viña del Mar.
- `cueRadiusM = 900` (`DEFAULT_CUE_RADIUS_M`): an assumption, not a measurement. A little more than the
  fire engine's maximum ember-spotting distance at that afternoon's mean wind (25 m per km/h x
  27-28 km/h in `weather.json`, about 700 m): embers and flames at the edge of the neighbourhood. At the
  model's urban spread (~45 m/min) it gives a responder about 20 min (10th percentile 22 min), inside the
  20-30 min "fire is close" cue window suggested by the evacuation literature review below.
- **Why cues matter in Viña 2024:** the official SAE alert came after the fire in the worst-hit sectors
  (El Olivar: fire before 18:30, SAE at 18:37-18:41; Villa Independencia: SAE at 19:40), and CIGIDEN found
  that in most critical sectors it was not received or caused confusion, while Pompeya was already
  self-evacuating at 18:10 (CIPER, https://www.ciperchile.cl/2024/03/10/incendios-el-fracaso-del-sae/;
  CIGIDEN, https://wildfirex.cl/wp-content/uploads/2024/02/Reporte-incendios-Vina-del-Mar-2024_version-1_14.02.2024_compressed.pdf;
  Emol, https://www.emol.com/noticias/Nacional/2025/02/02/1156018/cronologia-incendio-2-de-febrero.html).
  In the 2019 Kincade fire, self- and shadow evacuees were more than half of all evacuees (Zhao et al. 2022,
  https://ui.adsabs.harvard.edu/abs/2022TRPD..10703277Z). The preparation median of 10 min is close to the
  9 min measured in the Roxborough Park drill; WUI-NITY's default of 20 min is called speculative by its own
  authors (NFPA WUI-NITY report,
  https://content.nfpa.org/-/media/Project/Storefront/Catalog/Files/Research/Research-Foundation/Reports/WUI/RFWUINITY.pdf).
  The defaults are therefore unchanged by the 2026-11-22 urban fix of the fire engine.

Expected households that do not get out, alert at 18:00, default fire (preset ignitions, real weather,
no firebreaks), real data. Every number in this section comes from
`pnpm exec tsx src/engine/evac/sensitivity.ts`, and changes whenever the fire engine does:

| cueShare \ cueRadiusM | 300 m | 600 m | 900 m | 1,200 m | 1,500 m | 2,000 m | 3,000 m |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 (alert only) | 6,433 | 6,433 | 6,433 | 6,433 | 6,433 | 6,433 | 6,433 |
| 0.5 | 6,134 | 5,849 | 5,141 | 4,608 | 4,220 | 3,910 | 3,408 |
| 0.65 (default) | 6,045 | 5,674 | **4,753** | 4,060 | 3,556 | 3,153 | 2,500 |
| 0.8 | 5,955 | 5,499 | 4,366 | 3,513 | 2,892 | 2,396 | 1,593 |
| 1 | 5,836 | 5,266 | 3,849 | 2,783 | 2,007 | 1,387 | 383 |

With the fire engine before its urban fix (2026-11-22, see `../fire/MODEL.md` section 6) the default cell
read 6,592 and the alert-only row 9,719. Default-cue curve (`riskByAlert`, households, alert at the full
hour): 16:00 1,072 · 17:00 2,395 · **18:00 4,753** · 19:00 9,954 · 20:00 13,720 · 22:00 16,751 · 00:00 17,758.
It is flat until the fire reaches the first neighbourhoods (~16:00, the eastern fire) and steepest from 18:00
to 20:00, when the western head crosses El Olivar and Villa Independencia; each hour of delay in that window
adds about 4,000-5,000 households.

Why the count is still large:

- **The eastern fire.** Run alone it accounts for 2,566 of the 4,753 (its neighbourhoods burn from 16:00,
  two hours before an 18:00 alert, and it overburns sideways: 357 of its 4,756 reached buildings are in the
  scar). The real Villa Alemana alert was at 16:35-16:40 (CIPER, above); one global alert time cannot
  represent that.
- **The households that wait for the alert set a floor**: (1 - cueShare) x 6,433, about 2,250.
- **Lead time:** from "fire within R" to "fire at the house", 10th percentile 14, 22, 35 and 68 min for
  R = 600, 900, 1,500 and 3,000 m over the 28,119 buildings the fire reaches.
- **Where:** scored against the Sentinel-2 scar (scoring only, not an input), 967 of the 4,753 are in
  buildings inside the scar and 3,787 outside it (alert only: 1,289 / 5,143). Many "outside" buildings are
  within 120 m of the scar, which misses houses in built-up cells. For reference, MINVU's preliminary count
  was 6,019 homes with non-repairable damage (21 Feb 2024,
  https://www.minvu.gob.cl/noticia/ministro-montes-presenta-primeros-lineamientos-de-la-estrategia-de-reconstruccion-para-las-comunas-afectadas-por-los-incendios-en-la-region-de-valparaiso/)
  and about 137 people died (138 per https://en.wikipedia.org/wiki/2024_Chilean_wildfires); the model has no suppression and no rescue, so treat absolute counts as an
  upper bound of exposure (not of deaths) and compare scenarios.

## Assumptions and known limitations

- Free-flow speeds, **no congestion** and no queueing at bottlenecks: real evacuations on narrow hill
  streets are slower, so risk is underestimated where many households share one exit.
- Everyone receives the alert at the same instant. Before it, only cue responders leave, and only from
  the moment the fire is within `cueRadiusM`; the others never react to the fire, however close (a
  household that sees its street burning would leave: this overstates the risk of the non-responders).
  Households pick the latest safe route with perfect knowledge of where the fire will be (an optimistic
  bound).
- Cue responders use the same preparation delay as households answering the alert.
- Fixed mode split (foot or car); car households only switch to walking where no street lets a car out,
  never because the fire cut the drivable route.
- Access from the house to its node is a straight walk that ignores the fire (access distances are
  normally tens of metres).
- Preparation delay is the only behavioural randomness; walking speed is the same for everyone (no
  reduced-mobility households).
- A road is unusable from `safetyMarginMin` before the fire reaches its cell or a neighbouring cell;
  smoke, embers and visibility are not modelled separately.
