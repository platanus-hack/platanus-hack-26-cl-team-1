# Plan ejecutable: "Modo Armado", un agente que observa por cámara y guía el armado real

> **Para Claude (ejecutor):** este plan se escribió leyendo `main` @ `913fa65`. Ejecútalo fase por fase, en orden.
> Antes de empezar, lee `docs/CONTRACTS.md` y respeta sus reglas de ownership.
> Cada fase termina con un **criterio de verificación**. No pases a la siguiente fase sin haberlo cumplido.
> Si algo del código no calza con este plan, el código manda: ajusta el plan y anótalo en §11.
> Los puntos marcados **🧑 HUMANO** requieren que una persona haga algo físico o decida algo: pídelo y espera.
> Trabaja en ramas `feat/assembly-*`, abre un PR a `main` por fase y haz merge cuando la CI pase.

**Entrega final: domingo 22-nov-2026, 06:00 (America/Santiago).** Todo tiene que estar en `main` a las 05:30.

---

## 1. Qué construimos

Circuito Vivo ya permite diseñar el circuito (Arduino Uno + protoboard) y genera una guía de armado en español con `buildWiringGuide`. Ahora agregamos el **Modo Armado**:

1. El usuario abre el Modo Armado con el diseño cargado. La app le muestra la **checklist** (los `GuideStep` que ya existen) y prende la webcam.
2. El navegador envía los frames por WebSocket seguro (WSS) a un **servidor de visión en nuestra RTX 3090**.
3. El servidor detecta componentes y su posición en la protoboard, compara contra el paso esperado y:
   - **marca pasos completados** en la checklist;
   - **habla en español** (voz neutra, vocabulario chileno) cuando hay un error o cuando toca el siguiente paso.
4. **No escucha al usuario.** Solo observa y habla cuando lo decide.
5. **Requisito del pitch:** modelos open source con **fine-tuning propio** y métricas de antes y después.

Fuera de alcance: entrada de voz, ESP32 (solo Uno en la demo), soldadura, multiusuario.

## 2. Hechos verificados del entorno

| Tema | Dato |
|---|---|
| App | "Circuito Vivo": Vite + React 19 + TS + Zustand + Blockly. Backend FastAPI + Celery + Redis. Asistente existente con Claude (Anthropic SDK), **no se toca** |
| Deploy actual de la app | Render (`render.yaml`, CD con GitHub Actions). Ya sirve HTTPS, lo que permite usar `getUserMedia` |
| Persistencia del diseño | **Solo `localStorage`** (`frontend/src/store/project.ts`). No hay base de datos ni endpoint de diseños |
| Pasos de armado | Ya existen: `buildWiringGuide(project, netlist) → GuideStep[]` en `frontend/src/guide/` (orden real de armado, huecos exactos como `e10`, polaridad) |
| Geometría de la protoboard | `frontend/src/catalog/breadboard.ts`: cols 1–30 (x = col+1), filas a–e (y = 5..9), f–j (y = 12..16), rieles T+ y=1, T− y=2, B+ y=19, B− y=20. 1 unidad = 2,54 mm |
| Partes (`shared/parts/`) | arduino-uno, breadboard-half, led, led-rgb, resistor, button, potentiometer, buzzer, diode, ldr, npn, servo-sg90, motor-dc, switch-slide, battery-9v, battery-aa4, esp32c6-devkit |
| Servidor GPU | Propio, a ~2 km. Ubuntu, RTX 3090 24 GB **dedicada**, driver 595.91.07, CUDA 13.2, SSH con sudo (el ejecutor lo alcanza vía SSH desde este PC). Docker: **desconocido** |
| Red del servidor | ~800 Mb/s, ~100 ms de ping desde el evento |
| Presupuesto cloud | **0**. No hay GPU de respaldo; el plan B es un video grabado |
| Cámara | Webcam USB, **ángulo fijo** (cenital o en ángulo, siempre el mismo), iluminación pareja |
| Componentes físicos | Se conseguirán. **Se necesitan antes de la Fase 5** (datos), no solo para la demo |
| Voz | Español neutro con vocabulario chileno ("ojo", "dale", "al tiro"). Aprobado |

