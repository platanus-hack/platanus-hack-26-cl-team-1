# Decisions

Format: `D-NNN — title (YYYY-MM-DD)` + context, decision, consequences. Superseded decisions move to §3
with a pointer to their replacement; nothing is ever deleted from §3.

## §1 In force

### D-002 — Start from an empty tree; reuse the old code through git history (2026-11-21)
- **Context:** the old code is large (500+ files) and most of it (circuit sim, Blockly, compile) is irrelevant;
  a few pieces (camera streaming, VLM serving, TTS queue, QLoRA) are directly reusable.
- **Decision:** remove everything except the hackathon files. `docs/LEGACY.md` describes the old project,
  pins its last commit `2e9da7c`, and maps what to reuse and how (`git show 2e9da7c:<path>`).
- **Consequences:** CI/CD and `render.yaml` are gone too, so pushes to `main` no longer deploy; the old Render
  services keep serving the old build until someone turns them off.
- **Amended by D-016:** green pushes to `main` deploy again, now to the demo on the 5090 (D-015), not Render.

### D-003 — Lightweight agent-kb: backlog, decisions, per-session files (2026-11-21)
- **Context:** three people plus parallel agents; ~18 h left. A heavier protocol (per-file decisions, generated index,
  validators) costs more than it returns here.
- **Decision:** `agent-kb/` with `backlog.md`, `decisions.md` and `sessions/YYYY-MM-DD-<handle>-<slug>.md`,
  plus the rules in `CLAUDE.md` (`AGENTS.md` points to it).
- **Consequences:** every session reads the backlog, recent sessions and decisions first, and logs itself at the end.

### D-004 — Docs and code in English, UI in Spanish (2026-11-21)
- **Context:** same split as before; the pitch and users are Chilean, tooling and agents work best in English.
- **Decision:** identifiers, comments, docs and agent-kb in English; every user-visible string and the voice in Spanish.
- **Consequences:** prompts that generate spoken text must ask for Spanish output.

### D-019 — Pivot to Cortafuego, a wildfire and evacuation scenario simulator (2026-11-21)
- **Context:** late Saturday the team judged Ojo (the camera supervisor, D-001) weak for the Simulations track:
  the flight simulator was bolted on, and the track was already full of agent/what-if simulators on maps of
  Chile (the prediction-market favourites Sub50, santiaguito.cl and Agarra la pala are all in it). A research
  pass (past Platanus winners, the 47 other Santiago repos, Bogotá's Simulations track, simulation startups,
  Chilean open data) found that nobody at the event simulates physical, interactive phenomena such as fire.
- **Decision:** replace the whole tree with **Cortafuego**: a static web app that replays the 2 Feb 2024 fire in
  Viña del Mar / Quilpué / Villa Alemana on real open data (Copernicus DEM, ESA WorldCover, Overture/OSM
  buildings and streets, Open-Meteo/ERA5 weather, NASA FIRMS, a Sentinel-2 burn scar) and lets the user change
  wind, humidity, temperature, drought, ignitions, firebreaks, the alert time and evacuation routes.
  - Fire: McArthur Mk5 forest / CSIRO grassland rate of spread, slope + wind as one vector, elliptical spread,
    minimum-travel-time propagation on a 60 m grid, ember spotting.
  - Evacuation: latest-departure search on the street graph per mode (foot/car), lognormal preparation time,
    free flow (no congestion yet).
  - Everything runs in the browser (Web Worker); the data is baked once by `pipeline/` into `web/public/data/`.
  - The shared contract is `web/src/engine/types.ts` (replaces the pydantic `contracts/` package of D-009).
- **Consequences:** D-001, D-005 and D-008 to D-018 are superseded (moved to §3); D-002 (old code lives in git
  history, last Ojo commit `a2a871e`), D-003, D-004, D-006 and D-007 stay. The GPU box, vLLM, the WebSocket
  server and the box CD (`cd-demo.yml`) are gone; the public link must be a static host. Tone rule in CLAUDE.md:
  prevention framing, no claims about the official alert without a source.

