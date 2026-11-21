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

## Decisions
- The C172 simulator page as a second, practice-mode demo (→ D-016).

## Open / blocked
- Not tried with the real VLM: whether Qwen3-VL-8B reads the 640×480 cockpit (small ASI digits, knob positions) is the main risk. Scripted perception was used locally.
- The page asked for Render; D-015 dropped Render (the box serves the web build). `?server=`/`apiUrl` still allow a separate static host if that changes.
- Recording upload is a mock: no endpoint; `ClipRecord` segments use `path#t=a,b`.
- In a background tab the sim freezes (requestAnimationFrame); keep the cockpit tab in front during the demo.

## Next
- Run practice against the 5090 (`deploy/up-demo.sh`), tune visual cues / drawing sizes until the model reads each step; rehearse the four mistakes.