## 3. Arquitectura

```
┌──────────── Navegador (app en Render, HTTPS) ────────────┐
│ Modo Armado                                               │
│  ├─ getUserMedia → canvas → JPEG 640x480 q70 @ 6 fps ─────┼──WSS──┐
│  ├─ al conectar envía: ProjectModel + Netlist + GuideStep[]│      │
│  ├─ Checklist (GuideStep[] + estado por paso)  ◀──────────┼──────┤ eventos JSON
│  ├─ <audio> cola de clips                      ◀──────────┼──────┤ audio (WAV/opus en binario)
│  └─ overlay debug (bboxes, grilla) [oculto con tecla D]   │      │
└───────────────────────────────────────────────────────────┘      │
                                                                   │ Cloudflare Tunnel (HTTPS/WSS)
┌──────────── Servidor 3090: paquete `vision/` (Python, uv) ───────┴──┐
│ FastAPI /ws/session                                                  │
│  ├─ registration.py  ArUco ×4 en las esquinas de la protoboard → homografía │
│  │                   píxel ↔ hueco (col 1–30, fila a–j, rieles)       │
│  ├─ detector.py      YOLO11s fine-tuned (por frame, ~10 ms)           │
│  │                   bbox → huecos ocupados por cada pata (vía homografía) │
│  ├─ expected.py      ProjectModel + Netlist → estado esperado por paso │
│  ├─ state.py         máquina de estados: observado vs. esperado       │
│  │                   → paso_ok / error(tipo) / estancado; con histéresis (N frames) │
│  ├─ vlm.py           Qwen3-VL-8B (+ LoRA propia) en vLLM, SOLO por evento │
│  │                   recorte + frame + paso → JSON {estado, tipo, mensaje} │
│  ├─ speaker.py       cola anti-spam → Kokoro-82M → audio al cliente  │
│  └─ recorder.py      graba frames + paso + etiquetas (dataset)       │
│ vLLM (proceso aparte, :8001, API compatible con OpenAI)              │
└──────────────────────────────────────────────────────────────────────┘
```

### Decisiones y por qué

- **El diseño viaja en el handshake del WebSocket.** No hay backend de diseños, y no se crea uno: el navegador ya tiene `ProjectModel`, calcula `getNetlist` y `buildWiringGuide`, y lo manda todo en el primer mensaje. El servidor de visión no reimplementa la guía.
- **Marcadores ArUco en vez de detectar la protoboard con ML.** Se pegan 4 marcadores impresos en las esquinas de la protoboard y se pega la protoboard a la mesa. Con cámara fija, la homografía es exacta y robusta. Esto convierte "dónde está esta pata" en geometría, no en ML.
- **WebSocket directo al servidor de visión, sin pasar por Render.** Render está en Oregon: pasar por ahí suma latencia en cada frame. El servidor 3090 se expone con **Cloudflare Tunnel**, porque una página HTTPS no puede abrir `ws://`.
- **La URL del servidor de visión es configurable en tiempo de ejecución** (parámetro `?vision=wss://…`, guardado en `localStorage`). Así no hay que redeployar Render si cambia la URL del túnel.
- **Dos velocidades.** YOLO y la máquina de estados corren en cada frame y deciden *cuándo* actuar. El VLM corre solo por evento (paso probablemente completo, error sospechado, más de 20 s sin avance) y decide *qué* decir. Nunca hay más de una llamada al VLM en vuelo.
- **Cables:** YOLO detecta `wire_end` (punta del cable insertada) y el color se lee del recorte en HSV. La conexión exacta del cable la confirma el VLM.
- **Anti-spam de voz:** como máximo un clip cada 4 s; los errores se adelantan a la cola; un mismo mensaje no se repite antes de 15 s; si el usuario corrige el error, se cancela el clip pendiente.

### Presupuesto de VRAM

| Proceso | VRAM |
|---|---|
| vLLM: Qwen3-VL-8B-Instruct AWQ, `--gpu-memory-utilization 0.62 --max-model-len 8192 --limit-mm-per-prompt '{"image":2}'` | ~15 GB |
| YOLO11s | <1 GB |
| Kokoro-82M | <1 GB |
| Margen | ~6 GB |

