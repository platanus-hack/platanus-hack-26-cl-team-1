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
  access at walking speed (car: capped at 1 min, the car is at home). Departure = alert + preparation
  delay, lognormal (median `prepMedianMin`, log-sd `prepSigma`). `P(out) = footShare F(D_foot - alert)
  + (1 - footShare) F(D_car - alert)`; risk = 1 - P(out). Status: UNAFFECTED if its cell never burns and
  every used mode has `L = +Inf`; otherwise SAFE < 0.1 <= AT_RISK < 0.5 <= TRAPPED.
- **No drivable way out.** If there is no drivable node within 300 m of the house, or the user's
  closures cut that node off from every node far from wildland, its car share walks
  (`carHouseholdsWalking` counts them; 1,676 of 321,533 buildings on the real data). A drivable route
  cut by the fire still counts against the car.
- **Flow.** Each threatened household sends its mode shares along that mode's next-hop chain to safety;
  accumulated per edge in one pass in increasing-`L` order.
- **riskByAlert.** Same fire, alert at 0, 10, ... up to the last arrival rounded up to the hour. `D`
  does not depend on the alert, so this bins `D` (0.1 min) and correlates with a tabulated CDF (worst
  difference against full runs: 0.003 % on the bench).

## Performance

`pnpm exec tsx src/engine/evac/bench.ts`: synthetic city with 29,929 nodes, 54,685 edges, 50,000
buildings and a 700 x 800 grid. prepareEvac takes about 25-35 ms (median; about 50-60 ms on the first,
cold run) and simulateEvac about 20-30 ms (median; about 40 ms cold). On the real data (55,185 nodes,
71,321 edges, 321,533 buildings, 464 x 529 grid) prepareEvac takes 80-130 ms and simulateEvac
60-100 ms. Both measured with Node 26 on an Apple M1 Pro.

## Assumptions and known limitations

- Free-flow speeds, **no congestion** and no queueing at bottlenecks: real evacuations on narrow hill
  streets are slower, so risk is underestimated where many households share one exit.
- Everyone receives the alert at the same instant; nobody leaves before it. Households pick the latest
  safe route with perfect knowledge of where the fire will be (an optimistic bound).
- Fixed mode split (foot or car); car households only switch to walking where no street lets a car out,
  never because the fire cut the drivable route.
- Access from the house to its node is a straight walk that ignores the fire (access distances are
  normally tens of metres).
- Preparation delay is the only behavioural randomness; walking speed is the same for everyone (no
  reduced-mobility households).
- A road is unusable from `safetyMarginMin` before the fire reaches its cell or a neighbouring cell;
  smoke, embers and visibility are not modelled separately.
