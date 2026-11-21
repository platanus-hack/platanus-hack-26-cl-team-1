#!/usr/bin/env bash
# On the GPU box: a Cloudflare tunnel to the demo server (127.0.0.1:8000 only; vLLM is never exposed),
# in a restart loop. A named tunnel if SUP_TUNNEL_TOKEN is in ~/sup/demo.env, else a quick tunnel
# (*.trycloudflare.com; a NEW URL every time cloudflared restarts, printed by deploy/up-demo.sh).
set -uo pipefail
set -a; . "$HOME/sup/demo.env"; set +a
CF="$HOME/.local/bin/cloudflared"
while true; do
  echo "── $(date -Is) starting cloudflared"
  if [ -n "${SUP_TUNNEL_TOKEN:-}" ]; then
    TUNNEL_TOKEN="$SUP_TUNNEL_TOKEN" "$CF" tunnel --no-autoupdate run  # env, not argv: keeps it out of ps
  else
    "$CF" tunnel --no-autoupdate --url http://127.0.0.1:8000
  fi
  code=$?
  echo "── $(date -Is) cloudflared exited ($code); restarting in 3 s"
  sleep 3
done