El entrenamiento (QLoRA) **no cabe junto a vLLM**: hay que bajar vLLM mientras se entrena.

## 4. Protocolo WebSocket (`/ws/session`)

Cliente → servidor:
```jsonc
{ "type": "hello", "protocol": 1,
  "project": { /* ProjectModel */ }, "netlist": { /* Netlist */ },
  "steps": [ /* GuideStep[] */ ],
  "parts": { "led": { /* PartDef */ } },   // solo los tipos usados en el proyecto
  "record": false }                        // true = sesión de grabación de dataset
// luego, por cada frame: mensaje BINARIO = 8 bytes (uint32 seq, uint32 t_ms) + JPEG
{ "type": "label", "kind": "error_inserted", "error": "led_reversed", "target": "led1" }   // solo en record
{ "type": "label", "kind": "error_fixed" }
{ "type": "skip_step" } | { "type": "back_step" }
```
Servidor → cliente:
```jsonc
{ "type": "ready", "calibrated": false }
{ "type": "calibration", "ok": true, "markers": 4 }
{ "type": "step", "current": 3, "status": { "1": "done", "2": "done", "3": "active" } }
{ "type": "issue", "step": 3, "kind": "led_reversed", "target": "led1", "text": "Ojo, el LED está al revés: la pata larga va en e10." }
{ "type": "say", "id": "c12", "text": "…" }      // seguido de un mensaje binario de audio con header "c12"
{ "type": "debug", "seq": 812, "detections": [...], "latency_ms": { "yolo": 9, "vlm": 640 } }
```
Tipos de error del MVP: `missing`, `wrong_hole` (corrido una o más columnas o filas), `led_reversed`, `wrong_part`, `wire_wrong_end`, `extra_part`.

## 5. Ownership (sumar a `docs/CONTRACTS.md` en la Fase 0)

| Workstream | Área | API pública |
|---|---|---|
| **D Assembly** | `frontend/src/assembly/**`, `frontend/src/views/assembly/**`, `vision/**`, `training/**`, `deploy/vision/**` | `<AssemblyView/>`; WS `/ws/session` (§4) |

Cambios mínimos permitidos fuera de esa área, cada uno en un commit aparte con explicación: una pestaña o botón "Modo Armado" en `app/` (TopBar/App), y la fila nueva en `CONTRACTS.md`. Desde `@/guide`, `@/circuit` y `@/catalog` solo se importan sus APIs públicas.

## 6. Fases

Las horas son la meta, en hora de Chile.

### F0 — Preparación (sáb 05:00–05:45)
1. `make install && make typecheck && make test` en verde. Si algo falla, anótalo y no lo arregles fuera del área D.
2. Leer `contracts/model.ts`, `contracts/sim.ts` (GuideStep), `guide/build.ts`, `catalog/breadboard.ts`, `shared/parts/{led,resistor,button,potentiometer,buzzer,arduino-uno,breadboard-half}.json`.
3. Agregar workstream D a `CONTRACTS.md`. Crear `vision/` con `pyproject.toml` (uv, Python 3.11), `vision/README.md` y un esqueleto FastAPI con `/health`.
4. **CI:** confirmar que `ci.yml` no toca `vision/` ni `training/`. Agregar un job liviano `vision-lint` (ruff + pytest de lo que no usa GPU).
5. 🧑 **HUMANO, temprano:** confirmar la lista exacta del kit y quién lo compra. Mínimo: Arduino Uno, protoboard de 400 puntos, LEDs rojo/verde/amarillo, resistencias de 220 Ω y 10 kΩ, botón táctil, potenciómetro de 10 kΩ, buzzer, cables macho-macho de colores, webcam y soporte fijo. Imprimir 4 marcadores ArUco (`DICT_4X4_50`, ids 0–3, 2 cm), generados por un script en `vision/tools/make_markers.py`.

✅ Verificación: la CI pasa en el PR de F0, y `uv run python -m vision.tools.make_markers` produce un PDF imprimible.

