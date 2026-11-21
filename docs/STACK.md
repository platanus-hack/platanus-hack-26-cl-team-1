# Stack per component (proposal, 2026-11-21)

Status: **proposal** until the team confirms it (then it becomes a decision in `agent-kb/decisions.md`).
Bias: reuse what already worked in the old project (`docs/LEGACY.md`, commit `2e9da7c`); pick boring tools.

## Repo layout

```
web/            browser app: task picker, sim/webcam source, live checklist, subtitles, debug
server/         Python service: contracts, task library, controller, session WebSocket, TTS, VLM client
  app/contracts/  pydantic models = the source of truth for the shared contracts
tasks/          task library: one validated task JSON per scenario (+ generated prompts/assets refs)
sim/            symbolic simulator (trajectories + mistakes + perception noise) and video-generation scripts
training/       controller training (from scratch) and VLM QLoRA + eval scripts, run on the 3090
gpu/            3090 ops: vLLM launcher, systemd --user units, Cloudflare tunnel, up.sh
scripts/ci/     CI tooling (review formatter, scope check) + its tests
```

## Per component

| Component | Stack | Why / notes |
|---|---|---|
| **Contracts** (ontology, `task.json`, observation, controller output, WS messages) | **pydantic v2** models in `server/app/contracts/`; JSON Schema exported to `contracts/*.schema.json`; TS types generated for `web/` (`json-schema-to-typescript`); CI fails if generated files are stale | One source of truth; Claude structured output and VLM output both validate against the same schema |
| **Task library / generator** | `anthropic` SDK, structured output against the `task.json` schema; a CLI (`uv run python -m app.tasks.generate "…"`); validator = pydantic + graph checks (reachability, legal transitions, every mistake has a correction) | Claude also writes the per-step prompts for video generation |
| **Server** | Python 3.12, **FastAPI** + uvicorn, **uv**, `httpx` (async), `pytest` + `pytest-asyncio`, **ruff** (lint + format) | Same as the old `vision/` service; the WebSocket session code ports over |
| **M_VL client** | `openai` SDK against **vLLM**'s OpenAI-compatible endpoint (Qwen3-VL-8B-Instruct-FP8 on the 3090); same interface for a Gemini fallback | Event-driven, ≤1 call in flight, JSON validated into the observation model |
| **Controller** | v0: pure-Python automaton tracker in `server/app/controller/`. v1: **PyTorch** tiny GRU/transformer trained in `training/controller/`, weights loaded on CPU by the server, output masked to legal actions | Rules are the baseline and the safety rail; the learned model is the before/after story |
| **Symbolic simulator** | Pure Python + `numpy` in `sim/`, shares the contracts package | Generates trajectories with injected mistakes and perception noise; unlimited and free |
| **Visual simulator** | `runwayml` Python SDK (Gen-4.5 image-to-video, Aleph video-to-video), batch scripts in `sim/video/`; outputs stored on the 3090 (`~/sup/data`), **not in git** | Offline; one clip per (step, correct / mistake); keep a manifest JSON in git |
| **TTS** | **ElevenLabs** Flash v2.5, streaming over HTTP from the server; audio sent as binary WS frames; anti-spam queue ported from `speaker.py` | Browser `speechSynthesis` as offline fallback |
| **Web** | **Vite + React 19 + TypeScript**, Zustand, **pnpm**, **vitest**; camera + WS client + audio queue ported from `frontend/src/assembly/` | Sim clips play in a `<video>` and are captured through the same canvas path as the webcam |
| **VLM fine-tuning** | **Unsloth + TRL** QLoRA on Qwen3-VL-8B, adapter served by vLLM (`--enable-lora`); ported from `training/vlm/` | vLLM must be stopped while training (24 GB) |
| **GPU ops** | `uv` envs, `systemd --user`, **cloudflared** quick tunnel, `up.sh` health check; ported from `deploy/vision/` | No sudo, no Docker GPU runtime on the box |
| **Deploy** | Server + vLLM on the 3090 behind one tunnel; web as a static build on Render (public `deploy-url` for the hackathon) pointing at the tunnel via `?server=wss://…` | Same pattern as before; browser talks to the 3090 directly |
| **CI** | GitHub Actions (ubuntu): `actionlint`, tooling tests, then `server` (ruff + pytest), `web` (tsc + vitest + build), contracts freshness; `CI OK` aggregates | Jobs are added to `ci-ok.needs` as each folder appears |
| **Agentic review** | `anthropics/claude-code-action`, Haiku + Sonnet in parallel, read-only tools, structured output validated by `scripts/ci/format_review.py`, guided by `docs/PR_REVIEW_FOCUS.md` | Ported from a private repo (D-006) |
