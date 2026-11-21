# 2026-11-21 — simulator-page

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/simulator-practice-recording-1737d8` → draft PR (see the PR list)
- **Goal:** a Simulador page with practice (live) and expert recording modes; demo: take off a plane in practice mode and get corrected live.

## Done
- `tasks/aviation/` (ontology v1 + `c172_takeoff`): 10 steps from cold and dark to a 75 kt climb; mistakes `start_not_ready`, `flaps_full`, `power_with_brake`, `rotate_early`. Visual cues describe exactly what the cockpit draws.
- `web/src/simulator/`: C172 cockpit in one 1280×960 canvas (vendored MIT `flight-indicators-js` SVGs drawn as rotated layers, own drawings for switches/knobs/key/flaps/fuel, three.js windshield at dusk on SCEL 35R), keyboard map, simple flight model (pure, tested), engine/stall-horn audio.
- Page `/simulador/`: project picker (tasks with a simulator), Práctica (streams the canvas through the session at 6 fps, checklist/issue/subtitle/voice from the server, D = debug with simulator truth vs model), Grabación (MediaRecorder → `.webm`, ground truth → `ClipRecord` JSONL, mocked send = download).
- Shared `useSession` hook (App uses it too), `startCapture` takes a canvas, `apiUrl` follows `?server=`.
- Learned-controller weights for `c172_takeoff`; `training/results/controller.md` regenerated (other tasks unchanged).
- Verified: vitest (16), `make check`, a full keyboard run in the browser (all 10 step actions to `establish_climb`), a recording with a flaps-30 mistake, and the page served by `deploy/demo_app.py`.

- VLM test kit for a teammate with 5090 access: `sim/cockpit/c172_takeoff/` (16 labeled before/after frame pairs:
  12 correct-run cases + the 4 mistakes), `sim/cockpit/capture_c172.js` to recapture (waits on the sim's real
  state via a dev-only `window.__c172`), and `python -m app.perception.cases <dir>` to score them through
  `VlmPerception` + the automaton (markdown table, exit 1 unless all pass). Dry-run against a stub: plumbing OK.

## Decisions
- The C172 simulator page as a second, practice-mode demo (→ D-016).

## Open / blocked
- Not tried with the real VLM (no 5090 access from this machine): handed off; run `sim/cockpit/README.md`. Watch the
  pitch cues: at 640×480 a 7° climb moves the horizon and the attitude ball only a few pixels.
- The page asked for Render; D-015 dropped Render (the box serves the web build). `?server=`/`apiUrl` still allow a separate static host if that changes.
- Recording upload is a mock: no endpoint; `ClipRecord` segments use `path#t=a,b`.
- In a background tab the sim freezes (requestAnimationFrame); keep the cockpit tab in front during the demo.

## Next
- Run practice against the 5090 (`deploy/up-demo.sh`), tune visual cues / drawing sizes until the model reads each step; rehearse the four mistakes.
