# Population model: where people are by time of day

An estimate, not a count. It answers "how many people are in this place at this hour" for any place in Chile.
Night: residents at home. Weekdays: residents at their workplace or school. Weekends: at home. The fire and
evacuation engines do not use it yet. The explorer uses it for one number, the people present where the fire
arrives at the time it arrives, and for a map layer.

## Two baked layers (pipeline/steps/population.py)

Both layers hold the same people, with the same national total:

- **home**: residents per cell. Source: WorldPop 2024, constrained to settlements, 3 arc-seconds (~100 m),
  R2025A v1 (CC BY 4.0). National total 19,714,431. That is a modelled estimate, higher than the 18,480,432
  persons counted by Censo 2024. It is not rescaled.
- **work**: where those residents are if every one of them is at their workplace or school. Each 30" cell
  (~0.9 km) sends its residents to non-residential building volume: GHSL GHS-BUILT-V NRES 2025, 3" (European
  Commission, JRC; CC BY 4.0). The model is origin-constrained gravity:

  ```
  work_j = sum_i home_i * NRES_j K(d_ij) / sum_k NRES_k K(d_ik),   K(d) = exp(-d / 10 km) for d <= 30 km, else 0
  ```

  - Residents with no non-residential building within 30 km work where they live (24,034 people nationally).
  - Non-residential volume in Argentina, Bolivia and Peru is masked out (geoBoundaries ADM0, simplified). We mask
    the neighbours, not Chile itself: a 1:10M Chile outline misses the residents of Punta Arenas and Chiloé.
  - The convolution runs in latitude bands, each with its own kernel. Every origin uses its own band's kernel
    for both the denominator and the spreading, so `sum(work) == sum(home)` exactly, even across band edges
    (`tests/test_population.py`).
  - **Volume, not surface.** With GHS-BUILT-S (footprint), Santiago's centre had fewer people by day than by
    night (work/home 0.42). Volume counts floors, so office towers weigh more than warehouses.

The national product is `web/public/data/national/population_cl.{json,bin}` (255,736 cells, 4.1 MB). On the
60 m simulation grid, each national cell's home goes to its WorldPop pixels and its work to its GHSL pixels, in
proportion to volume. Each 3" pixel is then split into 6 x 6 sub-pixels and binned onto the 60 m cells, which
conserves the totals. The grid's work total (839,633) is lower than its home total (901,349): commuters cross
its edges, e.g. to central Valparaíso, which lies mostly west of the grid.

## Who is away, and when (index.ts)

```
people(cell, t) = home + away(t) * (work - home)
away(t) = workerShare * workSchedule(hour)  +  [school day] studentShare * schoolSchedule(hour)
```

| Parameter | Value | Source / status |
|---|---|---|
| `workerShare` | 0.503 | INE ENE Oct-Dec 2024: labour force 10.12 M, unemployed 817,996, so ~9.30 M employed; / 18.48 M (Censo 2024) |
| `studentShare` | 0.267 | Mineduc: school enrolment 2025 3,541,790 + higher education 2024 1,385,828; / 18.48 M |
| `workSchedule` | 0 until 07:00, 1 from 09:00 to 18:00, 0 from 20:00 | assumption |
| `schoolSchedule` | 0 until 07:30, 1 from 08:30 to 15:30, 0 from 17:00 | assumption (full school day) |
| school term | 1 Mar to 15 Dec, without 1-14 Jul | approximation; the real calendar varies by year and region |
| weekend | everyone home | assumption (requested for this model) |

The explorer can replace the real date: "Fecha real", "Hábil con clases", "Hábil sin clases" or "Fin de semana".
The real date of the scenario, 2 Feb 2024, was a Friday in the summer holidays, so workers are out and students
are not.

## Checks (pipeline/population_report.py)

Ratio of the work layer to the home layer, i.e. the most a place can grow or empty out when everyone is at
work or school. At a weekday 11:00 in term, 77 % of residents are away, so the actual change is about 77 % of
this ratio's distance from 1.

| Place (rough box) | home | work | work / home |
|---|---:|---:|---:|
| Providencia / Las Condes, El Golf | 73,877 | 215,359 | 2.92 |
| Viña del Mar, centro | 53,641 | 128,398 | 2.39 |
| Valparaíso, plan | 46,579 | 101,788 | 2.19 |
| Santiago, centro (~3 x 3 km) | 184,908 | 184,294 | 1.00 |
| Concepción, centro | 96,045 | 69,139 | 0.72 |
| Quilpué + Villa Alemana | 281,327 | 231,703 | 0.82 |
| Puente Alto | 642,789 | 222,572 | 0.35 |

## Limits

- **Old downtowns are under-weighted.** Santiago's and Concepción's centres do not fill up by day, unlike what
  their known daytime crowds suggest. GHSL most likely classifies much of their dense mixed-use fabric as
  residential. A better job layer (business POIs, the origin-destination surveys of Santiago, Valparaíso and
  Concepción, or SII employment by comuna) is the next step.
- Building volume stands in for jobs. Warehouses, ports and malls draw people in proportion to their volume,
  whatever their real staff. Farm work, fishing and other work outside buildings is sent to the nearest towns.
- No public holidays, shift work, night work, telework, tourism or summer holidays for workers. On a February
  weekday the model sends out more workers than are actually at work.
- One commuting distance (10 km scale, 30 km cut-off) for everybody, workers and students alike. It is an
  assumption, not a measured value.
- People travelling (on the road, in transit) are counted at home or at work, depending on the ramp.
