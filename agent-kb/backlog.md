# Backlog

Owner in brackets once someone takes an item. Project: Cortafuego (D-019). The Ojo backlog is in git history
(last Ojo commit on `main`: `a2a871e`).

## Now (status 2026-11-21 23:50; everything on `main` by 05:30)
- [ ] **Initial build** (feat/cortafuego): data pipeline, fire engine, evacuation engine, map UI, wired together
  in the browser. [Alonso + agents]
- [ ] **Calibrate and validate** against the Sentinel-2 scar: `make validate` prints the overlap (Dice) used in
  the pitch; tune `rosMultiplier` and the per-fuel factors, in-sample, and say so. [Alonso + agents]
- [ ] **Submission files:** `project-description.md`, the one-liner and description in the jsonc, a 1000×1000
  logo (≤ 500 KB), a short README written by the team. [team]
  - Logo ready (D-025): `project-logo.svg` and `project-logo.png` (1000×1000, 58.9 KB); remaining submission
    text still needs the team's review.
- [ ] **Pitch (3 min):** sober opening on 2 Feb 2024, live demo (wind, humidity, firebreak, alert time), the
  validation number, who pays (comunas under Ley 21.364, forestry companies, distributors, insurers). [team]

## Next
- [ ] Evacuation by time of day: people per building at the alert time from the population layers (D-024),
  instead of a fixed 2.9 per household; offices and schools as origins on weekdays.
- [ ] Better job proxy for old mixed-use centres (business POIs, the origin-destination surveys, SII employment by
  comuna); public holidays and February vacations in the presence model.
- [ ] Congestion on evacuation routes (today free flow).
- [ ] Ensemble (perturbed wind and spotting) for a burn-probability map and a range on the counts.
- [ ] A second event (Penco / Lirquén, January 2026) to show it generalises.

## Later
- [ ] Any comuna: bake the data for another bounding box from the same pipeline.

## Done
- [x] **Where people are by time of day, all of Chile** (D-024): national population product + grid layers,
  presence model, "personas donde llega el fuego" and a map layer. Branch `feat/population-by-hour`.
- [x] Pivot research and decision (D-019).
- [x] **Public deploy:** Render Static Site behind Cloudflare at https://cortafuego.app (D-022), with
  `www` redirecting to the apex. Deployment metadata and session notes are on `codex/render-cloudflare`.
- [ ] **Auto-deploy:** CI-gated Render hook on merged `main` commits (D-023), implemented in
  https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/51; first post-merge deployment pending.