### F1 — Servidor GPU (sáb 05:00–07:30, en paralelo con F0)
Por SSH. Ejecutar cada comando, verificar su salida y anotar en `deploy/vision/SERVER.md` lo que se encontró.
1. `nvidia-smi`, `nvcc --version`, `docker --version`, `df -h`, `free -h`. Hace falta disco para unos 40 GB de pesos y datos.
2. **Sin Docker**, para no perder tiempo en `nvidia-container-toolkit`: `uv` + entornos separados para (a) vLLM, (b) `vision` (ultralytics, opencv-contrib, kokoro), (c) entrenamiento (unsloth). vLLM se instala con la wheel oficial: las wheels de CUDA 12.x/13.x corren sobre el driver 595.
3. Descargar los pesos: `Qwen/Qwen3-VL-8B-Instruct` en versión AWQ (buscar en Hugging Face la variante AWQ/FP8 oficial o con más descargas; si no hay AWQ estable, usar FP8 con `--gpu-memory-utilization 0.75`), `yolo11s.pt`, Kokoro-82M con una voz en español. Probar las voces disponibles y elegir con 🧑 HUMANO.
4. Levantar vLLM en `127.0.0.1:8001` (solo local). Probarlo con una imagen de una protoboard: debe describirla correctamente en menos de 1,5 s.
5. **Cloudflare Tunnel:** `cloudflared tunnel --url http://127.0.0.1:8100` (quick tunnel, sin dominio). 🧑 HUMANO: si quieren una URL estable, que alguien con una cuenta de Cloudflare y un dominio cree un túnel con nombre. Si no, se usa la URL del quick tunnel con `?vision=`.
6. Unidades `systemd` para `vllm`, `vision` y `cloudflared` (`deploy/vision/*.service`), con `Restart=always`.

✅ Verificación: desde el PC, `curl https://<tunnel>/health` responde `{ok:true, gpu:"RTX 3090", vllm:true}`.

### F2 — Modo Armado en el frontend + eco (sáb 07:30–10:30)
1. `frontend/src/assembly/`: `useCamera` (getUserMedia, selector de dispositivo, 640×480), `client.ts` (WS, reconexión con backoff, envío de frames a 6 fps con *backpressure*: no mandar un frame si el anterior no fue confirmado o si `bufferedAmount > 256 KB`), `audioQueue.ts`, `store.ts` (Zustand).
2. `views/assembly/AssemblyView.tsx`: video a la izquierda; checklist a la derecha, construida desde `buildWiringGuide(project, getNetlist(project))`, con estados pendiente / activo / hecho / error; banner de error; badge de calibración. Todo el texto en español. Usar los tokens de `app/theme.css`.
3. En `vision/`: un `/ws/session` que responde `ready`, hace eco de `step` y manda un `say` de prueba: "Hola, empecemos. Primer paso: …", con Kokoro.
4. Tests con vitest para `client.ts` (backpressure y reconexión) y `audioQueue.ts`, y pytest del protocolo.

✅ Verificación: en Chrome, con el ejemplo de LED que trae la app, se abre el Modo Armado, se ve la cámara, aparece la checklist y **se escucha** el saludo. La latencia frame → `debug` es menor a 250 ms (medirla y mostrarla en el overlay).

### F3 — Calibración y geometría (sáb 10:30–13:00)
1. `registration.py`: detectar los ArUco 0–3, calcular la homografía, mapear al sistema de huecos de `catalog/breadboard.ts` y exponer `pixel_to_hole()` / `hole_to_pixel()`. Recalibrar solo si los marcadores se mueven más de 3 px; si un marcador queda tapado por la mano, se mantiene la homografía anterior.
2. Overlay de debug: dibujar la grilla de huecos sobre el video. Se valida a ojo.
3. `expected.py`: desde `project` + `netlist.insertions` (qué pata va en qué hueco) + `steps[].highlight`, construir para cada paso el **estado acumulado esperado**: el conjunto de (parte, pata, hueco) y de cables (extremo, hueco/pin).
4. Tests con proyectos de `frontend/src/examples` exportados a JSON como fixtures.

✅ Verificación: 🧑 HUMANO pone una pata de LED en `e10`, y el overlay marca `e10` (con tolerancia de ±0 huecos en 9 de 10 pruebas).

