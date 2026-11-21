# Circuito Vivo — Platanus Hack 26: Santiago ft. Buk

<img src="./project-logo.png" alt="Circuito Vivo" width="200" />

Track: 🌐 Simulations · team-1

- Alonso Felipe Gac Monárdez ([@alonsogm4](https://github.com/alonsogm4))
- Anaís Neira Zúñiga ([@chichitaocss](https://github.com/chichitaocss))
- José Rodolfo Cañete López ([@josecannete](https://github.com/josecannete))

**App:** https://circuito-vivo-web.onrender.com

Web app (desktop, in Spanish) for learning electronics with an Arduino Uno or ESP32-C6. You design the circuit on a
real-scale breadboard, simulate it live, program it with blocks and flash your board from the browser, with an AI
assistant at your side. In **Modo Armado** a webcam watches the real breadboard: an agent built on open models
(YOLO11s + Qwen3-VL-8B with our own LoRA, Kokoro TTS, on our RTX 3090) ticks each build step and says out loud what is
wrong when it sees a reversed LED, a resistor one column off or a wire in the wrong pin.

## Run locally

```bash
make install                            # pnpm install + uv sync
cp backend/.env.example backend/.env    # ANTHROPIC_API_KEY for the assistant
make dev                                # redis + API :8000 + Celery worker + Vite :5173
make typecheck && make test
```

Modo Armado needs the vision server (`vision/`): see [`vision/README.md`](vision/README.md) to run it locally without a
GPU, and [`deploy/vision/SERVER.md`](deploy/vision/SERVER.md) for the GPU server. Open the app with
`?armado&vision=wss://<vision-server>/ws/session`.

## Repository

| Path | What |
|---|---|
| `frontend/` | Vite + React 19 + TypeScript + Zustand + Blockly (app, simulation, Modo Armado UI) |
| `backend/` | FastAPI + Celery + Redis: compile with `arduino-cli`, Claude assistant (SSE) |
| `shared/` | Part library, board profiles, agent tools, examples |
| `vision/` | Modo Armado vision server: ArUco registration, YOLO, state machine, VLM judge, voice |
| `training/` | Fine-tuning and before/after evaluation (YOLO and VLM); results in `training/results/` |
| `deploy/vision/` | GPU server setup (no sudo), systemd units, `up.sh`, demo runbook |
| `docs/` | [`CONTRACTS.md`](docs/CONTRACTS.md) (architecture and ownership), [`DEPLOY.md`](docs/DEPLOY.md), the Modo Armado plan |
