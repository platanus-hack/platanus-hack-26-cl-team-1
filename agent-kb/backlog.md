# Backlog

Owner in brackets once someone takes an item. Project: Cortafuego (D-019). The Ojo backlog is in git history
(last Ojo commit on `main`: `a2a871e`).

## Now (status 2026-11-21 23:50; everything on `main` by 05:30)
- [ ] **Initial build** (feat/cortafuego): data pipeline, fire engine, evacuation engine, map UI, wired together
  in the browser. [Alonso + agents]
- [ ] **Calibrate and validate** against the Sentinel-2 scar: `make validate` prints the overlap (Dice) used in
  the pitch; tune `rosMultiplier` and the per-fuel factors, in-sample, and say so. [Alonso + agents]
- [ ] **Public deploy** of `web/dist` (static): pick the host (decisions.md §2) and fill `deploy-url` in
  `platanus-hack-project.jsonc`. [team]
- [ ] **Submission files:** `project-description.md`, the one-liner and description in the jsonc, a 1000×1000
  logo (≤ 500 KB), a short README written by the team. [team]
- [ ] **Pitch (3 min):** sober opening on 2 Feb 2024, live demo (wind, humidity, firebreak, alert time), the
  validation number, who pays (comunas under Ley 21.364, forestry companies, distributors, insurers). [team]

## Next
- [ ] Congestion on evacuation routes (today free flow).
- [ ] Ensemble (perturbed wind and spotting) for a burn-probability map and a range on the counts.
- [ ] A second event (Penco / Lirquén, January 2026) to show it generalises.

## Later
- [ ] Any comuna: bake the data for another bounding box from the same pipeline.

## Done
- [x] Pivot research and decision (D-019).