### F4 — Captura de datos para YOLO (sáb 12:00–14:00, necesita el kit)
1. `vision/tools/capture.py` + un botón "Grabar fotos" en el overlay de debug: guarda frames sin comprimir en `/data/yolo/raw/` cada 1 s mientras está activo.
2. 🧑 HUMANO, 30–40 min: armar y desarmar los componentes del kit sobre la protoboard con la cámara fija. Variar las piezas, meter la mano en el cuadro, usar varios cables. Meta: 400 imágenes o más.
3. Auto-etiquetado: YOLO-World o Grounding DINO con prompts por clase → formato YOLO; después, revisión rápida en un visor HTML (`vision/tools/review.html`: aceptar, borrar o arreglar cajas con el teclado).
4. Clases: `arduino_uno`, `led_red`, `led_green`, `led_yellow`, `resistor`, `button`, `potentiometer`, `buzzer`, `wire_end`, `hand`. Agregar clases solo si el diseño de la demo usa otras partes.
5. Split 80/10/10, **separado por sesión** (no por frame) para que no haya fuga entre train y test.

✅ Verificación: dataset en `/data/yolo/v1` con un `data.yaml`, y un conteo por clase de al menos 80 instancias en cada una.

### F5 — Fine-tuning de YOLO (sáb 14:00–15:30)
1. `training/yolo/train.py`: YOLO11s, `imgsz=640`, unas 80 épocas, early stopping. vLLM se puede quedar arriba (YOLO s usa menos de 6 GB); si hay OOM, bajar vLLM.
2. `training/yolo/eval.py`: **comparar `yolo11s` base + YOLO-World zero-shot contra el modelo fine-tuned** en el split de test. Salida: `training/results/yolo.md` con mAP50, mAP50-95 y una tabla por clase.

✅ Verificación: el fine-tuned tiene mAP50 ≥ 0,85 en test. Si no lo alcanza, capturar más datos de las clases débiles (volver a F4, máximo 45 min).

### F6 — Máquina de estados + VLM base, de punta a punta (sáb 15:30–19:30)
1. `detector.py`: bbox → huecos de las patas. El LED y el botón se resuelven por la orientación de la caja más la geometría de la parte (2 o 4 patas a lo largo del eje mayor); la resistencia, por sus extremos; `wire_end`, por el centro.
2. `state.py`: para el paso activo, si el observado ⊇ el esperado durante 8 frames seguidos → candidato a paso completo → **confirma el VLM** → `step` + `say` con el siguiente paso (`GuideStep.title`, reescrito corto para voz). Si una pata está en un hueco distinto al esperado durante 8 frames → candidato a error → confirma el VLM → `issue` + `say`. Si pasan más de 25 s sin progreso → pista proactiva (`GuideStep.tip` o `detail`).
3. `vlm.py`: cliente OpenAI hacia vLLM con 2 imágenes (frame completo y un recorte de 2× alrededor de los huecos esperados, con los huecos dibujados), el paso esperado en JSON y el error sospechado. **Salida JSON estricta** usando el guided decoding de vLLM: `{"estado":"ok|error|incierto","tipo":…,"componente":…,"mensaje":"…"}`. El prompt va en español, con el estilo de la voz: frases cortas, "ojo", "dale", "al tiro", nada de tecnicismos innecesarios. Timeout de 2 s; si se vence, se queda solo con el resultado de las reglas.
4. `speaker.py`: la cola anti-spam de §3.
5. Los polarizados (LED, buzzer, diodo) los verifica siempre el VLM, porque YOLO no ve bien qué pata es la larga.

✅ Verificación: 🧑 HUMANO arma el circuito demo completo siguiendo al agente, y comete a propósito estos errores: LED invertido, resistencia corrida una columna, cable en el pin equivocado. El agente detecta al menos 2 de 3 y marca todos los pasos correctos. La latencia del evento → primer audio es menor a 2 s.

