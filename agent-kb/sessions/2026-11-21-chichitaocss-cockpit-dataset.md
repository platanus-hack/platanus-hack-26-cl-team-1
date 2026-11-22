# 2026-11-21 — cockpit-dataset

- **Who:** chichitaocss (+ agent)
- **Branch / PRs:** `claude/cockpit-dataset` (see the PR list)
- **Goal:** auto-labelled C172 runs for Jose's VLM fine-tune (his run on #42: 6/16 per pass, the 8B invents states).

## Done
- `sim/cockpit/fly_c172.js`: flies seeded, randomized takeoffs (any-order steps shuffled, random pauses and
  rotation), 2 correct + 4 mistake scenarios per cycle, and streams 6 fps frames + ground-truth events
  (simulator time) to `sim/cockpit/receiver.py` (now one subdirectory per run, names validated).
- `server/app/perception/simruns.py`: replays each raw run as live VLM calls with the server's own
  `pick_frames`, `downscale_jpeg`, frame window, frames per call, span and rate; writes `calls.jsonl` + JPEGs +
  `labels.json` (every call labelled), which `app.perception.dataset` consumes unchanged. Tests in
  `server/tests/test_simruns.py`.
- C172 cockpit keeps a dev-only event log (`window.__c172.eventLog`).

- Haiku's blocking finding on #44: run ids depended on the position in a `flyC172` batch, not the seed, so the
  documented `--test-sessions` didn't match one-batch runs and `dataset.py` silently trained on them. Now the
  scenario follows the seed (`SCENARIOS[(N - 1) % 6]`) and `dataset.py` refuses unknown `--test-sessions`.
  The first local batch (two batches, old rule) keeps its self-describing ids.

## Decisions
- None (label policy is a tool default: hold 2.5 s after an action, else `none`; Jose can change it).

## Open / blocked
- Training and evaluation are Jose's (training/vlm, on the 5090). Hold out whole runs; also evaluate on the
  16 cockpit cases and real frames.

## Next
- Generate more runs if the first fine-tune helps; vary visuals (time of day) if it overfits.
