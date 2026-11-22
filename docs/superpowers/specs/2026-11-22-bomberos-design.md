# Bomberos: fire companies, trucks and route cuts (design)

Date: 2026-11-22 (Sun, 01:50 America/Santiago). Must be on `main` by 05:30.
Decided with Anaís (@chichitaocss) in a Q&A session; their answers are marked **(decided)**, my calls
**(my call)**, and numbers without a source **(supuesto)**. Every supuesto is shown as such in the UI.

## Intent

Make the firefighting response a scenario variable. The user sees the fire companies of the area, how many
trucks of each type each one has, and changes those numbers to see how burned area, buildings reached and
households cut off change. Route cuts decide which companies can reach which sectors: some arrive, others
don't. Framing stays prevention and planning (CLAUDE.md rule 7): it compares resource scenarios, it does not
judge what the cuerpos did that day.

## What the research found (sources in the PR body and in `brigades.json`)

- No open dataset lists Chile's companies with their trucks. Totals only: 314 cuerpos (Junta Nacional,
  Memoria 2024); ~1,253 companies (secondary, undated).
- No official count of trucks on 2 Feb 2024. Pieces: Viña acuartelamiento 15:10, Ruta 68 cut from 17:00,
  ~30 min without radio after 18:30 (La Tercera, 14 Apr 2024); ~50 RM trucks announced on the 2nd, >80 trucks
  and ~300 volunteers from the RM on the 3rd; staging at the Sporting Club from around midnight; about 140
  vehicles from 80 cuerpos of seven regions over the whole event (The Clinic, 7 Feb 2024). A Valparaíso ladder
  company left ~19:00 with two water trucks; in El Olivar they were "the first firefighters to arrive" and
  saved 20–30 houses (BioBío, 8 Feb 2024). The Cámara's investigative commission: the four cuerpos were
  overwhelmed; the SISS blamed the water shortage on too many open hydrants.
- The fire model has no suppression; its calibration against the scar (Dice 0.628) implicitly contains
  whatever suppression happened that day.

## Goals

1. **Companies (decided: zone + reinforcements).** The companies of the four cuerpos in the area (Viña del
   Mar, Valparaíso, Quilpué, Villa Alemana) at their cuartel locations, plus reinforcement groups from other
   regions that enter the map on a highway at a given time.
2. **Trucks per company, by type (decided: four types)**, editable in the panel:
   - **Bomba**: protects structures around its work site while it has water.
   - **Forestal**: holds the front in wildland around its site while it has water, only where the fire is weak
     enough for direct attack.
   - **Aljibe**: carries water; adds its volume to the units working at the same site.
   - **Escala / rescate**: no water; rescues households at risk near its site (acts on the evacuation result).
   - A company with no sourced inventory starts with **1 Bomba, marked "supuesto"** (decided).
3. **Automatic dispatch (decided).** Each cuerpo's companies leave at the cuerpo's dispatch time; each unit
   goes to the most threatened sector it can reach before the fire.
4. **Route cuts (decided: fire + historical).** A street is unusable once the fire is on or next to it
   (same rule as the evacuation engine), and during documented historical cuts (Ruta 68 from 17:00).
   User-closed streets ("Cerrar calle") keep affecting only the evacuation (decided by omission; flag below).
5. **Off by default (decided).** The base scenario and the validation number do not change. With
   "Bomberos" on, the results show the change against the same scenario without firefighters.

## Non-goals

- All of Chile's companies (no data; out of time). Aircraft, CONAF brigades, hand crews.
- Congestion (evacuees slowing trucks), hydrant network modelling, radio outages, crew fatigue, rotations.
- Recalibrating the fire model.

## Anti-goals

- Game language, scores, "you saved N houses" framing.
- Presenting the result as what the cuerpos should have done that day.
- Any number in the UI that looks sourced but is not.

## Approaches (decided: A)

- **A. Two passes.** Fire without firefighters → street closure times → route each unit → work windows and
  defended cells → fire again with those cells → evacuation → rescue. Routing uses pass-1 closures, so a street
  the firefighters saved still counts as cut: a pessimistic bias, documented. Two fire runs (< 0.3 s total).
- B. Units as agents inside the fire engine, deciding minute by minute. More faithful; rewrites the propagation
  core; does not fit before 05:30.
- C. Post-processing only (fewer buildings reached near trucks, fire unchanged). Fast, but cannot hold a front.

## Design

### Data: `web/public/data/brigades.json` (hand-curated, validated on load)

```ts
// types.ts additions (contract)
export const UNIT = { BOMBA: 0, FORESTAL: 1, ALJIBE: 2, RESCATE: 3 } as const
interface BrigadeStation { id; cuerpo; company /* "1ª Compañía" */; lon; lat; units: number[4];
  unitsSource: string | null /* null = supuesto */; locationSource: string }
interface Reinforcement { id; label; lon; lat /* entry point on a highway, inside the grid */;
  arrivalLocal: string; units: number[4]; source: string | null }
interface CuerpoDispatch { cuerpo; dispatchLocal: string; source: string | null }
interface RouteCut { id; label; line: [lon, lat][] /* polyline over the cut road */;
  fromLocal: string; toLocal: string | null; source: string }
interface BrigadesFile { stations; reinforcements; dispatch; cuts }
```

