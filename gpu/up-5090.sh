#!/usr/bin/env bash
# From your laptop: copy gpu/ to the 5090 box, start vLLM there if it isn't running, and forward its port
# to localhost:8001 over SSH (no public tunnel, no API key needed). One command.
#   GPU5090=root@<host> GPU5090_PORT=<ssh port> gpu/up-5090.sh      (address in the team chat, not in git)
set -euo pipefail
: "${GPU5090:?set GPU5090=root@<host> (ask the team)}"
SSH=(ssh -p "${GPU5090_PORT:-22}" "$GPU5090")
cd "$(dirname "$0")"
"${SSH[@]}" 'mkdir -p ~/sup/gpu ~/sup/logs'
COPYFILE_DISABLE=1 tar --no-xattrs -cf - . | "${SSH[@]}" "tar -xf - -C ~/sup/gpu"  # the box has no rsync
"${SSH[@]}" '[ -x ~/sup/venvs/vllm/bin/vllm ] || bash ~/sup/gpu/setup-5090.sh > ~/sup/logs/setup.log 2>&1'
ALIVE='python3 -c "import urllib.request as u; u.urlopen(\"http://127.0.0.1:8001/v1/models\", timeout=3)"'
if "${SSH[@]}" "$ALIVE" 2>/dev/null; then
  echo "vLLM already running"
else
  # A fresh log, so an old "EngineCore failed" can't abort this start.
  "${SSH[@]}" 'nohup ~/sup/gpu/vllm-5090.sh > ~/sup/logs/vllm-8b.log 2>&1 < /dev/null & disown'
  echo "starting vLLM (first start ~2 min; log: ~/sup/logs/vllm-8b.log)…"
  for i in $(seq 72); do
    "${SSH[@]}" "$ALIVE" 2>/dev/null && break
    if "${SSH[@]}" 'grep -q "EngineCore failed" ~/sup/logs/vllm-8b.log'; then
      "${SSH[@]}" 'tail -40 ~/sup/logs/vllm-8b.log'; echo "✘ vLLM failed to start"; exit 1
    fi
    [ "$i" = 72 ] && { "${SSH[@]}" 'tail -20 ~/sup/logs/vllm-8b.log'; echo "✘ vLLM not up after 6 min"; exit 1; }
    sleep 5
  done
fi
ssh -f -N -o ExitOnForwardFailure=yes -L 8001:127.0.0.1:8001 -p "${GPU5090_PORT:-22}" "$GPU5090" || echo "(port 8001 already forwarded?)"
curl -fsS localhost:8001/v1/models >/dev/null || { echo "✘ localhost:8001 does not answer (is another forward or app on that port?)"; exit 1; }
echo "✔ vLLM on localhost:8001"
echo "cd server && SUP_PERCEPTION=vlm SUP_VLM_BASE_URL=http://localhost:8001/v1 uv run uvicorn app.main:app --port 8000"
