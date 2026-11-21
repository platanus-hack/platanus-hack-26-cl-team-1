#!/usr/bin/env bash
# One command to bring the Modo Armado server up (on the 3090) and print the link.
#   bash ~/cv/app/deploy/up.sh            # (re)install units, start, verify
#   bash ~/cv/app/deploy/up.sh --restart  # also restart running services
# Units are systemd --user with linger (no sudo needed), Restart=always.
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
APP_URL="${CV_APP_URL:-https://circuito-vivo-web.onrender.com}"
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✘\033[0m %s\n' "$*"; exit 1; }

echo "GPU"
nvidia-smi --query-gpu=name,memory.used,memory.total --format=csv,noheader || bad "nvidia-smi falló"
ok "GPU visible"

mkdir -p ~/.config/systemd/user
cp ~/cv/app/deploy/systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable cv-vllm cv-vision cv-tunnel >/dev/null 2>&1
if [ "${1:-}" = "--restart" ]; then systemctl --user restart cv-vllm cv-vision cv-tunnel; else systemctl --user start cv-vllm cv-vision cv-tunnel; fi
[ "$(loginctl show-user "$USER" -p Linger --value)" = yes ] || loginctl enable-linger || echo "  (sin linger: los servicios se detienen al cerrar sesión)"

wait_for() { # name, seconds, command...
  local name=$1 secs=$2; shift 2
  for _ in $(seq "$secs"); do if "$@" >/dev/null 2>&1; then ok "$name"; return 0; fi; sleep 1; done
  bad "$name no respondió en ${secs}s"
}
echo "Servicios"
wait_for "vLLM (127.0.0.1:8001)" 300 curl -fsS 127.0.0.1:8001/v1/models
wait_for "visión (127.0.0.1:8100)" 90 curl -fsS 127.0.0.1:8100/health
curl -fsS 127.0.0.1:8100/health; echo

echo "Túnel"
url=""
for _ in $(seq 60); do
  url=$(journalctl --user -u cv-tunnel -o cat --since "-30min" 2>/dev/null | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1 || true)
  [ -n "${CV_TUNNEL_URL:-}" ] && url="$CV_TUNNEL_URL"
  [ -n "$url" ] && curl -fsS --max-time 5 "$url/health" >/dev/null 2>&1 && break
  sleep 2
done
[ -n "$url" ] || bad "no encontré la URL del túnel (journalctl --user -u cv-tunnel)"
curl -fsS --max-time 10 "$url/health" || bad "el túnel no responde"; echo
ok "túnel $url"
echo
curl -fsS 127.0.0.1:8100/health | python3 -c '
import sys, json
h = json.load(sys.stdin)
print("Voz:      ", h.get("voice") or "sin TTS (el navegador lee el texto)")
print("Detector: ", h.get("detector") or "ninguno (solo VLM)")
' 2>/dev/null || true
echo "VLM:       $(curl -fsS 127.0.0.1:8001/v1/models | python3 -c 'import sys,json; print(", ".join(m["id"] for m in json.load(sys.stdin)["data"]))' 2>/dev/null || echo '?')"
echo "Abrir:  ${APP_URL}/?vision=${url/https:/wss:}/ws/session"
