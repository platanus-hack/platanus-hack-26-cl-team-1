# Circuito Vivo

**Aprende electrónica diseñando, simulando y programando tu circuito en el navegador… y después ármalo de verdad con un agente que te mira por la cámara y te avisa en voz alta cuando algo quedó mal.**

## El problema

Aprender electrónica con Arduino tiene dos muros. El primero es entender qué estás haciendo: corriente, resistencias, polaridad, pines. El segundo llega cuando pasas a la protoboard real: un LED al revés, una resistencia corrida una columna o un cable en el pin equivocado, y nada funciona. Nadie te dice por qué. Ahí es donde la mayoría se frustra y abandona.

## Qué hace Circuito Vivo

- **Diseña** el circuito sobre una protoboard y un Arduino Uno (o ESP32-C6) dibujados a escala real, con la vista esquemática generada en vivo.
- **Simula** la electricidad en tiempo real: ves la corriente, el brillo del LED y los avisos de cortocircuito, de LED sin resistencia o de tierras sin unir.
- **Programa con bloques** (Blockly) y ejecuta el programa en la simulación, viendo qué bloque corre. Después compila y súbelo a tu placa real desde el navegador (Web Serial).
- **Un asistente con IA** arma, corrige y explica el circuito y el programa contigo, en español.
- **Modo Armado (nuevo):** la app genera la guía de armado paso a paso, con los huecos exactos. La webcam mira tu protoboard real y un agente **marca cada paso completado** y **te habla en español chileno** cuando detecta un error: "Ojo, el LED está al revés: la pata larga va en e7."

## Cómo funciona el Modo Armado

```
Navegador (app en Render) ── webcam 640×480, 6 fps ──WSS──▶ Servidor de visión (RTX 3090, Cloudflare Tunnel)
   checklist en vivo  ◀── pasos, errores ──────────────────    ArUco → homografía (píxel ↔ hueco de la protoboard)
   voz del agente     ◀── audio (Kokoro-82M) ──────────────    YOLO11s fine-tuned: piezas y puntas de cable
                                                               máquina de estados: observado vs. esperado
                                                               Qwen3-VL-8B + LoRA propia (vLLM): confirma y redacta
```

- **Geometría, no adivinanzas:** cuatro marcadores ArUco impresos en un tapete dan la homografía exacta, así que "¿en qué hueco está esta pata?" es un cálculo, no un modelo.
- **Dos velocidades:** YOLO y las reglas corren en cada frame (~10 ms) y deciden *cuándo* actuar. El modelo visual-lingüístico corre solo cuando hay un evento (paso completo o error sospechado) y decide *qué decir*. Además, siempre revisa la polaridad, que YOLO no ve bien.
- **Habla, pero no molesta:** como máximo una frase cada 4 s, los errores se adelantan en la cola y, si corriges antes de que hable, el aviso se cancela.

## Open source y fine-tuning propio

Todos los modelos del Modo Armado son abiertos y corren en nuestra propia GPU: YOLO11s, Qwen3-VL-8B-Instruct y Kokoro-82M. Ajustamos dos de ellos con datos que grabamos en el evento, con el mismo kit y la misma cámara:

| Modelo | Antes | Después |
|---|---|---|
| Detector YOLO11s (mAP50 en sesiones no vistas) | _YOLO-World zero-shot: (pendiente)_ | _(pendiente)_ |
| Juez visual Qwen3-VL-8B (accuracy del veredicto) | _(pendiente)_ | _(pendiente)_ |
| Juez visual (F1 de detección de errores) | _(pendiente)_ | _(pendiente)_ |

Pesos de la LoRA: _(link a Hugging Face, pendiente)_ · Detalle: `training/results/SUMMARY.md`

## Demo

- App: https://circuito-vivo-web.onrender.com
- Video de respaldo: _(pendiente)_

## Equipo

Alonso Gac, Anaís Neira y José Cañete — Platanus Hack 26 Santiago, track Simulations.