### D-020 — CI is just Lint + Test; no agent reviewers, no auto-merge (2026-11-22)
- **Context:** the Cortafuego PR (#48) replaced the whole tree, and GitHub refuses the diff of a PR over 300
  files, so both reviewer jobs failed before reviewing anything. `main` has no branch protection or required
  checks, so `auto-merge.yml` never armed a PR either (it only arms a PR GitHub reports as BLOCKED). With hours
  left, the team wants the classic setup.
- **Decision:** `.github/workflows/ci.yml` has two jobs:
  - **Lint:** ruff on `pipeline/`, `tsc` on `web/`.
  - **Test:** pytest on `pipeline/`, vitest and the production build on `web/`.
  Removed: `code-review.yml`, its helpers (`scripts/ci/`), `docs/PR_REVIEW_FOCUS.md`, `auto-merge.yml`, the
  `CI OK` aggregate and the actionlint job. This supersedes D-006 and D-007 (moved to §3).
- **Consequences:** PRs are merged by hand once Lint and Test are green. Nothing checks workflow files any more.

### D-021 — Urban fuels split by nearby vegetation; cue-driven evacuation; calibrated ERA5 wind rotation (2026-11-22)
- **Context:** the first build reached ~21k buildings by midnight but only 1,875 of the 6,505 inside the real
  Sentinel-2 scar, and reported ~9,700 households cut off with an 18:00 alert. Diagnosis: the head went NNE into
  Quilpué (ERA5 wind 204–207°) instead of N into El Olivar / Villa Independencia; almost all urban burning came
  from embers landing on consolidated city; burned buildings sit within ~240 m of shrub/forest (none beyond 480 m).
- **Decision (contract: `types.ts`):**
  - `URBAN_LOW` now means **intermix** (built-up with ≥ 40 % green share over 180 m, from WorldCover 2021 and
    pre-fire Sentinel-2 NDVI of 2024-01-18) and `URBAN_DENSE` means **consolidated**; `pipeline/steps/wui.py`
    writes `fuel.bin`. Embers do not land on consolidated cells (`spotTarget` in `FIRE_MODEL`).
  - `EvacParams` gains `cueShare` (0.65) and `cueRadiusM` (900 m): that share of households starts its response
    when the fire comes within that distance, if earlier than the official alert (NIST TN 2103, Kincade).
  - The historical ERA5 wind direction is rotated −10° (`ERA5_WIND_DIR_CORRECTION_DEG`): one fitted scalar, not
    an observation (the nearby Concón station reads 220°), shown as such in the UI.
- **Consequences:** buildings in the scar reached 1,875 → 5,423 (83 %), Dice 0.571 → 0.628, cut-off households
  at an 18:00 alert 9,719 → 4,753; but total buildings reached rose to 28,119 (precision 0.19) and the counts
  swing from a third to 3× under ±20 % wind. The UI now calls them "hogares con la salida cortada" and says the
  absolute numbers are an exposure ceiling (no firefighting, no rescue); the pitch compares scenarios. Scar and
  FIRMS are used only to score and to pick global scalars (in-sample, disclosed).

### D-022 — Render Static Site behind Cloudflare on cortafuego.app (2026-11-22)
- **Context:** the user selected Render for the public static deployment and Cloudflare for the custom domain,
  and requested Firefox for dashboard changes. The current app needs no backend or secrets.
- **Decision:** deploy the public organizational repository's `main` branch as the Render Static Site
  `cortafuego` (`srv-dc170amc6qcc73covp10`), root `web`, publish directory `dist`, Node 24. Build with
  `npx --yes pnpm@10.34.9 install --frozen-lockfile && npx --yes pnpm@10.34.9 build` and
  `SKIP_INSTALL_DEPS=true` to avoid a second, implicit dependency installation.
  - `cortafuego.app` and `www.cortafuego.app` are proxied Cloudflare CNAMEs to `cortafuego.onrender.com`.
    Both were DNS-only until Render reported **Verified / Certificate Issued**. Render redirects `www` to apex.
  - Cloudflare: Full (Strict), Always Use HTTPS, minimum TLS 1.2, TLS 1.3, HTTP/2, HTTP/2 to origin, HTTP/3,
    Early Hints, Standard caching, and Browser Cache TTL **Respect Existing Headers**. Rocket Loader stays off;
    no paid upgrades or analytics beacon were enabled.
  - Render headers: `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`; `/`, `/index.html`
    and `/data/*` get `Cache-Control: no-cache`. All paths get `X-Content-Type-Options: nosniff` and
    `Referrer-Policy: strict-origin-when-cross-origin`.
- **Consequences:** https://cortafuego.app is the public link; https://cortafuego.onrender.com remains available.
  Public Git source avoids granting a GitHub integration access or creating a mirror. The creation form says
  public-repository auto-deploy and PR previews require Blueprints; automatic release delivery has **not** been
  verified. Use Render **Manual Deploy → Deploy latest commit** for subsequent releases until CD is configured.
  Do not cache unversioned dataset files long-term or enable blanket Cache Everything: an older data grid can
  conflict with a newer engine. First deploy of `842d870` succeeded; Firefox loaded the map and worker results
  over HTTPS, including after navigating through `www`.

### D-023 — Deploy merged main commits to Render after CI passes (2026-11-22)
- **Context:** the user requested auto-deploy on "master merge"; the repository's actual default/release branch
  is `main`. D-022's public Git deployment had no verified native auto-deploy integration.
- **Decision:** extend `.github/workflows/ci.yml` with a deployment job that needs both **Lint** and **Test**
  and runs only for a `push` to `main` (merging a PR creates that push). PRs and manual CI runs do not deploy.
  - Store only Cortafuego's existing service-scoped hook in the encrypted repository secret
    `RENDER_CORTAFUEGO_DEPLOY_HOOK`; do not reuse the previous app's API/WEB/WORKER hook secrets.
  - Pass the tested `${GITHUB_SHA}` as Render's `ref`, and skip a run if `main` has advanced. Queue deploy jobs
    without cancelling in-flight requests. A missing secret, wrong service URL, or failed request fails visibly.
  - Render's native Auto-Deploy is **Off** so it cannot race ahead of CI or duplicate GitHub's trigger.
  - The job needs only `contents: read`, checks out no code, and never logs the secret URL. HTTP 200/202 means
    Render accepted the request; Render's deployment page remains the source of truth for build success.
- **Consequences:** D-022's manual-deploy fallback is replaced once this workflow is merged and its first
  post-merge deployment is verified. D-020's Lint/Test validation and manual squash PR merge policy remain;
  automatic deployment is not automatic PR merging. No `master` branch is created or monitored.

### D-024 — Population by time of day for all of Chile: two baked layers + a presence model in the browser (2026-11-22)
- **Context:** to recreate fires anywhere in Chile at any hour, we need to know where people are: at home at
  night and on weekends, and at work or school on weekdays. The 60 m grid only had buildings, with a fixed 2.9
  persons per household.
- **Decision (contract: `types.ts`):**
  - **Data.** `pipeline/steps/population.py` bakes two layers with the same people:
    - home: WorldPop 2024 constrained, 100 m;
    - work: residents sent to GHSL non-residential building **volume** 2025 by an origin-constrained gravity
      model (exp(-d / 10 km), cut at 30 km), with Argentina, Bolivia and Peru masked out.
    - Building volume, not footprint: with footprint, Santiago's centre emptied out by day.
  - **Files.** The national product (30", sparse, 4.1 MB) is committed in `web/public/data/national/`. The grid's
    `population_home.bin` / `population_work.bin` are refined from it in a mass-conserving way. `make population`
    re-bakes both; `bake.py` only refines.
  - **Who is out, and when.** This is `src/engine/population` (`PresenceParams`, `POPULATION_DAY`), applied in the
    browser:
    - 50.3 % employed (INE ENE Oct-Dec 2024 / Censo 2024);
    - 26.7 % students (Mineduc), only in term;
    - assumed 09-18 h and 08:30-15:30 schedules with ramps;
    - weekends at home.
- **Consequences:**
  - The explorer shows the people present where the fire arrives, each cell at its arrival time, and a
    "Personas a esta hora" map layer. A day selector (real date / school weekday / weekday without classes /
    weekend) changes only those, not the evacuation: the evacuation engine still uses 2.9 persons per building.
  - The page downloads 2 MB more; the national file is not loaded.
  - Known weakness: old mixed-use centres (Santiago, Concepción) are under-weighted as job centres
    (`pipeline/population_report.py`).

### D-026 — Firefighting as an optional two-pass scenario layer (2026-11-22)
- **Context:** the team wants fire companies, trucks per type and route cuts as scenario variables. No open
  dataset lists Chile's companies with their trucks, and there is no official count for 2 Feb 2024; the fire
  calibration (Dice 0.628) already contains, without separating it, whatever suppression happened that day.
- **Decision (contract: `types.ts`; decided with Anaís in a Q&A, design in
  `docs/superpowers/specs/2026-11-22-bomberos-design.md`):**
  - Hand-curated `web/public/data/brigades.json`: the 29 named companies of the four cuerpos in the grid (OSM),
    trucks per type `[Bomba, Forestal, Aljibe, Escala/rescate]` (1 Bomba "supuesto" where there is no source),
    dispatch per cuerpo, a Región Metropolitana reinforcement, and the Ruta 68 cut from 17:00.
  - `src/engine/brigade/`: pass-1 fire → street closures by fire + historical cuts → earliest-arrival routing
    → greedy sector dispatch → water windows → `FireInput.defense` (Bomba: structures, no limit; Forestal:
    wildland up to 1,730 kW/m, GTR INT-131) → pass-2 fire → evacuation → rescue by Escala/rescate units.
  - Off by default; with it on the UI compares against the same scenario without firefighters. "Cerrar calle"
    affects only the evacuation. Every unsourced number is labelled "supuesto" in code and UI.
- **Consequences:** the validation number does not change (off by default). Defaults: 79 trucks, −1,191
  buildings reached and −62 households cut off at an 18:00 alert (`scenarios.ts`). Absolute effects rest on
  supuestos (tank, flow, radii, rescue rate): present them as comparisons between resource scenarios.

### D-027 — Calibrate the pace against satellite passes; GOES-16 as a source; matorral at half of forest (2026-11-22)
- **Context:** the validation scored the burn scar at midnight and FIRMS one-sidedly ("detections already
  reached"), which cannot see a fire that is early. A back test against satellite passes showed the western head
  ~1 h early at 16:05 and ~40 min late at 19:05, and the eastern fire early all afternoon.
- **Decision:**
  - The satellite is the reference for timing; the press times are shown next to it, not fitted.
  - `pipeline/steps/goes.py` bakes GOES-16 fire pixels every 10 min (`goes.json`, same shape as `firms.json`,
    scoring only). `pacing.ts` scores the front lag in both directions; `calibrate.ts` fits on GOES-16 + scar +
    buildings and reports VIIRS/MODIS as the out-of-sample test.
  - Knobs are ranked by their mean objective at ERA5 wind ×0.9 / ×1 / ×1.1 (robust scan), so a knife-edge fit
    does not ship.
  - Shipped: McArthur ×4 (was ×3) and matorral at half of it (`FIRE_MODEL.fuels[SHRUB].factor` 0.5).
  - Tested and not shipped: the Concón METAR as weather, intensity-scaled embers, a per-cell ember-jitter
    ensemble, faster ember jumps (knobs left at 0 in the engine). Ignitions unchanged.
- **Consequences:** robust objective 0.372 → 0.470. At wind ×1, while the real fires were advancing (to
  19:05 / 19:15) the GOES RMS lag is west 30 → 30 min and east 39 → 28 min, VIIRS/MODIS mean |lag| 42 → 34 min;
  over 12:00–24:00 it is 47 → 55 and 110 → 76 min (62 → 55 min test), most of it the model's overshoot after the
  real fires stopped (no suppression). Also Dice 0.628 → 0.639, buildings in the scar 83 % → 89 %,
  households cut off at an 18:00 alert 4,753 → 4,061. The western stall of 14:05–16:25 is still not reproduced;
  McArthur ×4 is above Project Vesta's 2–3× range; all of it is in-sample except the VIIRS/MODIS test.
  Details: `web/src/engine/fire/MODEL.md` section 6.

### D-028 — The app opens on a scenario that starts today; the 2024 fire is one choice in a picker (2026-11-22)
- **Context:** the user asked for a new scenario whose timeline starts today, with existing scenarios such as
  Viña del Mar 2024 as options, and for the app to open on the new one by default.
- **Decision (contract: `types.ts` gains the closed set `TIMELINE` = `hoy` | `vina-2024`):**
  - **Today** (`src/data/timeline.ts`): the same territory, buildings, streets and population layers; the
    window is the whole day, **00:00 to 24:00** today (America/Santiago); the weather is today's hourly
    **Open-Meteo forecast** at the weather.json point, fetched in the browser (`src/data/forecast.ts`) and
    checked like weather.json; the two 2024 ignition points and the 18:00 default alert at the same time of
    day; no FIRMS; the Validación section is hidden; the 2024 scar stays as a reference layer.
  - **Each timeline has its own window** (`Dataset.horizonMin`, `defaultAlertMin`): today is 24 h; a known
    event keeps its validated, real duration (the 2024 replay stays 12:00 to midnight, because the model has
    no suppression and is scored at 00:00), which may be shorter or longer than 24 h.
  - The ERA5 −10° wind-direction correction (D-021) is **not** applied to the forecast:
    `Dataset.windDirCorrectionDeg` carries it per timeline.
  - The fire companies (D-026) keep their 2024 dispatch, reinforcement and Ruta 68 cut times at the same time
    of day; the cut is labelled "como el 2 feb 2024".
  - The 2024 timeline is the baked files as they are; this decision does not change its numbers.
  - A top-bar picker switches; `?escenario=hoy | vina-2024` opens one directly. Switching remounts the explorer
    (fresh scenario, map and worker); the worker gets the choice in `init` and derives the same dataset.
  - `?offline=1` opens on 2024 (the forecast needs the network). A failed or malformed forecast shows a visible
    error with "Reintentar" and a button to the 2024 fire; nothing falls back silently.
- **Consequences:** cortafuego.app opens on today's conditions; the pitch should link
  `?escenario=vina-2024` for the validated replay. Today's run uses pre-2024 fuels (inside the 2024 scar it
  assumes the vegetation before that fire, not today's burned and regrowing cover) and a drought factor of 10
  by default: the panel says so and frames it as a comparison, not a prediction. The day-of-week sentence is
  worded as the presence model's assumption (approximate school calendar, no holidays).
  Open-Meteo lists uniform hours in one UTC offset for the whole request (checked across the clock changes
  of 2025-04-06 and 2025-09-07), so around a clock change the hours can read one hour off; accepted.

### D-029 — Minimal flame-and-firebreak logo, app icons and animated startup (2026-11-22)
_Written as "D-026" in the minimal-logo, app-icons and splash-animation session logs; renumbered because
D-026 to D-028 were taken by #54, #53 and the today scenario._
- **Context:** after seeing D-025's flame, masonry and wordmark, the user requested a more modern,
  minimalistic version.
- **Decision:** simplify the identity to an icon-only orange flame interrupted by one diagonal
  negative-space firebreak on dark slate. Remove the brick detail and lettering. This refines the same
  prevention concept with fewer visual elements and supersedes D-025.
- **Consequences:** `project-logo.svg` is a self-contained 969-byte vector with no external dependencies;
  `project-logo.png` is exactly 1000×1000 and 32,473 bytes. The submission dimensions and 500 KB limit remain
  satisfied. The symbol was visually checked at full size and 64×64.
- **App integration:** generate the favicon SVG/ICO, Apple touch icon, regular 192/512 px app icons and a
  separate padded maskable icon from this master with `uv run scripts/generate-icons.py` (Pillow and
  `rsvg-convert`). Small icons use tighter canvas framing without redrawing the mark; the header reuses the
  favicon SVG. `web/public/site.webmanifest` declares the app identity; no service worker or offline cache
  was added.
- **Animated startup:** the same generator exports SVG path geometry for a one-shot splash animation: the
  flame enters, a normalized SVG mask stroke reveals the existing diagonal firebreak, and the splash fades
  after the cut and actual dataset/forecast readiness. The app and worker initialize underneath an inert
  overlay. Reduced motion bypasses animation; startup errors show immediately, and a skip control avoids
  waiting for the intro. No fake progress percentage, audio, or endlessly animated flame.

### D-030 — A second baked event: the Eaton fire (California, 2025) as an out-of-sample test (2026-11-22)
- **Context:** every model number was fitted on one fire (Viña 2024). The team asked for a second real event in the
  scenario list and to use its data to improve the model. Asked and answered before building: Eaton (not
  Palisades); Viña's global sources plus US data only to score; test first, then fit on both fires; the picker
  of D-028; firefighters and population for Eaton later, after the core.
- **Decision (contract: `types.ts` `TIMELINE.EATON_2025`):**
  - The pipeline bakes one event at a time: `pipeline/steps/events.py` (grid, clock, time zone, sources, cache dir
    per event), `bake.py --event <id>`. Viña's outputs stay byte-identical at the root of `web/public/data/`; Eaton's
    go to `web/public/data/eaton-2025/` (306 × 337 cells of 60 m, t0 7 Jan 2025 18:00 PST, 18 h horizon), plus the
    official WFIGS perimeter (`perimeter.bin`) and CAL FIRE damage inspection points (`dins.json`), scoring only.
  - `web/src/data/events.ts` holds what differs per baked event: data folder, horizon, wind-direction correction
    (Viña's −10° is a site fit, 0 for Eaton), optional layers, evacuation defaults with their sources. Eaton: alert
    19:25 (first orders, east of Lake Ave; west of Lake 03:25), 2.70 persons per household (ACS B25010, Altadena),
    4 % on foot (households with no vehicle, ACS B08201; derived assumption). The today timeline stays on Viña.
  - Eaton is the third option of the scenario picker (`?escenario=eaton-2025`). Brigades and population are
    nullable in `Dataset` and the UI says "aún no hay datos" where an event lacks them.
  - `validate-event.ts` (`make validate-eaton`) runs the model as shipped, nothing tuned, and writes the score the
    "Validación" section shows.
- **Consequences:** out of sample the model overburns Eaton ~2.6× (14,942 ha by noon vs 5,689 ha perimeter; Dice
  0.34 vs the scar, 0.43 vs the perimeter, against 0.64 in-sample on Viña), reaching 95 % of the buildings in the
  scar but spreading through consolidated Pasadena. Next: fit on both fires (backlog). The bake found that Viña's
  scar uses a −0.1 reflectance offset its COGs do not need; kept for byte-identity, open in §2.

### D-031 — National fire-company dataset: JNB positions, trucks matched to the JNB register per region (2026-11-22)
- **Context:** the team is building scenarios from scratch anywhere in Chile; `brigades.json` (D-026) only covers
  the four cuerpos of the Viña del Mar grid. Anaís asked for the location of every compañía in Chile and, where
  truck fleets (count and models) cannot be found quickly, the most precise assumption possible.
- **Decision (contract: `NationalStationsFile`, `VEHICLE_KIND`, `VEHICLE_KIND_UNIT` in `types.ts`):**
  - `web/public/data/national/bomberos_cl.json`, baked by `pipeline/steps/bomberos.py` (`make bomberos`). Positions:
    JNB Catastro Nacional de Cuarteles 2025 (Geoportal de Chile) joined with the bomberos.cl list of 2024 (Itrend,
    CC BY 4.0) on (cuerpo, number); OSM and uncoded catastro cuarteles break ties. 1,256 compañías (JNB Memoria 2025: 1,262).
  - Trucks: documented per compañía in `pipeline/bomberos/fleets.json` (source URL per vehicle, `complete` flag);
    everything else is estimated so that each region's vehicles per type equal the JNB Registro Nacional de
    Material Mayor 2025 (Memoria p. 34, 4,476 in active service), shared by documented specialty and urban / rural
    weights (supuestos), with make/model drawn from the documented models and JNB bulk purchases. Estimated
    vehicles have `source: null` ("supuesto").
  - Twelve vehicle kinds (the JNB register's categories plus command / transport); `Q` porta escalas and aerials
    are `escala`; a first-response unit counts as a Forestal for the engine, ladders and rescue as Escala / rescate.
  - Not loaded by the Viña del Mar explorer; `stationsInBox()` gives `BrigadeStation[]` for any scenario box.
- **Consequences:** regional totals per type are exact against the register (except where documented vehicles
  exceed it: 15 ladders in the Metropolitana, 2 ladders and 3 hazmat units in Biobío), but a given compañía's estimated trucks are not an inventory. Aysén has
  36 stations against 29 compañías in the JNB count (likely brigadas). `brigades.json` is unchanged; its 29
  stations match the national file within 1.5 km (test).

### D-032 — A hypothetical scenario in Talca (Maule) for demos: a baked event with no observed fire (2026-11-22)
- **Context:** the user asked for data to simulate a fire in the Maule region for a demo, and chose (asked before
  building) a hypothetical fire around Talca over a replay of Santa Olga 2017, and a picker option plus a URL.
- **Decision (contract: `types.ts` `TIMELINE.TALCA`; builds on D-030's events):**
  - An event either has an observed fire (all of `events.FIRE_FIELDS`: post-fire scene, scar parameters, FIRMS,
    GOES) or none (`observed_fire` False); a mix stops at import, and a fire-less event needs fixed ignition presets.
    Its bake writes `scar.bin` all 255 ("no data"), `firms.json` `[]` and no `goes.json`; `validate_outputs`
    checks it. In the web, `EventDef.observedFire` false hides the scar layer and the Validación section.
  - `talca`: 464 × 529 cells of 60 m around Talca (whole city, Maule, Pencahue, the valley and hills SW, wooded hills
    across the Río Claro), the real ERA5 weather of a hot reference day, 8 Feb 2025 (37 °C, 13 % RH, SSW wind
    up to 25 km/h at 17:00), 12:00 to midnight, one hypothetical ignition at 14:00 on valley grassland 10 km SW of the centre of the
    city, alert 17:00 (assumption), population from the national product, no firefighters, no wind correction.
  - Picker option "Talca, Maule · hipotético" (`?escenario=talca`); a note says it reproduces no real fire and
    the model was calibrated only on Viña 2024 with no local validation.
- **Consequences:** a fixed baked day, not today's forecast, so the demo works offline from the forecast API and
  is reproducible. With the defaults the model burns ~14,100 ha by midnight and reaches ~34,700 buildings; like
  Viña and Eaton it overburns (no suppression), so the numbers compare scenarios, not predict. Brigades for
  Talca could come from the national fire-station dataset later.

### D-033 — Plan de preparación: preparation measures ranked over an ensemble of simulated fires (2026-11-22)
- **Context:** the team wants an optimizer for preparing before fires, not for alerting during one. The
  investigation (session log `2026-11-22-josecannete-optimizer-investigation`) found that a plan tuned to one
  fire does not carry over to others, so the ranking must come from many plausible fires. It also found that
  narrow firebreaks are jumped by embers, and that alert timing and preparation time each move the count in
  only one direction (curves are enough, no search needed).
- **Decision (contract: `types.ts` gains `EvacProgramme` / `EvacInput.programme`, `PLAN_MEASURE`,
  `PlanValidation`, `PlanFile`; `Scenario` gains `planTiles` / `planSectors`):**
  - Two measures, by 1 km tile (`src/engine/plan`):
    - the 200 m belt around inhabited land: vegetation cleared, houses stay as intermix; cost in ha;
    - a community preparation programme: preparation median 5 min, 90 % leave on cues; cost in households.
    Both are planning assumptions, not measured effects.
  - `pnpm plan` (`src/engine/plan/bake.ts`, about 4.5 min) ranks both over 80 simulated fires and scores them on
    40 held-out fires and on 2 Feb 2024. The simulated fires use 2 Feb's weather (wind ±20 %, direction ±10°),
    start in wildland 400 m-3 km from inhabited land between 12:00 and 15:00, and get the alert 4 h after
    ignition; none starts within 2 km of the real ignitions. The result is `public/data/plan.json`, which
    `parsePlan` checks against the app's constants.
  - The panel fills a budget in ranked order and shows the validation for a budget within 1.5x of it, next to
    random fills of the same size. The worker applies the belt to the fire and the programme to every
    evacuation run. The programme never makes a household slower than the Evacuación settings (its members get
    the faster preparation and the higher cue share of the two). The worker refuses a plan.json that no longer
    matches the fuel or the buildings.
  - Viña only (`EventDef.layers.plan`); Eaton and Talca say there is no plan yet.
- **Consequences:** the ranked belt clearly beats random tiles on held-out fires (1,000 ha: −24.8 % vs
  −5.2 to −13.0 %) but barely changes 2 Feb (0.0 % on the real weather; −37 % only with the belt in every
  tile). The ranked programme is close to random (20,000 households: −4.9 % vs −1.9 to −4.7 %; 2 Feb −3.2 %).
  The UI shows these numbers as they are. Rerun `pnpm plan` whenever the data or the fire calibration change.
  Not included: firebreak, street-link and alert optimizers (reasons in the session log).

### D-035 — Live placement never stops the simulation: clicks outside the area refused, fire starts snapped to vegetation (2026-11-22)
- **Context:** an adversarial demo check (99 reviewer agents, every finding reproduced by a second one) found four ways a
  presenter could stop the simulation with one click: a fire start outside the simulated area (the base map extends
  beyond it), on water or bare ground, under a drawn firebreak, and any failed run leaving the worker's cached input
  from the failed attempt (which then broke the firefighters' pass). It also found that a failed scenario load was a
  dead end, that "Fijar como escenario base" could save the previous result, and that the hint's "Terminar (Esc)"
  threw away the firebreak being drawn.
- **Decision (no contract change):**
  - A fire start or a firebreak entirely outside the area is not added; the map says so and the tool stays on.
  - A fire start on a cell that cannot burn (no fuel, a drawn firebreak or the plan's belt) moves to the nearest
    burnable cell within 600 m (`nearestBurnableCell`, `snapIgnitions` in `worker/scenario.ts`), with a visible note;
    with no vegetation that close it is left out, also with a note. This is a visible fallback, not a silent one.
  - The worker updates its fire cache and notes only after the fire succeeds; its data load retries after 1, 2 and
    4 s. A failed load keeps the scenario picker and offers "Reintentar".
  - "Fijar como escenario base" is disabled while a change is being simulated or an error shows. The firebreak hint
    button saves the line ("Guardar y salir (Enter)").
  - Copy: firebreaks exist from the start of the run and are at least one cell wide; house colours are the whole
    scenario's result, not the hour shown; Bomberos exists for Viña and Eaton.
- **Consequences:** a demo cannot be stopped by where the presenter clicks. Not fixed: firebreaks have no build time,
  households are coloured by the final result during playback, and a fire added at the end of the window barely burns.

## §2 Open

- Viña's scar (`scar.bin`) applies a −0.1 reflectance offset that the Earth Search COGs do not need (15.6 % / 19.6 %
  of valid pixels come out negative, biasing dNBR). Fixing it changes the scar and every in-sample number fitted
  on it (D-030; `pipeline/README.md`): decide before re-baking.
- Verify the first CI-gated Render deployment after merging the deployment workflow (D-023).

## §3 Superseded

_Moved here by D-019 (pivot to Cortafuego): D-001, D-005, D-008 to D-018. Moved by D-020: D-006, D-007. Moved by D-029: D-025._

### D-025 — Cortafuego logo: flame and protective masonry barrier (2026-11-22)
- **Context:** the user requested a clean, professional, firewall-related SVG and reiterated the README's
  submission requirement: a 1000×1000 PNG under 500 KB.
- **Decision:** use an original orange flame above a pale staggered masonry barrier on dark slate, matching
  the UI palette, with an outlined Cortafuego wordmark. `project-logo.svg` is the vector source;
  `project-logo.png` is the raster submission asset already referenced by the README.
- **Consequences:** the logo is self-contained (no linked images or runtime fonts). The PNG is exactly
  1000×1000 and 58,882 bytes, below even a decimal 500 KB limit. The README itself is unchanged.
- **Superseded by D-029:** the user requested a more modern, minimalistic revision; the brickwork and
  wordmark were replaced with a single flame split by a negative-space firebreak.

### D-006 — CI with one aggregate check, and two agent reviewers on every PR (2026-11-21)
- **Context:** several people and agents push PRs in parallel overnight; nobody has time to review everything,
  and the owner wants review automated from the start. A private repo already runs this setup.
- **Decision:** `.github/workflows/ci.yml` runs every job and `CI OK` aggregates them (a new job is added to
  `ci-ok.needs`). `.github/workflows/code-review.yml` runs `claude-haiku-5-5` and `claude-sonnet-5-5`
  independently on `pull_request_target`, against `docs/PR_REVIEW_FOCUS.md` from the base branch, with read-only
  tools and structured output that `scripts/ci/format_review.py` validates before posting a `COMMENT` review.
  A blocking finding fails that reviewer; `Agent reviews OK` aggregates both. Drafts, bots, forks and
  agent-kb-only PRs are not reviewed. `skip-agent-review` label + re-run is the escape hatch; 8 reviews per
  reviewer per PR at most. Runs on GitHub-hosted ubuntu runners.
- **Consequences:** needs the `ANTHROPIC_API_KEY` secret (+ `ANTHROPIC_BASE_URL` for the hackathon proxy) or
  `CLAUDE_CODE_OAUTH_TOKEN`. The checks are advisory until a repo admin makes `CI OK` and `Agent reviews OK`
  required on `main`. Auto-merge: D-007.

### D-007 — Agent-approved PRs merge themselves (2026-11-21)
- **Context:** the owner wants a PR to merge once CI and both agent reviews pass, with no manual step. A real
  GitHub approval doesn't fit: both agents post as `github-actions[bot]`, where only the latest review counts,
  and it would mean letting Actions approve PRs. Same reasoning as in that private repo.
- **Decision:** the agents approve through the required check `Agent reviews OK`. `.github/workflows/auto-merge.yml`
  arms squash auto-merge on every same-repo, non-draft, human-authored PR to `main`, and only when GitHub reports
  the PR as `BLOCKED` (required checks pending), so it can never merge an unprotected PR at once. `main`'s
  protection: PR required, **0 approvals**, required checks `CI OK` and `Agent reviews OK`, no force-push or deletion.
- **Consequences:** code reaches `main` with no human reading it; the guide's definition of `blocking` is what holds
  the merge. Drafts are how to hold a PR. Needs a repo admin to enable "Allow auto-merge" and set the protection
  (until then the workflow refuses to arm). Merges made with `GITHUB_TOKEN` trigger no `push` run, so CI on `main`
  only runs on the next PR or by hand (`workflow_dispatch`). Workflow changes take effect only once merged.

### D-001 — Pivot to a general step-by-step task supervisor (2026-11-21)
- **Context:** Circuito Vivo's Modo Armado was already a supervisor for one task (wiring a circuit). The
  team wants the general version: any task as a recipe, simulated or real video, a VLM, a controller, voice.
- **Decision:** build the supervisor described in `docs/VISION.md`.
- **Consequences:** the previous product stops being developed; its PR #8 (hackathon metadata) is superseded.

### D-005 — Providers available: Claude for tasks, ElevenLabs for voice, own RTX 3090 (2026-11-21)
- **Context:** the team has access to the Claude API, the ElevenLabs API and the 3090 server.
- **Decision:** Claude generates and revises task recipes; ElevenLabs does TTS; heavy models (VLM, training) run on the 3090.
- **Consequences:** see `docs/RESEARCH.md` for models and costs.

### D-008 — Ownership by workstream (2026-11-21)
- **Context:** three people plus agents in parallel; without owners, agents edit the same files.
- **Decision (can change):** **Alonso**: task library (ontology, recipe generation with Claude, `tasks/`) and
  the voice component. **Cote**: models: video understanding (M_VL) and the controller (rules and learned),
  their training and eval. **Anaís**: simulator (symbolic and visual) and the webcam/frame source. Contracts
  are shared: any change needs a decision entry. The session server goes to Alonso (it hosts his voice
  component, and it's a port of the old Modo Armado session he built); the web UI goes to Anaís (the webcam
  and sim-clip sources live in the page). Cote's area (two models + training) is the heaviest, so it gets nothing extra.
- **Consequences:** each owner reviews changes to their area; the table in `docs/STACK.md` § Ownership is kept current.
- **Amended 2026-11-21:** the **symbolic** simulator (`sim/symbolic/`) moves from Anaís to Cote: it exists to
  train and test the controller. Anaís keeps the visual simulator.

### D-009 — Contracts as a pydantic package; the automaton is derived from a step DAG (2026-11-21)
- **Context:** the pieces meet at six data shapes (ontology, task, perception output, controller decision,
  WebSocket messages, datasets); they need one definition that Python code imports and the web app and
  model prompts can read.
- **Decision:** `contracts/` is a standalone uv package (`pydantic` v2) imported by every Python component;
  JSON Schemas are generated into `contracts/schemas/` and CI fails when they're stale. A task's automaton is
  derived from `steps[].requires` (DAG, listed in topological order; state = set of done steps), not written
  by hand; each step is completed by exactly one action. Mistake kinds are the closed set `out_of_order`,
  `wrong_action`, `incomplete`, `repeated`. A null VLM action means "uncertain": the supervisor stays silent.
  WebSocket framing is the old Modo Armado's (little-endian `uint32 seq, uint32 t_ms` + JPEG; `uint8 len + id`
  + audio, now mp3). Spec: `docs/CONTRACTS.md`.
- **Consequences:** tasks that need loops or alternatives (do A *or* B) don't fit yet; revisit if the demo task
  needs them. The web app generates TS types from the schemas.

### D-010 — Stack confirmed; skeleton runs end to end on fakes (2026-11-21)
- **Context:** owners need a place for their code, a way to run it, and something to build against before the
  other pieces exist.
- **Decision:** `docs/STACK.md` is the stack. Skeleton: `server/` (FastAPI + uv, depends on `contracts/` by path)
  with the task library, the session WebSocket, a rule controller v0 and factories for perception and voice;
  `web/` (Vite + React + TS + pnpm) with types generated from the schemas; `tasks/<domain>/` holds the library;
  `make dev/test/check`; CI jobs `server` and `web` in `CI OK`. In-process interfaces `Perception`, `Controller`,
  `Voice` live in `contracts.interfaces`; `ScriptedPerception` and `SilentVoice` fakes are the defaults.
- **Consequences:** the full loop (browser → server → controller → subtitles + browser speech) runs with no model
  and no API keys; each owner replaces a fake behind its interface. Message and output schemas are exported in
  serialization mode so TypeScript sees `type` as required.

### D-011 — `TrajectoryEvent.observed_quality` (2026-11-21)
- **Context:** `incomplete` (right action, done badly) reaches the controller only through `VlmOutput.quality`;
  trajectories had no way to carry it, so neither controller could be trained or tested on it.
- **Decision:** `TrajectoryEvent` gets `observed_quality: Quality = "unknown"`, the quality simulated perception
  reports alongside `observed_action`/`observed_confidence`.
- **Consequences:** backward compatible (defaulted); schemas and TS types regenerated. No other consumer yet.

### D-012 — Perception: Qwen3-VL-8B FP8 on vLLM behind a keyed tunnel (2026-11-21)
- **Update:** the model and the client stand; where it is served (the 3090 behind a keyed tunnel) is replaced by
  D-014 (the 5090 over an SSH port-forward). The 3090 setup stays as a fallback.
- **Update (D-017):** the live call policy is now 3 frames over 1.1 s, a call every 0.75 s, and the prompt
  describes the hands before deciding.
- **Context:** the scripted fake must give way to a real video-language model behind `Perception`; the 3090 is
  on a private network and the server may run on a laptop.
- **Decision:** `SUP_PERCEPTION=vlm` → `VlmPerception` (`server/app/perception/vlm.py`) calls Qwen3-VL-8B-Instruct-FP8
  on vLLM (OpenAI-compatible, `openai` SDK) through a Cloudflare tunnel straight to vLLM, protected by vLLM's
  `--api-key` (in `~/sup/env` on the box, never in git). Per call: the newest frame + one ~1 s older (≤640 px),
  the task's actions with `visual_cue`/`label_es`, objects, next steps and mistakes; guided decoding with
  `vlm_output_json_schema()` narrowed to the task's actions/objects; `parse_vlm_output` still validates. ≤1 call
  in flight and ≥1.5 s between calls. A bad answer → uncertain observation; transport failures raise. GPU
  scripts live in `gpu/` (`gpu/deploy.sh`), reusing the previous project's venv and weights.
- **Consequences:** the session server stays on a laptop for development; the tunnel URL changes when a quick
  tunnel restarts (named tunnel via `SUP_TUNNEL_TOKEN` if that hurts). Resolves the M_VL proposal in §2 for the
  main model; the API labeller/fallback stays open.

### D-013 — M_C: rules baseline + a tiny GRU per task, numpy inference in the server (2026-11-21)
- **Context:** the controller must turn noisy perception into the same `Decision`s as the rules, train in
  minutes per task, and run in the server without adding torch.
- **Decision:** `RulesController` stays the baseline. The learned controller is a 1-layer GRU (64 units) per
  task, trained from scratch in `training/controller/` on `sim/symbolic` runs (noise levels mixed, split per
  run). Inputs are the perception output only (no controller state: feeding the tracked state measured worse,
  by exposure bias); outputs are P(step done) and P(mistake kind). The server restricts them to the automaton
  (a step is marked done only when legal next; mistakes attributed via `TaskAutomaton.apply`) and reuses the
  rules' texts, reminders and skip. Weights (`training/controller/weights/<task>.npz`, ~100 KB, with task
  version/actions/steps) are committed; the server runs a numpy forward pass. `SUP_CONTROLLER=rules|learned`;
  learned refuses to start when a library task lacks matching weights.
- **Consequences:** every new or changed task needs `make controller TASK=…` before running learned mode.
  Numbers in `training/results/controller.md` come only from `ctrl.evaluate`. Training tests need torch and run
  locally; CI lints the training code and tests the committed weights through the server.

### D-014 — Perception is served from the RTX 5090 box, reached over an SSH port-forward (2026-11-21)
- **Context:** SSH to the 3090 is refused. The team got a container with an RTX 5090 (32 GB, root, no
  systemd), reachable on a public address.
- **Decision:** vLLM runs on the 5090 with the same model as D-012 (Qwen3-VL-8B-Instruct-FP8) and listens on
  127.0.0.1 only. The server reaches it with `ssh -L 8001:127.0.0.1:8001` (`gpu/up-5090.sh`): no public
  tunnel, no API key. The box's address stays out of git.
- **Consequences:** the session server must run on a machine with SSH access to the box (a team laptop). A
  public demo URL would need a tunnel from that laptop, or the server running on the box. The 3090 scripts
  (`gpu/up.sh`) remain as a fallback. 32 GB fits the 8B (~18 GB) next to a second model or a small training job.

### D-015 — Demo deploy: everything on the 5090 box, one origin behind a Cloudflare tunnel (2026-11-21)
- **Context:** A3 needs a public link a judge can open with no laptop in the loop. The web app fetches `/api/*`
  from its own origin. vLLM runs on the 5090 on `127.0.0.1` (D-014). Render (the old setup) needs a human with
  the account, and a quick tunnel's URL changes on every restart anyway.
- **Decision:** the session server runs on the 5090 next to vLLM and also serves the built web app
  (`deploy/demo_app.py`: `create_app()` + the Vite build mounted at `/`). One Cloudflare tunnel (quick by
  default, named if `SUP_TUNNEL_TOKEN` is set) exposes only that server; vLLM stays private. Processes run in
  tmux restart loops (no systemd). `deploy/up-demo.sh` is the one command; secrets live in `~/sup/demo.env`
  (mode 600) on the box.
- **Consequences:** same origin, so no CORS, no `?server=` and no second host; Render is dropped for this
  project. The quick-tunnel link survives redeploys (only the server restarts) but changes when cloudflared
  restarts: `deploy/up-demo.sh --url` prints the current one. A stable link needs a named tunnel from someone
  with a Cloudflare account. If the box goes down, so does the demo (fallback: `make dev` on a laptop +
  `gpu/up-5090.sh`).

### D-016 — Simulator page: an in-browser C172 cockpit as a second, practice-mode demo (2026-11-21)
- **Context:** besides the physical kit (webcam), Anaís wants a demo that needs no hardware: a simulated task
  the presenter does live, making mistakes on purpose so the supervisor corrects them. It sits next to the
  robot/circuit task; it doesn't replace it.
- **Decision:** a `Simulador` page (`/simulador/`, `web/src/simulator/`): pick a library task that has a
  simulator, then **Práctica** (live: the simulator's canvas is the frame source, `hello.source = sim`,
  `hello.task_id` = the project, so perception and the controller use its recipe) or **Grabación (experto)**
  (offline: the canvas is recorded to `.webm` and labeled from the simulator's ground truth as `ClipRecord`s;
  **mocked**: downloaded, no upload endpoint yet). First simulator: a Cessna 172 cockpit (2D panel with the
  MIT `flight-indicators-js` gauges + a three.js windshield), keyboard-driven, for the new
  `tasks/aviation/c172_takeoff.json` (cold-and-dark start → takeoff → climb; 4 task mistakes). Only video goes
  to the server in practice: the simulator's ground truth stays in the page (debug overlay, labels).
- **Consequences:** no contract change (`source: sim` already covers it; `ClipRecord` has no start/end, so the
  mock puts the segment in the path as a media fragment). The demo deploy (D-015) serves the page because
  `simulador` is a page of the web router (`web/src/router.ts`, copied to `simulador/index.html` at build). `c172_takeoff` has learned-controller weights.
  Design: `docs/superpowers/specs/2026-11-21-simulator-page-design.md`.
### D-016 — Continuous deployment of the demo from GitHub Actions over SSH (2026-11-21)
- **Context:** D-002 removed the old CI/CD, and D-015's deploy was manual, so merged PRs (e.g. #31's new task) didn't reach the public link until
  someone remembered to run `deploy/up-demo.sh`.
- **Decision:** `.github/workflows/cd-demo.yml` runs `deploy/up-demo.sh` on a runner after CI passes on a push to
  `main` (`workflow_run`, from main only, for the tested commit), queued, never cancelled halfway. It logs in
  with a key used only by CD, `restrict`ed on the box, and checks the pinned host key. Secrets: `GPU5090`,
  `GPU5090_PORT`, `DEMO_SSH_KEY`, `DEMO_SSH_KNOWN_HOSTS`, stored in the `demo` environment, restricted to `main`.
  A file on the box (`~/sup/cd-paused`) pauses it
  without needing repo admin.
- **Consequences:** GitHub holds a key that can run commands as root on the GPU box. Every merge restarts the
  demo server for a few seconds, so pause CD during judging. A broken merge reaches the demo once CI passes;
  revert it, or redeploy a good commit by hand. vLLM is never touched.

### D-017 — Perception tuning on real frames: keep the 8B, describe-then-decide prompt, controller infers one unseen step (2026-11-21)
- **Context:** the first real webcam run (hand washing, 138 calls, labelled) showed perception right on 60% of
  calls; it missed brief actions (taking soap) and confused similar ones (palms vs backs). With perfect
  perception the rules controller was fine, but one missed step blocked the rest of the task.
- **Decision:** keep Qwen3-VL-8B FP8. The 30B-A3B Instruct and Thinking (4-bit AWQ) were worse on the same
  frames (52–56%), and the Thinking model is too slow (p95 12.8 s).
  - The prompt has the model describe the hands first (`note` is the first key under guided decoding),
    then compare similar actions.
  - Task cues say what tells similar actions apart.
  - Live defaults: 3 frames over 1.1 s, a call every 0.75 s.
  - The rules controller ignores a forbidden action whose step isn't due yet.
  - After 4 out-of-order sightings in a row, it takes the step's single missing prerequisite as done if
    that prerequisite could be done now, and says so. 3 sightings skipped a real step on a run where the
    model hallucinated early rinses.
  - Numbers: `training/results/perception.md`.
- **Update (D-018):** calls are now pipelined (3 in flight, starting every 0.25 s), and inference also needs the
  4 sightings to span ≥ 2 s.
- **Consequences:** a deliberate out-of-order action that lasts more than about 3 s gets accepted after one
  warning. A forbidden action more than one step before its step is ignored. 3 frames per call need vLLM
  started with `VLM_MAX_IMAGES` ≥ 3 (`gpu/vllm-5090.sh` defaults to 4); an older vLLM rejects every call
  loudly. Fine-tuning (`training/vlm`) is the next lever, and it needs more labelled runs.
- **Amended 2026-11-21 (Anaís):** the controller never infers a step that has an `out_of_order` `MistakeDef`: the task
  author declared doing it early a real mistake (power with the parking brake set, key to START with fuel off, a
  battery connected early, soap before wetting), so it keeps warning instead of saying "doy por hecho". Before
  this, the C172 demo's two deliberate order mistakes were accepted ~3 s after the warning.
### D-018 — Pipelined VLM calls: 3 in flight per session (2026-11-21)
- **Context:** a call takes ~0.8 s and is dominated by writing the answer (~90 tokens); prompt size barely
  matters. With one call in flight the GPU idles, and a 1–2 s action (taking soap) is seen by 1–2 calls at most.
- **Decision:** `VlmPerception` pipelines calls inside the `Perception` interface, so the session and the
  contract don't change (the session still has one `observe` at a time):
  - up to `SUP_VLM_MAX_IN_FLIGHT=3` calls at once, starting at least `SUP_VLM_MIN_INTERVAL_MS=250` apart;
  - answers are delivered in launch order;
  - `observe` waits for the oldest call only until the next call is due.
  - The rules controller's inference also needs its sightings to span ≥ 2 s (`INFER_MIN_MS`), so faster
    perception doesn't infer sooner.
  - Measured with `app.perception.bench --stream 45` on the 5090 (6 fps camera, 3 frames per call):
    1.11 → 2.84 observations/s, latency p50 777 → 843 ms.
- **Consequences:** about 3× the load on vLLM per session (`--max-num-seqs 4`, so a second open session queues).
  Overlapping windows mean each brief action is seen by several calls. Accuracy per call is unchanged (same
  prompt); whether it catches more of the real actions needs a labelled live run.

