# Cortafuego: Platanus Hack 26, team-1

A browser simulator of the 2 February 2024 wildfire in Viña del Mar, Quilpué and Villa Alemana, built on the
real terrain, fuels, buildings, streets and that afternoon's weather. The user changes wind, humidity,
temperature, drought, ignitions, firebreaks, the alert time and the evacuation routes, and sees how far the fire
goes and how many households would not get out in time. It explores scenarios for prevention and planning; it
is not a prediction and it does not judge who was responsible. Track: Simulations.

- **Read first:** this file, then [agent-kb/README.md](agent-kb/README.md) (session protocol),
  `agent-kb/backlog.md` (Now), `agent-kb/decisions.md` (D-019 is the pivot) and the newest file in
  `agent-kb/sessions/`.
- **Models:** [web/src/engine/fire/MODEL.md](web/src/engine/fire/MODEL.md) (fire spread) and
  [web/src/engine/evac/MODEL.md](web/src/engine/evac/MODEL.md) (evacuation).
- **Data:** [pipeline/README.md](pipeline/README.md) (sources, licences, how the files in `web/public/data/`
  are baked).
- **Shared contract:** [web/src/engine/types.ts](web/src/engine/types.ts): data file formats, enums and the
  engine function signatures. Change it only together with every consumer (pipeline, engines, UI).
- **Previous projects** (Ojo, the step-by-step supervisor, and Circuito Vivo before it) are in git history:
  the last Ojo commit on `main` is `a2a871e`.
- **Team:** Alonso (@alonsogm4), Anaís (@chichitaocss), José "Cote" (@josecannete).
- **Deadline:** everything on `main` by **Sun 2026-11-22 05:30 (America/Santiago)**; submission at 06:00.

## Layout

- `pipeline/`: Python (uv). Downloads the open data once and bakes `web/public/data/*` on the fixed grid.
- `web/`: Vite + React + TypeScript, MapLibre GL. Everything runs in the visitor's browser (static site).
  - `src/engine/fire/`: fire spread (McArthur Mk5 forest / CSIRO grassland rate of spread, slope and wind
    as one vector, elliptical spread, minimum-travel-time propagation, ember spotting).
  - `src/engine/evac/`: evacuation (latest-departure search on the street graph, lognormal preparation time).
  - `src/worker/`: runs both engines in a Web Worker. `src/ui/`, `src/data/`: the app.
  - `scripts/`: Node scripts that reuse the engines (validation against the Sentinel-2 scar).

## Commands

Needs `uv` and Node 24 + `pnpm`.

```bash
make install   # web deps (+ pipeline deps)
make dev       # web on :5173 → http://localhost:5173
make data      # re-bake web/public/data from the open sources (slow: downloads)
make test      # every test suite
make check     # what CI runs: typecheck, tests, build
make validate  # model vs the real burn scar (prints the number used in the pitch)
```

## Rules

1. **PRs go straight to `main`**, small, one topic each. No stacked PRs. No direct pushes to `main`. A PR is
   merged (squash) by hand once CI's two checks, **Lint** and **Test**, are green (D-020). Open a **draft**
   while it isn't ready, and make the PR title + body final: they become the commit.
2. **Log the session in `agent-kb/`** before ending (see [agent-kb/README.md](agent-kb/README.md)).
   Check `agent-kb/decisions.md` before proposing anything that sounds like a decision.
3. **Contract first.** `web/src/engine/types.ts` is shared by the pipeline, both engines and the UI: change it
   only with every consumer in the same PR.
4. **UI copy in Spanish; code, identifiers and docs in English.**
5. **Conventional commits** (`feat:`, `fix:`, `docs:`, `chore:`, …) in commit and PR titles.
6. **No secrets in the repo**, ever, including in `agent-kb/`. **The repo is public:** don't name or quote
   private repos or other private sources (say "a private repo").
7. **Tone.** About 137 people died in this fire. No game language, scores or sound effects; frame everything
   as prevention and planning. Don't state facts about the official alert or the investigation without a
   citable source.

## Engineering practices (trimmed for a hackathon)

- **Never fail silently.** Missing or malformed data stops with a visible error. No silent clamps or fallbacks
  that change behaviour; a documented physical cap with a comment is fine.
- **Validate at the boundary.** Every data file is checked against the grid when it is loaded.
- **Closed sets are enums** (fuel classes, road classes, household status), defined once in `types.ts`.
- **Define once, reuse first.** Grep before writing a helper, constant or type.
- **Measure what you claim.** Any number in the pitch (overlap with the real scar, run time) comes from a
  script in the repo.
- **Deal with every bot or review comment**: fix it or answer why not.
- Tests where logic is non-trivial (fire spread, evacuation search, rasterising); no coverage theater.
