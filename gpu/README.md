# GPU boxes: vLLM for perception

**Now:** use the RTX 5090 box (§ RTX 5090 box). Its one command is `gpu/up-5090.sh`. The 3090 setup below
stays for when that box is reachable over SSH again.

The supervisor's perception (`SUP_PERCEPTION=vlm`, `server/app/perception/vlm.py`) calls
**Qwen3-VL-8B-Instruct-FP8** served by **vLLM** on the team's RTX 3090, through a **Cloudflare tunnel**. The
session server can run anywhere (a laptop at `make dev`); only the model runs on the GPU.

```
browser ──ws──▶ server (laptop, SUP_PERCEPTION=vlm) ──https + API key──▶ cloudflared ──▶ vLLM 127.0.0.1:8001 (3090)
```

## One command (3090)

From the repo root on your laptop (needs `ssh 172.16.0.204` to work):

```bash
gpu/deploy.sh             # copy gpu/ to ~/sup/gpu on the box, install the units, start, verify
gpu/deploy.sh --restart   # also restart vLLM and the tunnel (a quick tunnel gets a NEW URL)
```

`up.sh` (what `deploy.sh` runs on the box) checks the GPU, stops the previous project's units (`cv-vision`,
`cv-tunnel`, `cv-vllm`: `cv-vllm` holds port 8001 and the VRAM), creates an API key in `~/sup/env` if there
is none, starts `sup-vllm` + `sup-tunnel`, waits for vLLM (~1–2 min to load), checks the tunnel answers **and
rejects calls without the key**, and prints the settings for the server:

```bash
ssh 172.16.0.204 'grep SUP_VLM_API_KEY ~/sup/env'     # the key: keep it out of git, chats and PRs
cd server && SUP_PERCEPTION=vlm SUP_VLM_BASE_URL=https://<tunnel>.trycloudflare.com/v1 SUP_VLM_API_KEY=<key> \
  uv run uvicorn app.main:app --port 8000
```

Measure latency and look at real answers (single JPEGs, through `VlmPerception` exactly as a session does):

```bash
cd server && SUP_VLM_BASE_URL=… SUP_VLM_API_KEY=… uv run python -m app.perception.bench --repeat 3 a.jpg b.jpg
cd server && SUP_VLM_BASE_URL=… uv run python -m app.perception.bench --stream 45 frames/*.jpg   # observations/s
```

## What runs

| Unit (`~/.config/systemd/user/`) | What | Logs |
|---|---|---|
| `sup-vllm` | `gpu/vllm.sh`: vLLM on `127.0.0.1:8001`, served name `qwen3-vl-8b-fp8`, `--api-key`, `--gpu-memory-utilization 0.62` (~15 GB), ≤2 images per prompt | `journalctl --user -u sup-vllm -f` |
| `sup-tunnel` | `cloudflared` → `127.0.0.1:8001`: a quick tunnel (`*.trycloudflare.com`, new URL on every restart), or a named tunnel if `SUP_TUNNEL_TOKEN` is in `~/sup/env` | `journalctl --user -u sup-tunnel -f` |

Both are `systemd --user` units with linger (no sudo), `Restart=always`. `~/sup/env` (mode 600, never in git)
holds `SUP_VLM_API_KEY` and optionally `VLM_MODEL`, `VLM_SERVED`, `VLM_GPU_UTIL`, `VLM_LORA`,
`SUP_TUNNEL_TOKEN`, `SUP_TUNNEL_URL` (for a named tunnel, so `up.sh` can check it).

**The API key matters:** the tunnel makes vLLM public; without `--api-key` anyone with the URL could use the GPU.

## Server settings (`server/app/settings.py`)

