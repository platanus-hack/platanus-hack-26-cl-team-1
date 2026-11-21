# Legacy: Circuito Vivo (pre-pivot)

On 2026-11-21 the team pivoted (see [VISION.md](VISION.md)) and removed the previous project from the
tree. Nothing is lost: the full code lives in git history.

- **Last commit of the old project:** `2e9da7c` (merge of PR #9, `main`, 2026-11-21 08:26 -03).
- **Still deployed** (the Render services keep running the old build until someone turns them off):
  https://circuito-vivo-web.onrender.com
- **Open PR from the old project:** #8 (`feat/assembly-f10`, draft hackathon metadata). Superseded by the pivot.

## How to reuse something

Don't copy blindly: read the file at the old commit, take what fits, and adapt it to the new contracts.

```bash
git show 2e9da7c:vision/vision/speaker.py            # print one file
git ls-tree -r --name-only 2e9da7c vision/           # list a folder
git checkout 2e9da7c -- vision/vision/registration.py   # restore a file into the tree (then move/adapt it)
git log --oneline 2e9da7c -- vision/                 # history of a folder
```

## What Circuito Vivo was

A Spanish-language web app for learning electronics: design an Arduino Uno / ESP32-C6 circuit on a
breadboard, program it with blocks, simulate it, compile it with `arduino-cli`, flash a real board over
Web Serial, and follow a step-by-step wiring guide. It had a Claude assistant that edited the project
through tools.

On top of that, **Modo Armado**: the webcam streamed to a vision server on our RTX 3090, which located
parts on the breadboard (ArUco mat → homography), compared them with the expected guide step, ticked the
checklist and spoke corrections out loud. **That is the direct ancestor of the new project**: a
step-by-step supervisor for one specific task (wiring a circuit). The pivot generalizes it to any task.

| Part | Old path | Stack |
|---|---|---|
| Web app | `frontend/` | Vite, React 19, TypeScript, Zustand, Blockly |
| Backend | `backend/` | FastAPI, Celery, Redis, `arduino-cli`, Claude agent over SSE |
| Vision server | `vision/` | FastAPI WebSocket, OpenCV ArUco, YOLO11s, Qwen3-VL-8B on vLLM, Kokoro TTS |
| Fine-tuning | `training/` | YOLO training/eval, QLoRA (Unsloth + TRL) for Qwen3-VL, eval, HF publish |
| GPU deploy | `deploy/vision/` | systemd `--user` units, vLLM launcher, Cloudflare quick tunnel, `up.sh` |
| App deploy | `render.yaml`, `docker/`, `.github/workflows/` | Render Blueprint, CI (pytest, ruff, tsc, vitest, Docker), CD on push to `main` |
| Docs | `docs/PLAN-agente-armado.md`, `docs/CONTRACTS.md`, `deploy/vision/DEMO.md` | Plan with a deviation log, contracts and ownership, demo runbook |

## Reuse map (most useful first)

All paths are at `2e9da7c`.

| Need in the new project | Old code | Notes |
|---|---|---|
| Browser camera → server streaming | `frontend/src/assembly/useCamera.ts`, `client.ts`, `protocol.ts` | JPEG 640×480 at ~6 fps over WebSocket; binary frame header `uint32 seq, uint32 t_ms`; reconnect logic |
| Server WebSocket session | `vision/vision/app.py`, `session.py`, `protocol.py`, `messages.py` | One session per socket, `hello` handshake carrying the task, per-frame `debug` ack with latency |
| "When do we speak" logic | `vision/vision/state.py` | Observed vs expected → ok / error / stuck, with hysteresis over N frames. Same shape as the new controller's rule baseline |
| Voice anti-spam | `vision/vision/speaker.py`, `frontend/src/assembly/audioQueue.ts` | ≤1 clip per 4 s, errors jump the queue, no repeat within 15 s, cancel when fixed. Swap Kokoro (`tts.py`) for ElevenLabs |
| VLM judge on the 3090 | `vision/vision/vlm.py`, `vlm_prompt.py`, `deploy/vision/vllm.sh` | Qwen3-VL-8B-Instruct-FP8 on vLLM 0.34 (OpenAI-compatible, :8001), JSON output, ≤1 call in flight, ~0.5 s per judgment. Contradictory answers → treat as uncertain |
| Dataset recording | `vision/vision/recorder.py`, `vision/vision/tools/make_dataset.py` | Records frames + current step + operator labels (keys 1–6 for error types) |
| Auto-labelling + human review UI | `vision/vision/tools/autolabel.py`, `vision/vision/review.py`, `vision/vision/static/review.html` | Qwen grounding or YOLO-World to propose boxes; browser reviewer at `/review` |
| VLM fine-tuning | `training/vlm/build_dataset.py`, `train.py`, `eval.py`, `publish.py`, `training/run_f8.sh` | QLoRA 4-bit, frozen vision tower, adapter served by vLLM on top of FP8. Smoke-tested with TRL 1.x / transformers 5 |
| GPU server ops | `deploy/vision/SERVER.md`, `bootstrap.sh`, `up.sh`, `systemd/*.service` | No sudo needed; `loginctl enable-linger`; quick tunnel URL changes on restart |
| Claude streaming + tool use | `backend/app/agent/client.py`, `turn.py`, `sse.py`, `prompt.py` | Anthropic SDK, SSE to the browser, `ANTHROPIC_BASE_URL` support for the hackathon proxy |
| CI/CD + Render | `.github/workflows/ci.yml`, `cd.yml`, `render.yaml`, `docker/` | Deploy hooks triggered after CI; nginx proxies `/api` to a private API service |

## Facts learned the hard way (still true)

- **GPU server:** `ssh 172.16.0.204` (hostname `workstation`, Ubuntu 26.04), RTX 3090 24 GB, CUDA 13.2,
  no sudo, Docker without the NVIDIA runtime → run everything with `uv`, not Docker. Code in `~/cv/app`, data in `~/cv/data`.
- **VRAM:** Qwen3-VL-8B FP8 on vLLM at `--gpu-memory-utilization 0.62` takes ~15 GB. Training (QLoRA) does
  not fit next to vLLM: stop vLLM while training.
- **HTTPS pages can't open `ws://`**: the GPU server is exposed with a Cloudflare tunnel (`wss://…trycloudflare.com`),
  passed to the app at runtime with `?vision=wss://…` and stored in localStorage.
- **Browser → GPU directly, not through Render** (Render is in Oregon; measured RTT through the tunnel ~94 ms).
- **Zero-shot detectors failed on real photos** (YOLO-World saw nothing on a breadboard). The VLM alone,
  asked every ~6 s on events, worked; "uncertain" must mean silence.
- **Stacked PRs bit us** (#3–#5 merged into intermediate branches, fixed by #6): open every PR against `main`.
