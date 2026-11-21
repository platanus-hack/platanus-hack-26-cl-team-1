# Demo del Modo Armado — guion y checklist

## 30 minutos antes

1. **Servidor:** `ssh 172.16.0.204 'bash ~/cv/app/deploy/up.sh'` → todo en ✔ y copia el link que imprime al final
   (`https://circuito-vivo-web.onrender.com/?armado&vision=wss://<túnel>/ws/session`).
   - Si el túnel se reinició, **la URL cambió**: usa la nueva. La app la recuerda en el navegador.
   - Revisa que diga `Detector: yolo-armado-…pt` (si no, se usa el modo solo VLM) y `VLM: qwen3vl, armado` si la LoRA está activa.
2. **Mesa:** tapete pegado, protoboard sobre su contorno, cámara en su soporte (marcas de cinta), luz pareja, sin sombras duras.
3. **Navegador (Chrome):** abre el link, carga el ejemplo del circuito demo, **Modo Armado → Empezar**.
   - Badges: `Conectado` y `Calibrado` (los 4 marcadores a la vista).
   - Tecla **D**: la grilla de huecos tiene que caer sobre los huecos reales. Si está corrida: **Calibrar huecos** y clic en
     a1, a30, j1 y j30 (queda guardado en el servidor). Tecla **D** de nuevo para ocultar el debug.
4. **Audio:** volumen del computador alto; el saludo se tiene que escuchar al empezar.
5. **Respaldo de red:** hotspot del celular listo y probado (el túnel funciona por cualquier red con internet).

## Guion (≈ 3 min)

1. "Diseñamos el circuito en Circuito Vivo; ahora lo armamos de verdad." → Modo Armado → Empezar. Se escucha el saludo.
2. Primeros pasos: la checklist avanza sola y el agente dicta el siguiente paso.
3. **Error 1 — LED al revés:** poner el LED con la pata larga al lado equivocado → "Ojo, el LED está al revés…". Corregirlo
   → "Bien, ahora sí" y avanza.
4. **Error 2 — resistencia corrida una columna** → aviso con la columna correcta. Corregir.
5. **Error 3 — cable al pin equivocado** → aviso. Corregir.
6. Terminar el circuito → "¡Listo, el circuito está armado!".
7. Tecla **D**: mostrar las detecciones y la latencia (frame → servidor ~100 ms; juicio del VLM ~0,5 s).
8. Mostrar `training/results/SUMMARY.md`: antes vs. después del fine-tuning (YOLO y VLM).

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| "No pude conectar con el servidor de visión" | `up.sh` en el servidor y usar la URL nueva del túnel |
| `Buscando marcadores n/4` | algo tapa un marcador (mano, cable): despejar; la H anterior se mantiene mientras tanto |
| La grilla no calza con los huecos | Calibrar huecos (4 clics) |
| No avanza un paso que está bien | **Ya lo hice** (o la tecla N en modo dataset) |
| La voz molesta o se repite | botón de silencio (la checklist y los subtítulos siguen) |
| Todo lo demás | **video de respaldo** |

## Ensayo (F9): 3 veces seguidas sin reiniciar nada

| # | Hora | Completa | Errores detectados | Notas |
|---|---|---|---|---|
| 1 | | | /3 | |
| 2 | | | /3 | |
| 3 | | | /3 | |

## Video de respaldo (F10)

Grabar en paralelo la pantalla (Cmd+Shift+5; macOS no captura el audio del sistema) **y** la mesa con un celular cerca
de los parlantes, que sí capta la voz del agente. La demo completa: un error detectado y corregido, el circuito terminado
y la tabla de `SUMMARY.md`. Subirlo y dejar el link en `project-description.md`.
