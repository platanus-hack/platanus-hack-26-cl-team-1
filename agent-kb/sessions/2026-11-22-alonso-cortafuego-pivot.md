# 2026-11-22 — cortafuego-pivot

- **Who:** alonso (+ agent)
- **Branch / PRs:** `feat/cortafuego` (replaces the whole tree)
- **Goal:** drop Ojo and ship an initial build of Cortafuego, a wildfire + evacuation scenario simulator.

## Done
- Pivot research (Sat 22:30–23:20): past Platanus winners, the 47 other Santiago repos, Bogotá's Simulations
  track, simulation startups and Chilean open data. The Santiago Simulations track is mostly agent/what-if
  simulators on maps of Chile; nobody simulates physical phenomena. Five finalists were red-teamed (tsunami,
  wildfire, crowd evacuation, tangible wind/sun table, LLM-designed towers on a shake table) plus a
  drug-interaction idea; the team picked the wildfire (D-019).
- Removed every Ojo folder (`contracts`, `server`, `sim`, `training`, `web`, `gpu`, `deploy`, `tasks`, old docs)
  and `cd-demo.yml`; CI now runs actionlint, the CI tooling tests, ruff on `pipeline/` and the web job.
- `pipeline/` bakes `web/public/data/` (14 MB) on a 464 × 529 grid of 60 m cells: Copernicus GLO-30, ESA
  WorldCover 2021, 321,533 Overture buildings, an OSM street graph (55k nodes, 71k edges), ERA5 weather via
  Open-Meteo, 1,122 NASA FIRMS detections, a Sentinel-2 dNBR scar (9,467 ha) and two approximate ignitions.
- `web/src/engine/fire/`: McArthur Mk5 / CSIRO grassland ROS, slope + wind vector, elliptical spread,
  16-neighbour minimum-travel-time propagation with anchors, gated ember spotting; 30–130 ms per run.
- `web/src/engine/evac/`: latest-departure label-setting search per mode on the street graph, lognormal
  preparation, per-household risk, flow per street, risk-vs-alert curve; 60–100 ms per run.
- `web/src/ui`, `worker`, `data`: MapLibre map (OpenFreeMap + AWS terrain, 3D, offline hillshade fallback),
  clock and playback, controls for weather (real ERA5 with adjustments, or constant), ignitions, spotting,
  firebreak drawing, alert time, preparation, foot share, closing streets, emergency links; results,
  baseline deltas, validation numbers.
- Calibration (`pnpm validate`): spotting raised to 25 m per km/h so the western front reaches Villa
  Independencia around 19:00 with the unmodified ERA5 wind; built-up cells spread slower and throw no embers;
  the simulation stops at midnight (no suppression in the model). Dice vs the scar at 00:00: 0.571;
  203 of 237 FIRMS detections of 2 Feb already reached by the model at detection time. In-sample.

## Decisions
- D-019: pivot to Cortafuego; D-001, D-005, D-008 to D-018 moved to §3.

## Open / next
- The model reaches ~21k buildings by midnight, but only ~1.9k of the 6,505 inside the real scar: where it
  burns inside the city is the weakest part. The trapped-households count inherits that.
- Public deploy host (decisions.md §2); `deploy-url` is still empty.
- `docs/PR_REVIEW_FOCUS.md` still describes Ojo's pitfalls: update it in its own PR.
