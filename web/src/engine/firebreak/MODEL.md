# Firebreak lines for a known scenario: model notes

Given one scenario (ignition points and times, weather, drought, spotting), this module looks for **where**
to build firebreak lines and **by when**, so that as few households as possible are left without a way out,
inside a budget of line. It is the opposite case of the Plan de preparación (`../plan`), which is chosen
before any fire and knows nothing about where the next one starts.

It is a planning aid for scenario exploration, not a prediction and not advice for an ongoing fire. The
outcome is the evacuation model's expected number of households that cannot get out by their own means in
time (`EvacResult.expectedTrappedHouseholds`): an exposure count, not a count of deaths.

**The result is never an optimum.** Placing firebreaks optimally is the firefighter problem, which is
NP-complete even on trees of maximum degree three (Finbow, King, MacGillivray & Rizzi 2007, *Discrete
Mathematics* 307; survey: Finbow & MacGillivray 2009, *Australasian Journal of Combinatorics* 43). What the
script prints is the best line this search found, with every number taken from the fire and evacuation
engines, not from the search's own estimate.

It is a prototype: a Node script (`pnpm lines`, `run.ts`) and a library (`index.ts`). It is not in the app.

## 1. A line in the fire engine

A line is a set of grid cells. Each cell holds from the moment a crew finishes it to the end of the run,
against any fire intensity: `FireInput.defense` with the window [ready, Infinity) and `maxKwM` = Infinity
(`lineDefense`; `../fire/MODEL.md`, "Defended cells"). A cell the fire reaches before it is finished burns
like any other. `ready` = -Infinity is a line that exists before the fire starts.

- **Width.** A cell is 60 m, the narrowest line the grid can hold (the app's firebreak tool has the same
  floor). A hand line is one to a few metres of bare soil; the model's cell stands for that line being held.
  Read the kilometres as line length, not as cleared area.
- **Embers.** Embers that land on a finished cell do not start a fire. Embers still fly over the line, from
  any forest or matorral cell burning fast enough upwind (D_max = 25 m per km/h of wind as shipped).
- **Clock.** The engine tests whether a diagonal or knight move can pass between two cells when the fire
  leaves the source cell. A line one cell wide therefore holds only if it is finished before the fire is
  within two cells of it. Every deadline below uses that time, `fireNearMin` (the earliest arrival in the
  5 x 5 window around the cell), not the arrival at the cell itself.

## 2. Where: a minimum cut of the spread graph

The search first runs the scenario without lines and keeps the arrival time of every cell, the expected
households cut off per home cell, and every ember jump the engine considered (`simulateFire`'s `onSpot`
observer, which never changes the result).

**Graph** (`LineCut`):

- **Nodes:** the cells the fire reaches by a time threshold `untilMin`.
- **Arcs:** between 4-neighbours, and one per ember jump.
- **Why 4 neighbours, when the engine spreads in 16 directions:** a minimum node cut of the 4-neighbour
  graph is an 8-connected chain of cells, and the engine's corner rules make such a chain watertight (no
  diagonal move between two unburnable cells, no knight move unless both cells it passes between are open).
  With the 16 directions as arcs the cut would be two cells thick for nothing. `firebreak.test.ts` builds
  jagged cuts and checks in the real engine that no fire gets through.
- **Embers:** a jump is an arc from the burning cell to the cell where the ember lands, so the cut must take
  one of the two, or keep the fire from the source cell. With constant weather the jumps of a run are the
  jumps of any run with more lines, and the tests check that a cut with the jumps in its graph holds in the
  engine while the same cut without them is jumped.
- **Cost:** 1 per cell that may hold a line; a cell that may not cannot be cut. A line may use wildland
  cells (grass, matorral, forest, crop) with no building in them, outside the ignition cells
  (`buildableCells`).
