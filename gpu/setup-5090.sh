#!/usr/bin/env bash
# One-time setup on the RTX 5090 box (a container: root, no systemd, CUDA 12.9 nvcc). Idempotent.
# Installs uv, a vLLM venv on uv's managed Python (it ships Python.h; Triton needs it to build its
# launcher) and the weights. Run on the box: bash ~/sup/gpu/setup-5090.sh 2>&1 | tee ~/sup/logs/setup.log
set -euo pipefail
mkdir -p ~/sup/logs
command -v uv >/dev/null || [ -x ~/.local/bin/uv ] || wget -qO- https://astral.sh/uv/install.sh | sh
export PATH="$HOME/.local/bin:$PATH"
if [ ! -x ~/sup/venvs/vllm/bin/vllm ]; then
  uv venv --python-preference only-managed --python 3.12 ~/sup/venvs/vllm
  VIRTUAL_ENV=~/sup/venvs/vllm uv pip install --torch-backend=auto vllm 'huggingface_hub[hf_xet]'
fi
~/sup/venvs/vllm/bin/python -c "import vllm, torch; print('vllm', vllm.__version__, 'torch', torch.__version__, torch.cuda.get_device_name(0))"
for repo in Qwen/Qwen3-VL-8B-Instruct-FP8 Qwen/Qwen3-VL-2B-Instruct; do ~/sup/venvs/vllm/bin/hf download "$repo" >/dev/null; done
echo "setup done"
