# Servidor de visión (RTX 3090)

## Lo que se encontró (sáb 21-nov 06:50)

| Tema | Dato |
|---|---|
| Acceso | `ssh 172.16.0.204` (hostname `workstation`, usuario `alonsogac`). `sudo` pide contraseña |
| SO | Ubuntu 26.04.1 LTS, Python de sistema 3.14 |
| GPU | RTX 3090 24 GB, driver 595.91.07, CUDA 13.2. Sin `nvcc` (no hace falta: las wheels traen su CUDA) |
| Docker | 29.10, **sin runtime NVIDIA** → no se usa |
| Disco / RAM | 1,6 TB libres en `/` · 59 GB RAM · 32 núcleos |
| `uv` | `~/.local/bin/uv` (agregar `~/.local/bin` al `PATH` en shells no interactivas) |
| systemd | `loginctl enable-linger` funciona sin sudo → servicios `systemd --user` |

## Layout en el servidor

```
~/cv/
  app/vision/        ← rsync de vision/ (venv propio: uv sync --python 3.12 --extra gpu)
  app/deploy/        ← rsync de deploy/vision/
  venvs/vllm/        ← vLLM 0.34.0 + torch 2.14 cu132 (Python 3.12)
  models/yolo11s.pt  ← pesos base de YOLO
  data/              ← dataset YOLO, sesiones del VLM, calibración, muestras de voz
  logs/
  env                ← variables opcionales (VLM_MODEL, VLM_LORA, CV_VOICE, CV_TUNNEL_TOKEN…)
~/.cache/huggingface/hub/
  Qwen/Qwen3-VL-8B-Instruct (17 GB, BF16: base para el fine-tuning)
  Qwen/Qwen3-VL-8B-Instruct-FP8 (9,9 GB: el que sirve vLLM)
  hexgrad/Kokoro-82M (voces en español: ef_dora, em_alex, em_santa)
```

## Instalar desde cero

```bash
# desde el PC, en la raíz del repo
ssh 172.16.0.204 'mkdir -p ~/cv/app ~/cv/logs'
rsync -az --exclude .venv --exclude out vision/ 172.16.0.204:cv/app/vision/
rsync -az deploy/vision/ 172.16.0.204:cv/app/deploy/
ssh 172.16.0.204 'bash ~/cv/app/deploy/bootstrap.sh 2>&1 | tee ~/cv/logs/bootstrap.log'
ssh 172.16.0.204 'cd ~/cv/app/vision && ~/.local/bin/uv sync --python 3.12 --extra gpu'
```

## Arranque (un solo comando)

```bash
ssh 172.16.0.204 'bash ~/cv/app/deploy/up.sh'            # instala/arranca las unidades y verifica
ssh 172.16.0.204 'bash ~/cv/app/deploy/up.sh --restart'  # además reinicia todo
```

`up.sh` verifica la GPU, vLLM, el servidor de visión y el túnel, y al final imprime el link:
`https://circuito-vivo-web.onrender.com/?vision=wss://<túnel>/ws/session`.

Unidades (`deploy/vision/systemd/`, instaladas en `~/.config/systemd/user/`, `Restart=always`):

| Unidad | Qué corre |
|---|---|
| `cv-vllm` | `deploy/vision/vllm.sh` → vLLM en `127.0.0.1:8001`, modelo `qwen3vl` |
| `cv-vision` | `uvicorn vision.app:app` en `127.0.0.1:8100` |
| `cv-tunnel` | `cloudflared` quick tunnel → `127.0.0.1:8100` (o túnel con nombre si `CV_TUNNEL_TOKEN` está en `~/cv/env`) |

Logs: `journalctl --user -u cv-vision -f` (o `cv-vllm`, `cv-tunnel`).

**Ojo:** la URL del quick tunnel cambia cada vez que se reinicia `cv-tunnel`. La app la toma de
`?vision=wss://…` y la guarda en `localStorage`, así que no hay que redeployar Render.

## Mediciones

| Prueba | Resultado |
|---|---|
| vLLM: Qwen3-VL-8B FP8 (Marlin W8A16 en Ampere), `--gpu-memory-utilization 0.62` | 10,1 GB de pesos, KV cache 15.360 tokens |
| Describir una foto de protoboard (640 px, 347 tokens de entrada, 65 de salida) | 0,75 s (primera llamada 0,99 s) |
| Kokoro-82M, 15 s de audio en español | 0,09 s |

## Sesión de entrenamiento (F8)

QLoRA no cabe junto a vLLM: `systemctl --user stop cv-vllm` antes de entrenar y
`systemctl --user start cv-vllm` después.
