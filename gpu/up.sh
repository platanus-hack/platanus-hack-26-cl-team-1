#!/usr/bin/env bash
# On the GPU box: bring vLLM + the tunnel up and print what the server needs. Idempotent, no sudo.
#   bash ~/sup/gpu/up.sh            # install units, stop the old project's units, start, verify
#   bash ~/sup/gpu/up.sh --restart  # also restart running services (new quick-tunnel URL!)
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✘\033[0m %s\n' "$*"; exit 1; }

echo "GPU"
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader || bad "nvidia-smi failed"
[ -x "$HOME/cv/venvs/vllm/bin/vllm" ] || bad "no vLLM venv at ~/cv/venvs/vllm (see gpu/README.md § From scratch)"
command -v cloudflared >/dev/null || bad "no cloudflared in ~/.local/bin (see gpu/README.md § From scratch)"
ok "GPU, vLLM venv and cloudflared present"

echo "Old project"
for unit in cv-vision cv-tunnel cv-vllm; do  # cv-vllm holds port 8001 and ~15 GB of VRAM
  if systemctl --user is-active --quiet "$unit"; then systemctl --user stop "$unit"; fi
  systemctl --user disable "$unit" >/dev/null 2>&1 || true
done
ok "cv-vision, cv-tunnel, cv-vllm stopped"

mkdir -p ~/sup ~/.config/systemd/user
touch ~/sup/env && chmod 600 ~/sup/env
if ! grep -q '^SUP_VLM_API_KEY=' ~/sup/env; then
  echo "SUP_VLM_API_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(24))')" >> ~/sup/env
  ok "new API key in ~/sup/env"
fi

cp ~/sup/gpu/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable sup-vllm sup-tunnel >/dev/null 2>&1
if [ "${1:-}" = "--restart" ]; then systemctl --user restart sup-vllm sup-tunnel; else systemctl --user start sup-vllm sup-tunnel; fi
[ "$(loginctl show-user "$USER" -p Linger --value)" = yes ] || loginctl enable-linger || echo "  (no linger: services stop at logout)"

KEY=$(grep '^SUP_VLM_API_KEY=' ~/sup/env | cut -d= -f2-)
models() { curl -fsS --max-time 10 -H "Authorization: Bearer $KEY" "$1/v1/models"; }
echo "vLLM"
for _ in $(seq 300); do models http://127.0.0.1:8001 >/dev/null 2>&1 && break; sleep 1; done
models http://127.0.0.1:8001 >/dev/null 2>&1 || bad "vLLM did not answer in 300 s (journalctl --user -u sup-vllm -n 50)"
ok "vLLM on 127.0.0.1:8001: $(models http://127.0.0.1:8001 | python3 -c 'import sys,json; print(", ".join(m["id"] for m in json.load(sys.stdin)["data"]))')"

echo "Tunnel"
url="${SUP_TUNNEL_URL:-}"
for _ in $(seq 60); do
  [ -n "${SUP_TUNNEL_URL:-}" ] || url=$(journalctl --user -u sup-tunnel -o cat --since "-30min" 2>/dev/null \
    | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "$url" ] && models "$url" >/dev/null 2>&1 && break
  sleep 2
done
[ -n "$url" ] || bad "no tunnel URL (journalctl --user -u sup-tunnel -n 50)"
models "$url" >/dev/null || bad "the tunnel does not answer"
curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url/v1/models" | grep -q 401 || bad "vLLM answers without the API key!"
ok "tunnel $url (rejects calls without the key)"
echo
echo "Server settings (the key stays out of git):"
echo "  SUP_PERCEPTION=vlm SUP_VLM_BASE_URL=$url/v1 SUP_VLM_API_KEY=<ssh 172.16.0.204 'grep SUP_VLM_API_KEY ~/sup/env'>"
