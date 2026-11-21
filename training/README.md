# Fine-tuning del Modo Armado (F4 → F8)

Todo corre en la 3090 (`ssh 172.16.0.204`). Rutas del servidor: código en `~/cv/app`, datos en `~/cv/data`.
Sincroniza el código desde el PC antes de cada fase:

```bash
rsync -az --exclude .venv --exclude out vision/ 172.16.0.204:cv/app/vision/
rsync -az training/ 172.16.0.204:cv/app/training/
```

## F4 — Fotos para YOLO (necesita el kit, cámara fija, tapete pegado)

1. App → Modo Armado → **Empezar** → tecla **D** → **Grabar fotos**. Se guarda 1 foto por segundo (JPEG q92) en
   `~/cv/data/yolo/raw/<sesión>/`. Una sesión de la app = una carpeta; el split train/val/test se hace por carpeta.
2. 🧑 30–40 min: armar y desarmar las piezas del kit, meter la mano, varios cables y colores. Meta: ≥ 400 fotos,
   repartidas en **varias sesiones** (Salir → Empezar crea una sesión nueva), así el test queda con sesiones no vistas.
3. Auto-etiquetado y revisión:

```bash
cd ~/cv/app/vision
.venv/bin/python -m vision.tools.autolabel --raw ~/cv/data/yolo/raw --out ~/cv/data/yolo/labeled --engine qwen   # o --engine world
# revisar en el navegador: https://<túnel>/review   (←/→, 0–9 clase, arrastrar = caja, Supr = borrar, Enter = aprobar)
.venv/bin/python -m vision.tools.make_dataset --src ~/cv/data/yolo/labeled --out ~/cv/data/yolo/v1 --only-reviewed
```

✅ `data.yaml` en `~/cv/data/yolo/v1` y ≥ 80 instancias por clase (el script avisa cuáles faltan).

## F5 — YOLO11s

```bash
cd ~/cv/app/vision
.venv/bin/python ../training/yolo/train.py --data ~/cv/data/yolo/v1/data.yaml --name v1
.venv/bin/python ../training/yolo/eval.py --data ~/cv/data/yolo/v1/data.yaml --finetuned ~/cv/models/yolo-armado-v1.pt
echo "CV_YOLO=$HOME/cv/models/yolo-armado-v1.pt" >> ~/cv/env && systemctl --user restart cv-vision
```

✅ mAP50 ≥ 0,85 en test → `training/results/yolo.md` (copiarlo al repo). Si no: más fotos de las clases débiles (máx. 45 min).

## F7 — Sesiones de dataset para el VLM

App → Modo Armado → **D** → **Grabar sesión (dataset)**. Mientras graba no hay voz automática ni avance
automático: el operador manda.

| Tecla | Qué marca |
|---|---|
| `N` | el paso actual quedó bien hecho (avanza) |
| `1`…`6` | acabo de meter un error: falta · hueco corrido · polaridad · pieza equivocada · cable mal · pieza de más |
| `0` | ya lo corregí |

Protocolo por sesión: armar el circuito demo siguiendo los pasos y, en 3–4 pasos, **hacer el error → tecla →
esperar 3–5 s → corregir → `0` → esperar 2 s → `N`**. 8–10 sesiones + 2–3 variantes (otros huecos, otro LED).
Se graban 3 frames por segundo en `~/cv/data/vlm/sessions/`.

```bash
cd ~/cv/app/vision
.venv/bin/python ../training/vlm/build_dataset.py --sessions ~/cv/data/vlm/sessions --out ~/cv/data/vlm/v1
```

✅ 1.000–2.000 ejemplos de train y 200–400 de test, con el conteo por tipo impreso.

## F8 — QLoRA de Qwen3-VL-8B

```bash
cd ~/cv/app/vision
.venv/bin/python ../training/vlm/eval.py --data ~/cv/data/vlm/v1/test.jsonl --model qwen3vl --name base     # ANTES
systemctl --user stop cv-vllm
~/cv/venvs/train/bin/python ../training/vlm/train.py --data ~/cv/data/vlm/v1/train.jsonl --out ~/cv/runs/vlm/v1
#   plan B de tiempo:  --epochs 1 --r 8 --limit 600
echo "VLM_LORA=$HOME/cv/runs/vlm/v1/adapter" >> ~/cv/env && systemctl --user start cv-vllm
.venv/bin/python ../training/vlm/eval.py --data ~/cv/data/vlm/v1/test.jsonl --model armado --name lora      # DESPUÉS
.venv/bin/python ../training/summary.py                                                                    # → results/SUMMARY.md
```

Para que producción use la LoRA: `echo "VLM_SERVED=armado" >> ~/cv/env && systemctl --user restart cv-vision`.
Si la LoRA no mejora, se dice tal cual en el pitch y se sirve el modelo que gane.