- **What is protected:** each cell with households at stake is tied to the sink with capacity
  lambda x (expected households cut off in the homes of that cell). The cut therefore minimises
  (line cells) + lambda x (households left on the fire's side). lambda is how many cells of line one more
  protected household is worth; sweeping it gives a cost / benefit curve, printed by the script.
- **Solver:** Dinic's algorithm (`mincut.ts`), checked against brute force on random graphs. Of the cuts of
  equal cost it returns the one nearest the ignition (the least area burned).

**Why a time threshold.** A cut of the whole burned area keeps the fire from what it protects for the whole
run, and is the most expensive. A cut of the cells burned by `untilMin` is shorter and still keeps the fire
away at least until `untilMin`: any path around it passes through a cell that burned later than that even
without lines, and lines only delay a fire. The script proposes cuts for a few thresholds (the alert time,
1, 2 and 4 hours after it, and the end of the run) and lets the engines decide.

**What the graph does not see** (the engines do, in section 4):

- A household is counted where its home is. Households whose home does not burn but whose streets do are
  not in the graph (the script prints the share that is: 69-98 % by member on 2 Feb 2024).
- The jumps are those of the run without lines. A delayed fire meets other wind, so its jumps differ.
- A line that only delays the fire by less than a threshold counts for nothing.

## 3. When: the time rule

A line "in place before the fire" needs no rule. For a line built during the fire:

**A cell can be part of a line only if a crew can reach it, build it and be done before the fire is near:**

```
access(cell) + build(cell) + margin <= fireNear(cell)        (cellsInTime)
```

- **access** (`crewAccessMin`): crews leave the fire stations of `brigades.json` at their cuerpo's dispatch
  time (or at a time given to the script), drive at free-flow speed over streets the fire has not closed (the
  brigade engine's router) and then go off the road at 3 km/h from the nearest street node. A crew does not
  start on a cell before the fire that reaches it has started (one extra fire run per ignition tells which).
- **build** (`buildMinutes`): 60 m divided by the crew's production rate in that fuel.
- **margin:** 30 minutes between finishing a cell and the fire being within two cells of it.

| Parameter | Value | Source |
| --- | --- | --- |
| Line per crew, grass and crops | 17 chains/h = 342 m/h | Broyles (2011), table 2, fuel models 1-2 |
| Line per crew, matorral | 6.6 chains/h = 133 m/h | Broyles (2011), table 2, fuel model 4 (chaparral) |
| Line per crew, forest and plantations | 10.5 chains/h = 211 m/h | Broyles (2011), table 2, fuel models 8-10 |
| Crews working at once | 6 | supuesto |
| Margin | 30 min | supuesto |
| Off-road speed | 3 km/h | supuesto |
| Bases and departure | the fire stations and dispatch times of `brigades.json` | supuesto: the bases of CONAF and company brigades are not in the data |

Broyles, G. (2011), *Fireline Production Rates*, USDA Forest Service, San Dimas Technology & Development
Center, 1151 1805-SDTDC: sustained rates of a 20-person Type I crew in direct attack, measured on fires. A
Chilean reference, not used because it gives no crew size: CONAF-CIREN (2010), *Determinación de prioridades
de protección contra incendios forestales en la Región de Valparaíso*, Documento de Trabajo 555, cuadro 7,
"resistencia al control" in metres per person per hour in first attack (grassland 66, open to dense matorral
50 to 12, plantation 30, dense native forest 9). Machinery is not modelled: a medium bulldozer builds 200 to
2,500 m/h depending on fuel and slope (NWCG 2021, *Fire Line Production Rate Tables*), several times a hand
crew; `--crews` can stand in for it.

**Schedule** (`scheduleLine`): the cells of a line are built most urgent first (earliest deadline first), each
by the crew that can start it soonest; a crew builds one cell at a time. The result is a finishing time per
cell, which is the cell's window in the fire engine. A cell finished too late simply does not hold: the
engines see that.

**Repair:** the time rule is per cell and ignores that crews are few. So each proposed cut is scheduled, the
cells that would be finished too late are forbidden, and the graph is cut again (up to 4 times).

## 4. The search on the real engines

For each budget (`refineLine`):

1. The largest proposals inside the budget, two per threshold, are scored with the real fire and evacuation
   runs; the best is the starting line.
2. **Remove:** its pieces (8-connected groups of cells) are dropped one at a time, smallest first, whenever the
   result does not get worse.
3. **Add:** while cells are left in the budget, the piece (from all proposals, the 30 largest) with the largest
   gain per new cell is added, re-running the engines for every candidate, up to 4 rounds.

A fire plus an evacuation run takes about 0.12 s, so the search is a few hundred runs per budget.

## 5. Robustness: an ensemble around the scenario

A line tuned to one run is fragile (session log `2026-11-22-josecannete-optimizer-investigation`), so every
line is scored on an ensemble and the script runs the search twice:

- **Tuned to the scenario:** the graph of the scenario's own fire, with its exact ignition cells.
- **Tuned to the ensemble:** nine members (the scenario; wind x0.8 and x1.2; direction -10 and +10 degrees;
  every ignition moved 1 km north, east, south, west). The graph is their union: the earliest arrival of each
  cell, every jump of every member, the mean households at stake. A cut of the union graph is a cut in every
  member. The fire may start anywhere within 1 km of the scenario's ignition points: that whole zone is the
  source, so the line goes around it. The search minimises the mean over the nine members.
- **Members no search sees:** wind x0.9 with +5 degrees, wind x1.1 with -5 degrees, ignitions moved 0.7 km
  north-east and south-west. Printed apart ("unseen").

The script reports, per line, the households saved on the scenario, the mean and the worst member of the
ensemble, and the mean and the worst of the unseen members, next to random lines of the same length (straight
1 km segments where a line may go, inside the area the scenario burns) and the Plan de preparación belt
(`plan.json`, best tiles first) at the same treated area and at 1,000 ha.

RESULTS_PLACEHOLDER

## 7. Limitations

- One day and one territory. The numbers come from the 2 Feb 2024 scenario and its ensemble.
- The fire model is ember-dominated and has no suppression (`../fire/MODEL.md`); a line's effect depends
  mostly on whether embers cross it.
- A 60 m cell stands for a line a few metres wide (section 1).
- Crews: one kind (a 20-person hand crew), pooled, with no travel between the cells of a line beyond first
  access, no fatigue, no water, no machinery, no aircraft. Their bases and number are assumptions.
- Detection is immediate once crews are out, and the planner knows the fire's future path exactly (the
  ensemble only partly relaxes this).
- Firefighters (`../brigade`) are off in these runs. A line's windows can be merged into a brigade defence
  (`lineDefense(..., base)`), but the two were not searched together.
- The search is greedy over pieces of minimum cuts. Other shapes (lines that only steer the fire, lines
  anchored to roads or bare ground on purpose) are found only if a cut happens to propose them.

## 8. Not in the app

To put it in the panel: run the search in the worker (the ensemble search takes minutes: show progress, allow
cancelling), draw the proposed cells and their finishing times on the map and the time bar, and let the user
accept them as a scenario layer. `Scenario` would gain the accepted line (cells and finishing times), which
is a contract change (`types.ts` and every consumer). The copy must say "la mejor línea que encontró la
búsqueda, comprobada con el simulador", never "óptima".