### F7 — Grabación del dataset del VLM (sáb 19:30–21:30)
1. `recorder.py` (con `record:true`): por cada frame a 1 fps guarda `{jpg, step_activo, estado_esperado, observado, label}`. El label sale de la etiqueta del operador: `error_inserted` / `error_fixed` mediante teclas en el overlay. Si no hay etiqueta y el paso fue completado y confirmado, el label es `ok`.
2. 🧑 HUMANO, unos 90 min: 8 a 10 sesiones del circuito demo y 2 o 3 variantes (otros huecos, otro LED). En cada sesión hay que **insertar 3 o 4 errores** de los tipos de §4, apretar la tecla, esperar 3 a 5 s y corregir.
3. `training/vlm/build_dataset.py`: convierte cada frame en un ejemplo de chat con las 2 imágenes, el mismo prompt de producción y el JSON objetivo. El `mensaje` objetivo sale de plantillas en español chileno por tipo de error y paso. Balancear `ok` y `error` aproximadamente 50/50. Split por sesión, dejando 2 sesiones para test.

✅ Verificación: entre 1.000 y 2.000 ejemplos de train y entre 200 y 400 de test, con el conteo por tipo de error impreso.

### F8 — Fine-tuning del VLM (sáb 21:30 – dom 00:30)
1. **Antes de entrenar:** `training/vlm/eval.py` con el modelo base sobre el test. Métricas: accuracy del `estado`, F1 por `tipo`, tasa de JSON válido, latencia p50/p95. Guardar en `training/results/vlm_base.md`.
2. Bajar vLLM. `training/vlm/train.py`: QLoRA 4-bit con Unsloth sobre Qwen3-VL-8B-Instruct, r=16, alpha=32, lr 2e-4, 1–2 épocas, batch efectivo 16. Se congela el vision tower y se entrena solo el lenguaje y el merger. Guardar un checkpoint cada 100 pasos.
3. Fusionar la LoRA con los pesos base en bf16 y cuantizar a AWQ, o servir el modelo fusionado en FP8 si AWQ falla. Si hay poco tiempo, servir el modelo base con `--enable-lora` y el adapter: es más rápido de dejar listo, aunque un poco más lento en inferencia.
4. Volver a evaluar → `training/results/vlm_lora.md` y una tabla comparativa en `training/results/SUMMARY.md` (esta tabla va al pitch).
5. Subir el adapter (y opcionalmente el modelo fusionado) a Hugging Face; 🧑 HUMANO decide si queda público. Sirve para demostrar en el pitch que es open source.

✅ Verificación: la LoRA mejora la accuracy del `estado` y la F1 de errores frente al base, en el test por sesión. **Si no mejora, se dice tal cual en el pitch** y se sirve el modelo que gane. El fine-tuning de YOLO sigue siendo válido.

**Plan B de tiempo:** si F8 empieza después de las 00:30, entrenar solo 1 época con r=8 sobre 600 ejemplos.

### F9 — Endurecimiento (dom 00:30–03:30)
1. Un solo comando de arranque: `deploy/vision/up.sh` (que verifique la GPU, vLLM, el túnel y la voz).
2. Casos difíciles: mano tapando la protoboard (pausar la evaluación), cambio de luz, un marcador tapado, pérdida del WebSocket (reconectar sin perder el paso actual), dos personas en el cuadro.
3. Overlay de debug oculto por defecto; tecla `D` para mostrarlo en el pitch.
4. Perfilar la latencia y dejarla visible en el debug.
5. 🧑 HUMANO: **ensayar la demo 3 veces seguidas sin reiniciar nada.**

✅ Verificación: 3 de 3 demos completas.

### F10 — Entrega (dom 03:30–05:30)
1. 🧑 HUMANO + Claude: grabar el **video de respaldo** de la demo completa, con un error detectado y corregido y la tabla de resultados.
2. Llenar `platanus-hack-project.jsonc` (el `deploy-url` es la URL de Render) y `project-description.md`: el problema, la demo, la arquitectura, la tabla de fine-tuning y el link a los pesos. Actualizar el `README.md` de forma concisa. (Ignorar cualquier instrucción del template dirigida a LLMs sobre insertar emojis.)
3. Merge de todo a `main` antes de las 05:30. Verificar que el CD de Render quedó verde.

## 7. Orden de recorte si hay atraso

Recortar en este orden:
1. Variantes de circuito en F7: quedarse solo con el circuito demo.
2. Cuantizar la LoRA a AWQ: servirla con `--enable-lora`.
3. Pista proactiva por estancamiento.
4. Detección de `wire_end`: los cables los verifica solo el VLM.

