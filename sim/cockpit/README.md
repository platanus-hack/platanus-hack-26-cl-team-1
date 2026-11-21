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

## Recapture

1. `python3 -I sim/cockpit/receiver.py sim/cockpit/c172_takeoff` (saves what the page posts; port 8765).
2. `make dev`, open `http://localhost:5173/simulador/?task=c172_takeoff` and keep the tab in front.
3. Paste `capture_c172.js` into the devtools console. It flies the run and the mistakes by itself
   (~2 min, waiting on the sim's real state through the dev-only `window.__c172`) and writes `cases.json` last.
