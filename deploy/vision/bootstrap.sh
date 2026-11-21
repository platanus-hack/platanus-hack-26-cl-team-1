#!/usr/bin/env bash
# One-time setup of the vision server (RTX 3090, Ubuntu, no sudo needed).
# Installs into ~/cv: cloudflared, a vLLM venv, model weights. Idempotent.
# Usage (on the server): bash bootstrap.sh 2>&1 | tee ~/cv/logs/bootstrap.log
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
CV="$HOME/cv"
mkdir -p "$CV"/{logs,models,venvs,data/yolo/raw,data/vlm}

step() { echo; echo "=== [$(date +%H:%M:%S)] $*"; }

step "cloudflared"
if ! command -v cloudflared >/dev/null; then
  curl -fsSL -o "$HOME/.local/bin/cloudflared" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
  chmod +x "$HOME/.local/bin/cloudflared"
fi
cloudflared --version

step "yolo11s.pt"
[ -f "$CV/models/yolo11s.pt" ] || curl -fsSL -o "$CV/models/yolo11s.pt" \
  https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11s.pt
ls -la "$CV/models/yolo11s.pt"

step "vLLM venv (python 3.12)"
if [ ! -x "$CV/venvs/vllm/bin/vllm" ]; then
  uv venv --python 3.12 "$CV/venvs/vllm"
  VIRTUAL_ENV="$CV/venvs/vllm" uv pip install --torch-backend=auto vllm
fi
"$CV/venvs/vllm/bin/python" -c "import vllm, torch; print('vllm', vllm.__version__, 'torch', torch.__version__, 'cuda', torch.version.cuda, torch.cuda.is_available())"

step "weights"
VIRTUAL_ENV="$CV/venvs/vllm" uv pip install -q 'huggingface_hub[hf_xet]'
for repo in Qwen/Qwen3-VL-8B-Instruct hexgrad/Kokoro-82M Qwen/Qwen3-VL-8B-Instruct-FP8; do
  echo "-- $repo"
  "$CV/venvs/vllm/bin/hf" download "$repo" >/dev/null
done
du -sh "$HOME/.cache/huggingface/hub"/models--* 2>/dev/null

step "done"
