# Cockpit frames: does the VLM read the simulator? (owner: Anaís)

`c172_takeoff/` holds 16 labeled cases from the Simulador page's C172 cockpit: 12 steps of a correct
takeoff and the task's 4 mistakes. Per case, `<name>_a.jpg` is the frame before the action and `<name>_b.jpg`
~1 s after it, exactly as the page sends them (640×480 JPEG, quality 0.7). `cases.json` gives the expected
VLM action (`null` = nothing happening) and the steps already done (they set the prompt's "expected next").

## Run it against the 5090 (needs SSH access to the box)

```bash
GPU5090=root@<host> GPU5090_PORT=<port> gpu/up-5090.sh          # vLLM on localhost:8001 (gpu/README.md)
cd server && SUP_VLM_BASE_URL=http://localhost:8001/v1 \
  uv run python -m app.perception.cases ../sim/cockpit/c172_takeoff --repeat 3
```

It prints a markdown table (paste it in the PR): per case, the VLM's action, confidence and quality, what the
rules controller should do (advance a step, flag a mistake, stay silent) and what it would do with that
answer. Exit code 0 only when every case passes. Per-call JSON goes to stderr.

A failing case says what to change: the drawing in `web/src/simulator/c172/panel.ts` (sizes, contrast),
or the cues in `tasks/aviation/ontology.json` / `c172_takeoff.json` (`visual_cue`, `completion_cue`). After
changing the drawing, recapture.

## Results so far

- **v1 cockpit (PR #36), qwen3-vl-8b-fp8 on the 5090: 3/16 per pass** (9/48 over 3 passes, no variance). Read only
  the big, high-contrast changes (master, flaps 10); every other step came back as `null` with ~0.95 confidence;
  0/4 mistakes, and flaps 30 was read as flaps 10.
- **v2 cockpit:** every control the recipe uses now changes on the control itself, large and in color (lit
  ON pills, RICH/CUTOFF and FULL/IDLE placards, a color-coded FLAPS readout with 30° in red, a green/red fuel
  selector, STARTER and PARK BRAKE annunciators, a darker propeller disc, windshield pitch ×1.6), and the cues in
  `tasks/aviation/` (v2) name those exact things. Pixels changed per case (`diff_cases.py`, before → after):
  fuel 59 → 3142, mixture 1520 → 3052, brake 2292 → 5408, power 1129 → 2394, power with brake 762 → 3042,
  rotate 41.6k → 62.9k. **Not yet scored by the VLM.** `c05_running` and `c11_climb` stay small on purpose:
  they're steady states, read from the cue, not from a change.

`python ../sim/cockpit/diff_cases.py ../sim/cockpit/c172_takeoff` (from `server/`) prints the pixel table.

## Recapture

1. `python3 -I sim/cockpit/receiver.py sim/cockpit/c172_takeoff` (saves what the page posts; port 8765).
2. `make dev`, open `http://localhost:5173/simulador/?task=c172_takeoff` and keep the tab in front.
3. Paste `capture_c172.js` into the devtools console. It flies the run and the mistakes by itself
   (~2 min, waiting on the sim's real state through the dev-only `window.__c172`) and writes `cases.json` last.

## Dataset: auto-labelled runs for VLM fine-tuning

The simulator knows exactly which action happened and when, so its runs need no hand labelling
(`training/vlm/README.md` otherwise asks for labelled webcam runs).

1. `python3 -I sim/cockpit/receiver.py .context/sim-raw` (gitignored; one subdirectory per run).
2. `make dev`, open `http://localhost:5173/simulador/?task=c172_takeoff`, click **Empezar práctica** once, keep the
   tab in front, paste `fly_c172.js` into the devtools console, then `await flyC172({ runs: 12, seed: 1 })`.
   Each run is a full takeoff, seeded: the order of steps that can go in any order, pauses, rotation speed and
   pitch are random. Scenarios cycle through `correct` ×2, `start_not_ready`, `flaps_full`, `power_with_brake`,
   `rotate_early` (each mistake made, held, then fixed, and the takeoff completed). ~45–60 s per run.
3. Turn them into recorded VLM calls + labels, with the server's own frame picking, downscaling and rate:
   ```bash
   cd server && uv run python -m app.perception.simruns ../.context/sim-raw --out ../.context/sim-runs/v1
   ```
4. Build the fine-tuning dataset with the usual tool, holding out whole runs:
   ```bash
   cd server && uv run python -m app.perception.dataset ../.context/sim-runs/v1 --out ../.context/vlm-data/sim-v1 \
     --test-sessions <run ids>
   ```

Label policy (`--hold-ms`, default 2500): a call is labelled with the latest ground-truth action while its
newest frame is within 2.5 s of it, else `none`; "expected next" counts only the actions before the call's
oldest frame, as a live controller would. Hold out at least one run per mistake scenario for the test split,
and evaluate on real webcam/cockpit runs as well: simulator frames are perfectly clean.