| Env | Default | |
|---|---|---|
| `SUP_PERCEPTION` | `scripted` | `vlm` to use the model |
| `SUP_VLM_BASE_URL` | — (required for `vlm`) | `https://<tunnel>/v1` |
| `SUP_VLM_API_KEY` | — | the key from `~/sup/env` |
| `SUP_VLM_MODEL` | `qwen3-vl-8b-fp8` | vLLM served name; recorded in every `Observation.model` |
| `SUP_VLM_MIN_INTERVAL_MS` | `250` | minimum time between call starts |
| `SUP_VLM_MAX_IN_FLIGHT` | `3` | pipelined calls per session; vLLM batches them at about the latency of one (D-018) |
| `SUP_VLM_TIMEOUT_S` | `10` | slower = failure (raises; the session reports an `error`) |
| `SUP_VLM_MAX_SIDE_PX` | `640` | frames are downscaled to this longest side |
| `SUP_VLM_SPAN_MS` | `1100` | the frames shown to the model cover about this much time |
| `SUP_VLM_FRAMES` | `3` | frames per call, spread over the span (vLLM's `VLM_MAX_IMAGES`, default 4, caps it) |
| `SUP_VLM_MAX_TOKENS` | `256` | answer budget; a thinking model needs ~3000 |
| `SUP_VLM_RECORD_DIR` | — | save every call's frames + answer here, for `app.perception.review` / `rejudge` (D-017) |

## RTX 5090 box (current GPU)

The public demo (server + web app behind a Cloudflare tunnel) also runs on this box: see
[deploy/README.md](../deploy/README.md).

A second box with an **RTX 5090 (32 GB)**: a container where we're root, with no systemd and no rsync, and
`nvcc` 12.9. Its address is in the team chat; keep it out of git (the repo is public and the login is root).
vLLM listens on `127.0.0.1` only, and we reach it with an **SSH port-forward**, so it needs no public tunnel
and no API key.

```bash
GPU5090=root@<host> GPU5090_PORT=<ssh port> gpu/up-5090.sh   # setup if needed, start vLLM, forward :8001
cd server && SUP_PERCEPTION=vlm SUP_VLM_BASE_URL=http://localhost:8001/v1 uv run uvicorn app.main:app --port 8000
```

- `setup-5090.sh` (run once, by `up-5090.sh`): installs uv, then a vLLM venv on **uv's managed Python**.
  The system Python has no `Python.h`, and Triton needs it, or the engine fails at startup. It also downloads
  the 8B FP8 and 2B weights.
- `vllm-5090.sh`: sets `VLLM_USE_DEEP_GEMM=0`. Otherwise the FP8 path JIT-compiles DeepGEMM SM120 kernels,
  which need CUDA ≥ 13, and the box's `nvcc` 12.9 fails. Logs: `~/sup/logs/vllm-8b.log`. To stop it:
  `pkill -f "vllm serve"`.
- 8B FP8 at `VLM_GPU_UTIL=0.6`: 10 GB of weights, KV cache of 46,592 tokens, 17.7 GB in use.
- A second model on another port, e.g. the 2B for comparison:
  `VLM_MODEL=Qwen/Qwen3-VL-2B-Instruct VLM_SERVED=qwen3-vl-2b VLM_PORT=8002 VLM_GPU_UTIL=0.3 ~/sup/gpu/vllm-5090.sh`

Measured 2026-11-21 with `app.perception.bench` (4 public photos × 3, through the SSH forward from Santiago):

| Model (vLLM, 5090) | `hand_hygiene_basic` p50 / p95 | `servo_scout_robot` p50 / p95 |
|---|---|---|
| Qwen3-VL-8B-Instruct-FP8 | 437 / 512 ms | 395 / 932 ms |
| Qwen3-VL-2B-Instruct (BF16) | 266 / 319 ms | 491 / 559 ms |

- **8B:** it labels the soap photos `wet_hands`. It answers `null` (uncertain) for the towel dispenser and the
  robot hand in the hand-washing task, and for every non-robot photo in the robot task.
- **2B on vLLM:** it gets the same actions here. Unlike the 4-bit Ollama build it made no false
  `mount_dc_motor`, but its `objects` still repeat the prompt's list.
- **End to end:** real JPEGs over `/ws/session` → server → 8B → rules controller. The run gave an
  observation every ~1.5 s (the rate limit) at about 480 ms each, advanced `wet`, and said the next step.
  It also flagged a lathered-hands frame (`rub_palms`) as `out_of_order` before `soap`.

## Local on a Mac (prototype, no GPU box)

The same `VlmPerception` code runs against **Ollama** on Apple silicon, using the small sibling
**Qwen3-VL-2B-Instruct**. Use it to test the loop and the prompt, not to judge accuracy.

```bash
brew install ollama && ollama serve &          # needs Ollama ≥ 0.12.7 for Qwen3-VL
ollama pull qwen3-vl:2b-instruct               # 1.9 GB
cd server && SUP_PERCEPTION=vlm SUP_VLM_BASE_URL=http://localhost:11434/v1 \
  SUP_VLM_MODEL=qwen3-vl:2b-instruct SUP_VLM_TIMEOUT_S=60 uv run uvicorn app.main:app --port 8000
```

No API key is needed (Ollama only listens on localhost). Ollama respects the JSON schema we send, so every
answer parsed.

Measured on an **M1 with 8 GB** (2026-11-21, `app.perception.bench`, single public photos):

| Task (prompt size) | Warm latency per frame | First call |
|---|---|---|
| `hand_hygiene_basic` (8 actions) | 2.0–2.2 s | 12.9 s |
| `servo_scout_robot` (12 actions) | 4.4–9.6 s | 14.2 s |

Caveats seen in those runs:
- **Not usable for judging.** With the robot task, a photo of hands washing with soap came back as
  `mount_dc_motor` with confidence 0.95.
- **Confidence means nothing.** It answers 0.95 whether it's right or not.
- **`objects` repeats the prompt's list** instead of what is visible.
- It's fine on obvious cases: it said "uncertain" for a paper-towel dispenser with nobody using it.
- On 8 GB the Mac swaps (about 10 GB of swap used during the run), so close other apps.

## Training needs the GPU

vLLM and QLoRA don't fit together: `systemctl --user stop sup-vllm` before training, `start` after. To serve a
LoRA, set `VLM_LORA=<adapter path>` in `~/sup/env`, restart `sup-vllm`, and point the server at
`SUP_VLM_MODEL=qwen3-vl-8b-fp8-lora`.

## From scratch (only if `~/cv` is gone)

The previous project left on the box (2026-11-21): `~/cv/venvs/vllm` (vLLM 0.34, torch cu132, Python 3.12),
`~/.local/bin/cloudflared`, `~/.local/bin/uv`, and the weights in `~/.cache/huggingface/hub`
(`Qwen/Qwen3-VL-8B-Instruct-FP8`, 9.9 GB; `Qwen/Qwen3-VL-8B-Instruct` BF16 for fine-tuning). To rebuild:

```bash
ssh 172.16.0.204
curl -fsSL -o ~/.local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 && chmod +x ~/.local/bin/cloudflared
~/.local/bin/uv venv --python 3.12 ~/cv/venvs/vllm
VIRTUAL_ENV=~/cv/venvs/vllm ~/.local/bin/uv pip install --torch-backend=auto vllm 'huggingface_hub[hf_xet]'
~/cv/venvs/vllm/bin/hf download Qwen/Qwen3-VL-8B-Instruct-FP8
```

Box facts: Ubuntu 26.04, RTX 3090 24 GB (driver 595, CUDA 13.2), no sudo, Docker without the NVIDIA runtime
(so no containers on the GPU), 59 GB RAM. Measured by the previous project: one 640 px image, ~350 input
tokens, 65 output tokens → 0.75 s.
