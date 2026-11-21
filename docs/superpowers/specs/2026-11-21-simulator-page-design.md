# Simulator page: practice and recording on a Cessna 172 takeoff (design, 2026-11-21)

Owner: Anaís (`web/`) + the task file (`tasks/aviation/`). Agreed in conversation; this writes it down.

## Intent

A `Simulador` page where a user picks a project from the task library and runs it in an in-browser
simulator, in one of two modes:

- **Práctica (live):** the simulator's view is captured as video frames and goes through the normal
  pipeline: M_VL (video → text) → controller → TTS → audio in the page. The supervisor corrects the
  person when they stray from the recipe. **This is the demo:** practice on the C172 takeoff, making
  mistakes on purpose so it corrects live.
- **Grabación (offline):** an expert flies it correctly; the run is recorded and "sent" afterwards as
  fine-tuning data. Not live. **Mocked for now:** nothing receives it; the page saves the video and its
  labels as files.

The plane task lives next to the robot task; it doesn't replace it.

## Goals / non-goals / anti-goals

- Goal: a realistic C172 cockpit, flown with the keyboard, readable by the VLM at 640×480.
- Goal: the controller knows the project because `hello.task_id` is the selected task (already true).
- Non-goal: real flight physics, terrain, taxiing, landing; a server endpoint for recordings; Render config
  (A3, Alonso).
- Anti-goal: anything that only works because the page tells the server the answer. Practice sends only
  video frames; the simulator's ground truth is used for recording labels and the debug overlay only.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Hand-built 2D panel (MIT `flight-indicators-js` gauges + own drawings) + three.js windshield | Every control big and legible to the VLM; no license risk; looks like a high-quality illustration |
| B | FlightGear C172P 3D cockpit in three.js | Most realistic; GPL in an unlicensed public repo; heavy conversion; switches tiny at 640 px |
| C | Wikimedia panel photo + overlays | Photoreal at a glance; overlays never match; CC-BY-SA per photo |

## Decided

- **Aircraft:** Cessna 172 Skyhawk, steam-gauge panel.
- **Input:** keyboard, one key per control.
- **Recipe** (`tasks/aviation/c172_takeoff.json`, domain `aviation`): cold and dark, lined up on the runway.
  master on, fuel BOTH, mixture rich (any order) → start engine → flaps 10, landing light (any order) →
  release parking brake → full power → rotate at 55 kt → climb at 75 kt. Mistakes: `start_not_ready`
  (out of order), `flaps_full` (wrong action), `power_with_brake` (out of order), `rotate_early` (wrong action).
- **Recording mock:** MediaRecorder on the cockpit canvas → `.webm`, plus one `ClipRecord` per
  ground-truth action segment (`source: recorded`, `is_correct` from the sim) → `.clips.jsonl`; both
  downloaded. `ClipRecord` has no start/end, so the mock puts the segment in the path as a media fragment
  (`recorded/<run>.webm#t=a,b`). A real upload endpoint replaces this later.

## My calls (correct me)

- One "landing light" step (one action per step in the contract); other light switches are decorative.
- Placards on the panel stay in English like a real C172; all page UI copy is Spanish.
- A red `STALL` annunciator next to the stall horn sound, so `rotate_early` is visible to the VLM
  (a real C172 only has the horn).
- The whole cockpit is drawn into one canvas (instrument SVGs are drawn as rotated images), so the frame
  source is that canvas: the same JPEG path as the webcam (`startCapture` takes any drawable source).
- Routing: `/simulador` (no router dependency); `?server=` also sets the HTTP API base, so a static build
  on Render can talk to the server through a tunnel.
- Simple fake physics in a pure, tested module; ground-truth action events derived from control changes.

## Deploy note

Asked for Render, but D-015 (merged while this was built) dropped Render: the 5090 box serves the web build
and the session server on one origin behind a Cloudflare tunnel. The build has a second HTML entry
(`web/simulador/index.html`) so the box's static mount serves `/simulador/`. If a separate static host comes
back, `?server=wss://<host>` (or `VITE_SUP_SERVER`) points both the WebSocket and the API at the server, which
then needs that origin in `SUP_CORS_ORIGINS`. Learned-controller weights for `c172_takeoff` are committed.
