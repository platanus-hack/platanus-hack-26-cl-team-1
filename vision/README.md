# vision — servidor del Modo Armado

Servidor Python (FastAPI) que corre en la RTX 3090. Recibe los frames de la webcam
por WebSocket (`/ws/session`), ubica cada pata en la protoboard, compara contra el
paso esperado de la guía y habla (Kokoro) cuando hay un error o toca el siguiente paso.
El protocolo está en `vision/protocol.py` (espejo de `frontend/src/assembly/protocol.ts`).

## Desarrollo local (sin GPU)

```bash
cd vision
uv sync                     # sin extras de GPU: sirve para tests, lint y el eco del WS
uv run pytest -q
uv run ruff check . && uv run ruff format --check .
uv run uvicorn vision.app:app --port 8100
```

## Tapete de calibración (ArUco)

```bash
uv run python -m vision.tools.make_markers   # → out/tapete-aruco.pdf (A4 apaisado, tamaño real)
```

Imprimir al 100 %, verificar que la barra mida 50 mm, pegar la protoboard sobre su
contorno y el tapete a la mesa. La cámara queda fija.

## Servidor GPU

Ver `deploy/vision/SERVER.md` (instalación sin sudo, vLLM, túnel, arranque).

```bash
uv sync --extra gpu          # ultralytics, kokoro, openai (solo en la 3090)
```

## Módulos

| Archivo | Qué hace |
|---|---|
| `mat.py` | Geometría del tapete (marcadores) y de la protoboard (huecos ↔ grilla) |
| `registration.py` | ArUco → homografía; `pixel_to_hole()` / `hole_to_pixel()` |
| `expected.py` | `ProjectModel` + `Netlist` + `GuideStep[]` → estado acumulado esperado por paso |
| `detector.py` | YOLO fine-tuned → patas en huecos |
| `state.py` | Observado vs. esperado → paso ok / error / estancado (con histéresis) |
| `vlm.py` | Qwen3-VL (vLLM) por evento → JSON `{estado, tipo, componente, mensaje}` |
| `speaker.py` | Cola anti-spam → Kokoro → audio al cliente |
| `recorder.py` | Grabación de sesiones para el dataset del VLM |
