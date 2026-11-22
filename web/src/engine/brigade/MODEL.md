# Firefighting model (Bomberos)

Scenario exploration for prevention and planning, not a reconstruction of what the cuerpos did on 2 February
2024 and not a judgement of it. Off by default: the calibrated fire model (Dice 0.639 against the scar, D-027) already
contains, without separating it, whatever suppression happened that day. With "Bomberos" on, the app compares
the same scenario with and without the trucks the user sets. Every parameter is in `model.ts` with a source
or marked **supuesto**; the UI lists them.

## Data (`web/public/data/brigades.json`, curated by hand)

- **Companies:** the 29 named companies of the Viña del Mar, Valparaíso, Quilpué and Villa Alemana cuerpos
  inside the grid, at their OpenStreetMap `amenity=fire_station` positions (queried 2026-11-22). Valparaíso's
  companies west of the grid and unnamed OSM stations are not included.
- **Trucks:** no open dataset lists trucks per company. One company has a source (Valparaíso 10ª: ladder and
  rescue, no water, BioBioChile 8 Feb 2024); every other company starts with **1 Bomba (supuesto)**.
- **Dispatch:** Viña del Mar's acuartelamiento at 15:10 (La Tercera, 14 Apr 2024); the other three cuerpos
  15:10 (supuesto).
- **Reinforcement:** 50 Región Metropolitana trucks announced on 2 Feb (Radio Prensa), all as Bomba
  (supuesto), reaching the map edge at 21:00 (supuesto) by Ruta 68 or, 45 min later (supuesto), by Ruta 60.
- **Historical cut:** Ruta 68 from 17:00 (La Tercera), never reopened within the run (reopening time unknown).

## Algorithm (two passes)

1. **Pass 1:** the fire without firefighters (`simulateFire`, no `defense`).
2. **Closures:** each street closes when the fire is on or next to it, minus the evacuation safety margin
   (`edgeClosuresFromFire`, the evacuation engine's rule). Historical cuts close MOTORWAY / PRIMARY edges whose
   midpoint is within 90 m of the cut's line (`snapCut`). The user's "Cerrar calle" affects only the
   evacuation (decided with the team).
3. **Routing:** earliest-arrival Dijkstra from each cuartel (or a reinforcement's entry roads) at free-flow car
   speeds (`DEFAULT_EVAC_PARAMS.carKmhByClass`), never on foot paths. An edge is usable only if the truck leaves
   it before it closes and the traversal does not overlap a cut window. No waiting.
4. **Sectors:** 480 m blocks (8 × 8 cells) with buildings the pass-1 fire reaches. Work site: the drivable node
   of the threatened building nearest the block's threatened-building centroid.
5. **Dispatch (greedy):** units in departure order; each goes to the sector with the most buildings still
   unburned when it arrives, divided by 1 + the units of its type already there. Status: `deployed`, `late`
   (reachable, but everything there already burned), `no_access` (no sector reachable by open streets),
   `idle` (nothing threatened).
6. **Work window:** a Bomba / Forestal engages when the pass-1 fire first comes within its radius (or on
   arrival if it is already there) and works for (tank + its equal share of the aljibes at its sector) / flow.
   No hydrants.
7. **Defence field:** Bomba → urban cells within 60 m (3 × 3 cells), no intensity limit (structure protection);
   Forestal → wildland cells within 120 m (5 × 5 cells), only where Byram's fireline intensity is
   ≤ 1,730 kW/m (flame length 2.4 m, the upper band where engines can attack directly, Andrews & Rothermel
   1982, GTR INT-131, Table 1). Overlapping windows merge.
8. **Pass 2:** the fire with `defense`: a cell the fire reaches while it is held does not burn and stays
   unburnable; held cells also block diagonal and knight moves, like a firebreak (fire `MODEL.md`, "Defended
   cells"). Embers still jump them.
9. **Evacuation and rescue:** the evacuation runs on the pass-2 fire; then each deployed Escala / rescate unit
   takes out up to 6 households per hour (supuesto), highest risk first, within 300 m (supuesto) of its site,
   from its arrival to midnight (`applyRescue`).

## Measured on the real data (`pnpm exec tsx src/engine/brigade/scenarios.ts`, 2026-11-22 02:43, alert 18:00)

Re-measured after the fire's pace recalibration (D-027: McArthur ×4, matorral at half of it), which changes the
rates of spread and so the fireline intensity the Forestal check sees. Burned area counts every cell (`make
validate` leaves out cells with no Sentinel-2 data, hence its 17,934 ha).

| Scenario | Trucks | Burned | Buildings reached | Households cut off | Rescued |
|---|---|---|---|---|---|
| No firefighters | 0 | 18,008 ha | 29,209 | 4,061 | – |
| Defaults (brigades.json) | 79 | −43 ha | −1,436 | −76 | 35 |
| Without the Ruta 68 cut | 79 | −45 ha | −1,456 | −76 | 35 |
| Double every count | 158 | −59 ha | −1,954 | −85 | 40 |
| Every company 2 Bomba + 1 Forestal + 1 Aljibe | 166 | −78 ha | −2,504 | −49 | 0 |
| Dispatch at 14:30 | 79 | −43 ha | −1,436 | −79 | 37 |

Before the recalibration the first two rows read 18,108 ha / 28,119 / 4,753 and −36 ha / −1,191 / −62 / 37.

Planning takes ~200 ms; the whole two-pass run ~0.5 s in the browser.

## Known limitations

- Routes use the pass-1 fire, so a street the firefighters saved still counts as cut (pessimistic).
- One work window per cell; a later, disjoint window at the same cell is dropped. Aljibe water is shared
  regardless of when the aljibe arrives (optimistic).
- Routing does not wait at nodes, which is exact only while cut windows never reopen (true for the shipped
  Ruta 68 cut). A cut with a finite reopening time can mark a unit "sin acceso" that could have waited.
- The "Hogares con la salida cortada según la hora de la alerta" chart is not adjusted for rescues.
- Units do not move once deployed, do not refill, and have no crews, radios (the ~30 min radio outage after
  18:30 is not modelled), traffic or congestion.
- The Forestal intensity check uses the head rate of spread of the cell (overstates flank intensity).
- Air resources, CONAF brigades and hydrants are out of scope.
