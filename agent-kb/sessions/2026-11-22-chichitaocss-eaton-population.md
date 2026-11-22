# 2026-11-22 — eaton-population

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `feat/eaton-population`
- **Goal:** where people are by time of day for the Eaton fire (the population layer was Chile only).

## Done
- Asked first: US time-of-day values, cited (not the Chilean ones); GHS-POP for residents once WorldPop USA
  turned out unreadable by window (data.worldpop.org ignores HTTP Range; 1.51 GB at ~0.3 MB/s).
- Pipeline: regional population bake (`bake_population.py --event eaton-2025`, `Event.population_regional`):
  GHSL GHS-POP 2025 + GHS-BUILT-V NRES 2025, tile R6_C7, gravity model (10 km, cut at 30 km) on the Eaton grid +
  60 km, refined mass-conserving onto the 60 m grid. Eaton grid 449,921 residents, 281,455 at work hours; inside
  the perimeter 24,145 / 3,496; Pasadena centre day/night 2.31, Altadena 0.27. Chile's national product, Viña and
  Talca byte-identical; other Eaton files byte-identical.
- Web: `EventDef.presence` (params + source); Eaton uses LA County shares (ACS 2020-2024 5-year: commuters 0.396,
  students 0.243) and the Pasadena Unified calendar (winter break 23 Dec - 3 Jan). `inSchoolTerm` handles ranges
  that cross New Year (test). Eaton's population layer is on.

## Decisions
- None new: per-event values follow D-030; the residents source for Eaton differs from Chile's and is said so in
  "Fuentes", `pipeline/README.md` and the population MODEL.md.

## Open / blocked
- GHS-POP residents not checked against the Census; the Chilean 10 km commuting kernel is short for Los Angeles.
- ACS 1-year 2024 tables were not served by Census Reporter for LA County; the 5-year release (2020-2024) includes
  the pandemic's higher work-from-home share.

## Next
- Eaton firefighters; fit the fire model on both fires.