- Cuartel locations: OpenStreetMap `amenity=fire_station` in the grid (cross-checked with each cuerpo's own
  site where possible); `locationSource` per station.
- Inventories: each cuerpo's site / press where found (`unitsSource`); otherwise 1 Bomba, supuesto.
- Validation: every point inside the grid, counts non-negative integers, times parse, unknown keys refused.
- Historical cuts are snapped to the road edges within 1 cell of the polyline whose class is MOTORWAY/PRIMARY.

### Engine: `web/src/engine/brigade/` (new; pure TS; tests)

1. **Routing.** Earliest-arrival Dijkstra per origin (station node / reinforcement entry node) at car
   free-flow speeds (`DEFAULT_EVAC_PARAMS.carKmhByClass`, no PATH edges) **(my call: no siren speed-up)**.
   An edge can be entered at time t only if t < closes(e) (pass-1 fire, same 3×3 rule and safety margin as the
   evacuation engine) and t is outside every historical cut on it. Reuses the evacuation engine's prepared
   graph (`edgeCells`, CSR adjacency).
2. **Sectors.** 480 m × 480 m blocks (8 × 8 cells) with buildings the pass-1 fire reaches **(my call)**.
   A sector's value at time t = buildings in it not yet reached at t.
3. **Dispatch (greedy).** Units ordered by departure time; each picks the sector with the highest
   value at its arrival time divided by (1 + units of the same type already there), among sectors it reaches
   before their last building burns. The work site is the sector node nearest its threatened buildings.
   Forestal units score wildland cells next to the sector's buildings instead of buildings. Reinforcements are
   dispatched the same way from their entry point at their arrival time.
4. **Water and work window.** Window = [arrival, arrival + water / flow]; the site's water = its units'
   tanks + aljibes at the site. Without hydrants **(supuesto: the SISS reported shortages)**.
5. **Pass 2 (fire).** `FireInput` gains an optional `defense` (per cell: window start/end and kind). A cell
   reached by the fire while it is defended does not burn and stays unburnable (the front passed while it was
   held). Bomba defends urban cells within its radius; Forestal defends wildland cells within its radius only
   if the fireline intensity there is ≤ 1,730 kW/m (flame length ≤ 2.4 m / 8 ft, the band where engines can
   attack, Andrews & Rothermel 1982, GTR INT-131, Table 1); Byram: I = 18,000 kJ/kg · w · R.
6. **Rescue.** After the pass-2 evacuation, each Escala/rescate unit takes up to its capacity of the highest-
   risk households within its radius, from its arrival to midnight, and sets their risk to 0 ("rescatados",
   counted apart).

### Parameters (`FIREFIGHT_MODEL`, one place, each with source or "supuesto")

| Parameter | Value | Source |
|---|---|---|
| Bomba tank | 3,000 L | supuesto (NFPA 1901, which JNB tenders follow, sets only a 1,135 L minimum) |
| Forestal tank | 1,500 L | supuesto |
| Aljibe tank | 8,000 L | JNB tender Q&A, Lic. 15-2019 (8,000 L for a 4×2 aljibe) |
| Flow while working | 200 L/min per Bomba or Forestal | supuesto (one 38 mm line, defensive) |
| Bomba defence radius | 60 m (the cell and its 8 neighbours) | supuesto |
| Forestal attack radius | 120 m | supuesto |
| Direct-attack limit | 1,730 kW/m | GTR INT-131 Table 1 |
| Grass fuel load (for intensity) | 4.5 t/ha | Cheney & Sullivan, *Grassfires* (2008), natural pasture |
| Rescue capacity | 6 households/hour per unit | supuesto |
| Rescue radius | 300 m | supuesto |
| Dispatch Viña del Mar | 15:10 | La Tercera (acuartelamiento) |
| Dispatch Valparaíso / Quilpué / Villa Alemana | 15:10 | supuesto (same as Viña) |
| RM reinforcement | 50 Bomba, entering on Ruta 68 at 21:00 | units: Radioprensa (announced); time: supuesto |
| Ruta 68 cut | 17:00 → open-ended | La Tercera |

### UI (Spanish)

- Panel section **"Bomberos"**: on/off switch (off by default); per cuerpo a collapsible list of companies with
  four steppers (B / F / Z / R) and a "supuesto" tag where unsourced; dispatch time per cuerpo; the reinforcement
  group(s) with count and arrival time; historical cuts on/off; buttons "Duplicar todo" / "Mitad" / "Restaurar".
- Map: cuarteles as icons, route of each unit to its site, sites with a ring per defence radius, units that
  could not reach any sector listed as "sin acceso", cut roads highlighted.
- Results: hectares, buildings reached, households cut off, households rescued, each against the same scenario
  without firefighters; units deployed / without access; the supuestos list.

### Tests

Routing respects fire closures and cuts; a defended cell does not burn while held; Forestal does nothing above
the intensity limit; zero units reproduces the no-firefighter fire bit for bit; loader rejects bad files.

## Left to the builder

Exact UI layout, map styling, the station list itself (with sources), the sector tie-breaks.
