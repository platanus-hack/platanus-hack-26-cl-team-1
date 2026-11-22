# Backlog

Owner in brackets once someone takes an item. Project: Cortafuego (D-019). The Ojo backlog is in git history
(last Ojo commit on `main`: `a2a871e`).

## Now (status 2026-11-21 23:50; everything on `main` by 05:30)
- [ ] **Initial build** (feat/cortafuego): data pipeline, fire engine, evacuation engine, map UI, wired together
  in the browser. [Alonso + agents]
- [ ] **Calibrate and validate** against the Sentinel-2 scar: `make validate` prints the overlap (Dice) used in
  the pitch; tune `rosMultiplier` and the per-fuel factors, in-sample, and say so. [Alonso + agents]
  Pace against satellite passes (GOES-16 + VIIRS/MODIS) done (D-027) [Anaís + agent].
- [ ] **Submission files:** `project-description.md`, the one-liner and description in the jsonc, a 1000×1000
  logo (≤ 500 KB), a short README written by the team. [team]
  - Logo ready (D-029): `project-logo.svg` and `project-logo.png` (1000×1000, 32.5 KB); remaining submission
    text still needs the team's review.
  - Web identity ready: header mark, SVG/ICO favicons, Apple touch icon and manifest app icons, generated
    from the same SVG source (D-029).
  - Animated splash ready: the canonical flame is cut by its diagonal firebreak, with a short exit fade,
    reduced-motion support and a skip control; loading and worker initialization continue behind it.
  - README refreshed in Spanish with a human-centered Cortafuego overview, scenario explanations and public demo;
    removed template instructions and the obsolete deployment-mirror guide. Ready for team review.
- [ ] **Pitch (3 min):** sober opening on 2 Feb 2024, live demo (wind, humidity, firebreak, alert time), the
  validation number, who pays (comunas under Ley 21.364, forestry companies, distributors, insurers). [team]
  - The site now opens on today's forecast (D-028): open the demo at `https://cortafuego.app/?escenario=vina-2024`.
  - Hypothetical Maule demo (D-032): `https://cortafuego.app/?escenario=talca` (Talca, 8 Feb 2025 weather,
    one hypothetical ignition at 14:00). [Anaís + agent]

## Next
- [ ] Maule (Talca box): the preset start sits in the box's south fifth, so a strong-wind fire reaches the north edge
  (21:21 at wind ×1.5). Re-centre or move the box north and re-bake. Talca's cropland factor (27 % of cells) was never
  fitted, and many valley-floor FOREST cells are probably orchards (2026-11-22 fire-edge-notice session log).
- [ ] Plan de preparación (D-033), next: ignitions sampled from fire records, several weather days, a
  street-link optimizer (exact incremental evaluator in the 2026-11-22 optimizer session log), a geofenced alert mode.
- [ ] Western stall of 14:05–16:25 (satellite) not reproduced: needs a cause the data shows (initial attack?
  local wind?); see `web/src/engine/fire/MODEL.md` section 6.
- [ ] Pace back test polish (review of PR #53): GOES half-pixel 1.0 km vs a ~2.5–3 km pixel, look fires up by
  id in `calibrate.ts`, check the 10-min GOES slots by name, score extent instead of lag once the observed
  front stops.
- [ ] Bomberos (D-026): real inventories per company (ask each cuerpo), reopening time of Ruta 68, hydrant
  availability as a variable, congestion slowing the trucks, units that move between sectors.
- [ ] Scenario from scratch: load `national/bomberos_cl.json` (`loadNationalStations` + `stationsInBox`, D-031) for the
  scenario's box; each cuerpo needs a dispatch time. Real inventories go into `pipeline/bomberos/fleets.json`.
- [ ] Evacuation by time of day: people per building at the alert time from the population layers (D-024),
  instead of a fixed 2.9 per household; offices and schools as origins on weekdays.
- [ ] Better job proxy for old mixed-use centres (business POIs, the origin-destination surveys, SII employment by
  comuna); public holidays and February vacations in the presence model.
- [ ] Congestion on evacuation routes (today free flow).
- [ ] Ensemble (perturbed wind and spotting) for a burn-probability map and a range on the counts.
- [ ] **Fit on both fires** (Viña + Eaton, D-030): out of sample the Viña calibration overburns Eaton ~2.6×; tune
  the spread factors on both together, keep a fit only if Viña does not get worse. [Anaís + agent]
- [ ] Score Eaton buildings against CAL FIRE DINS (`dins.json`, 9,419 destroyed) instead of scar cells.
- [ ] Viña scar reflectance offset (decisions §2).
- [ ] A third event (Penco / Lirquén, January 2026).

## Later
- [ ] Any comuna: bake the data for another bounding box from the same pipeline.

## Done
- [x] **Eaton firefighters**: 17 stations (LA County LMS), Pasadena FD trucks from its 2025 Standards of Cover,
  LA County counts, one engine as supuesto where nothing is published; all leave 18:18 (supuesto). Branch
  `feat/eaton-firefighters`. [Anaís + agent]
- [ ] Eaton firefighters: mutual aid (strike teams arrived through the night), real dispatch times, US tank sizes.
- [x] **Eaton population layer**: regional bake (GHSL GHS-POP 2025 residents, since WorldPop USA cannot be read by
  window; NRES volume and the same gravity model on the grid + 60 km); LA County shares (ACS 2020-2024) and the
  Pasadena Unified calendar as Eaton's presence parameters. Branch `feat/eaton-population`. [Anaís + agent]
- [ ] Check Eaton's GHS-POP residents against the Census (24,145 inside the perimeter; Altadena CDP has 15,092
  households x 2.70 per ACS) and try WorldPop USA when it can be downloaded.
- [x] **Every fire company of Chile with its trucks** (D-031): 1,256 compañías (JNB catastro 2025), documented fleets
  for 330, the rest matched to the JNB register 2025 per region and type. Branch `feat/bomberos-chile-dataset`.
  [Anaís + agent]
- [x] Bomberos: companies, trucks per type, dispatch, Ruta 68 cut, defended cells, rescue (D-026). [Anaís + agent]
- [x] **Scenario that starts today** (D-028): opens by default on today's forecast over the same territory; the
  2 Feb 2024 replay is in the picker and at `?escenario=vina-2024`. Branch `feat/scenario-today`.
- [x] **Where people are by time of day, all of Chile** (D-024): national population product + grid layers,
  presence model, "personas donde llega el fuego" and a map layer. Branch `feat/population-by-hour`.
- [x] Pivot research and decision (D-019).
- [x] **Public deploy:** Render Static Site behind Cloudflare at https://cortafuego.app (D-022), with
  `www` redirecting to the apex. Deployment metadata and session notes are on `codex/render-cloudflare`.
- [ ] **Auto-deploy:** CI-gated Render hook on merged `main` commits (D-023), implemented in
  https://github.com/platanus-hack/platanus-hack-26-cl-team-1/pull/51; first post-merge deployment pending.