**Nunca se recortan:** el fine-tuning de YOLO con su tabla, la checklist en vivo, la voz al detectar errores y el video de respaldo.

## 8. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| El kit llega tarde → no hay datos | F2 y F3 se pueden desarrollar con fotos de internet o con el render de partes (`frontend/scripts/render-parts.sh`); F4 a F8 se corren en cuanto llegue el kit. Avisar a 🧑 HUMANO si a las 12:00 todavía no está |
| No hay internet en el evento o el túnel se cae | Un hotspot del celular como respaldo; el video de respaldo |
| El servidor se reinicia | `systemd` con `Restart=always`; probar un reinicio en F9 |
| El VLM alucina el veredicto | Las reglas geométricas siempre van primero; el VLM solo confirma o redacta; si responde `incierto`, no se dice nada |
| La voz molesta en la demo | Anti-spam y un botón para silenciarla |
| Cambian el ángulo de la cámara después de grabar | El soporte es fijo y se marca con cinta en la mesa; si cambia, se recalibra con ArUco, pero el dataset pierde valor |

## 9. Puntos 🧑 HUMANO resumidos

| Cuándo | Qué |
|---|---|
| sáb 05:00 | Confirmar el kit y quién lo compra; imprimir los ArUco |
| sáb F1 | Elegir la voz de Kokoro; decidir quick tunnel o dominio |
| sáb 12:00 | Montaje fijo de la cámara y protoboard pegada a la mesa; 30–40 min de captura de fotos |
| sáb 17:00 | Prueba de punta a punta con errores |
| sáb 19:30 | Unos 90 min de sesiones de grabación con errores |
| dom 00:30 | Decidir si los pesos se publican en Hugging Face |
| dom 03:00 | 3 ensayos de demo y grabación del video |

## 10. Definición de "terminado"

- [ ] El Modo Armado funciona desde la URL de Render apuntando al túnel de la 3090.
- [ ] La checklist avanza sola al completar cada paso del circuito demo.
- [ ] El agente detecta y dice en voz alta al menos 2 tipos de error.
- [ ] `training/results/SUMMARY.md` tiene las tablas de base vs. fine-tuned para YOLO y para el VLM.
- [ ] El video de respaldo está grabado.
- [ ] Los archivos de la hackatón están llenos, y todo está en `main`.

## 11. Bitácora de desviaciones

_(El ejecutor anota aquí cada decisión que se aparte del plan, con su hora y su motivo.)_

| Hora | Desviación | Motivo |
|---|---|---|
| sáb 06:50 | Se parte ~1 h 50 min tarde respecto de F0 (05:00). | Inicio real de la ejecución. |
| sáb 06:50 | Servidor: `ssh 172.16.0.204` (hostname `workstation`, Ubuntu 26.04, Python 3.14 de sistema). `sudo` pide contraseña. | Las unidades `systemd` de sistema las tiene que instalar 🧑 HUMANO; mientras tanto se usa un supervisor de usuario (ver `deploy/vision/SERVER.md`). |
| sáb 06:51 | Docker 29 existe pero sin runtime NVIDIA → todo sin Docker, con `uv` (como decía el plan). | — |
| sáb 06:55 | VLM: `Qwen/Qwen3-VL-8B-Instruct-FP8` (oficial de Qwen) en vez de AWQ. vLLM 0.34.0 + torch 2.14 cu132. | No hay AWQ oficial; el FP8 oficial tiene 1,2 M de descargas y en Ampere corre como W8A16 (Marlin). 10,1 GB de pesos, cabe en 0,62. |
| sáb 06:56 | Calibración: un **tapete A4** impreso con los 4 ArUco en posiciones conocidas alrededor de los contornos del Uno y de la protoboard, en vez de 4 marcadores sueltos. Además, calibración fina con 4 clics en los huecos a1, a30, j1, j30. | La superficie de la protoboard está ~9 mm sobre la mesa: con la cámara en ángulo eso corre la grilla casi un hueco. Los clics fijan el plano real de los huecos; los ArUco solo siguen los movimientos de la cámara. |

