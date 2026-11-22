# 2026-11-22 — bomberos

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/chile-firefighter-simulation-dae931`
- **Goal:** fire companies, trucks per type and route cuts as scenario variables (asked for "no assumptions":
  every open choice was asked, every unsourced number is labelled "supuesto").

## Done
- Research: no open dataset of companies and trucks in Chile (314 cuerpos, Junta Nacional Memoria 2024); no
  official truck count for 2 Feb 2024. Pieces: Viña acuartelamiento 15:10, Ruta 68 cut from 17:00, ~30 min
  without radio after 18:30 (La Tercera, 14 Apr 2024); ~50 RM trucks announced on the 2nd (Radio Prensa);
  ~140 vehicles of 80 cuerpos over the whole event (The Clinic, 7 Feb 2024); a Valparaíso ladder company
  dispatched ~19:00, "first firefighters" in El Olivar, 20–30 houses saved (BioBioChile, 8 Feb 2024); the
  Cámara's commission: the four cuerpos were overwhelmed, hydrant over-demand (BCN summary).
- Decisions taken in the Q&A: ship tonight in a reduced version; trucks both protect houses and hold the front;
  automatic dispatch; cuts = fire + historical (user closures only for evacuation); zone + reinforcements;
  1 Bomba "supuesto" where unsourced; four types; off by default; approach A (two passes).
- `brigades.json` (29 companies from OSM, RM reinforcement, Ruta 68 cut), contract, loader, brigade engine,
  fire `defense`, worker two-pass, "Bomberos" panel section and map layers. 97 tests; `pnpm validate` unchanged.

## Decisions
- D-026 (firefighting; renumbered from D-022 after merging main as an optional two-pass scenario layer).

## Open / blocked
- Truck inventories per company are supuestos except Valparaíso 10ª; tank, flow, radii, rescue rate too.
- Valparaíso companies west of the grid and unnamed OSM stations (e.g. Villa Alemana 3ª) are not included.

## Next
- See backlog "Next" (Bomberos).
