# Referencia del Block IR

El programa del estudiante vive como bloques (Blockly). La herramienta `set_program`
recibe el programa como **Block IR**: JSON plano que la app convierte en bloques
visibles, en C++ para Arduino y en la simulación. Esta referencia refleja
`frontend/src/contracts/ir.ts` (fuente de verdad).

## Forma general

```json
{
  "variables": [{ "name": "contador", "type": "number", "init": 0 }],
  "setup": [],
  "loop": [],
  "functions": [{ "name": "parpadear", "body": [] }]
}
```

- `setup` = bloque «al iniciar» (corre una vez). `loop` = «repetir para siempre».
- `variables` y `functions` son opcionales. La app completa `version` y `board`.
- Cada nodo es un objeto con `k` (su tipo) y sus campos. No escribas `id`: la app los genera.
- Los valores (`Expr`) son objetos, nunca números sueltos: `{"k":"num","v":500}`, no `500`.
- Verdadero/falso como en C: `0` es falso, cualquier otro número es verdadero.

## Instrucciones (`Stmt`)

### Componentes (preferidas)
Referencian el **id del componente** (`led1`, `btn1`). El pin se resuelve por el
cableado, así el programa sigue funcionando si el estudiante mueve un cable.

| `k` | Campos | Qué hace |
|---|---|---|
| `led` | `part`, `on: Expr` | Enciende/apaga un LED (respeta si está cableado a GND o a +). |
| `ledBrightness` | `part`, `percent: Expr` 0..100 | Brillo con PWM (el pin debe tener PWM). |
| `rgb` | `part`, `r`, `g`, `b: Expr` 0..255 | Color de un LED RGB. |
| `buzzerTone` | `part`, `freq: Expr` Hz, `ms?: Expr` | Hace sonar el zumbador pasivo. Sin `ms` suena hasta `buzzerOff`. |
| `buzzerOff` | `part` | Silencia el zumbador. |
| `servo` | `part`, `angle: Expr` 0..180 | Mueve el servo. |
| `motor` | `part`, `speed: Expr` 0..100 | Velocidad (% PWM en el pin que maneja el transistor). |
| `onboardLed` | `on: Expr` | LED integrado (Uno: «L» en D13 · ESP32-C6: LED RGB en blanco). |
| `onboardRgb` | `r`, `g`, `b: Expr` 0..255 | LED RGB integrado del ESP32-C6 (en el Uno se ignora con advertencia). |

### Pines genéricos
Usan el **id de pin de la placa** (`D13`, `A0`, `GPIO4`), nunca `13` ni `LED_BUILTIN`.

| `k` | Campos |
|---|---|
| `pinMode` | `pin`, `mode`: `"OUTPUT"` \| `"INPUT"` \| `"INPUT_PULLUP"` |
| `digitalWrite` | `pin`, `value: Expr` (≠ 0 → HIGH) |
| `analogWrite` | `pin`, `value: Expr` 0..255 (PWM) |
| `tone` | `pin`, `freq: Expr`, `ms?: Expr` |
| `noTone` | `pin` |

### Tiempo y control
| `k` | Campos |
|---|---|
| `delay` | `ms: Expr` |
| `waitUntil` | `cond: Expr` — espera hasta que la condición sea verdadera |
| `if` | `branches: [{ cond: Expr, body: Stmt[] }, …]`, `else?: Stmt[]` (varias ramas = «si no, si») |
| `repeat` | `times: Expr`, `body: Stmt[]` |
| `while` | `cond: Expr`, `body: Stmt[]`, `until?: boolean` (`true` = repetir *hasta que*) |
| `for` | `var`, `from: Expr`, `to: Expr`, `by: Expr`, `body: Stmt[]` (incluye `to`) |
| `break` / `continue` | — (solo dentro de `repeat`/`while`/`for`) |
| `call` | `name` — llama a una función de `functions` |

### Variables y monitor serie
| `k` | Campos |
|---|---|
| `set` | `var`, `value: Expr` |
| `change` | `var`, `delta: Expr` (suma `delta`) |
| `serialPrint` | `value: Expr` (acepta `str`), `newline: boolean` |

## Valores (`Expr`)

| `k` | Campos | Resultado |
|---|---|---|
| `num` | `v: number` | número |
| `bool` | `v: boolean` | verdadero/falso |
| `str` | `v: string` | texto — **solo** dentro de `serialPrint.value` |
| `var` | `name` | valor de una variable |
| `bin` | `op`, `a`, `b` | `+ - * / %  == != < <= > >=  && \|\|` |
| `not` / `neg` | `a` | negación lógica / cambio de signo |
| `math` | `fn`, `a` | `abs sqrt round floor ceil sin cos pow10` (`sin`/`cos` reciben grados, no radianes) |
| `random` | `min`, `max` | entero en [min, max] |
| `map` | `value`, `fromLow`, `fromHigh`, `toLow`, `toHigh` | regla de tres (con decimales) |
| `constrain` | `value`, `low`, `high` | limita al rango |
| `millis` | — | ms desde que partió el programa |
| `digitalRead` | `pin` | 0 o 1 |
| `analogRead` | `pin` | lectura cruda del ADC (Uno 0..1023, ESP32-C6 0..4095) |
| `buttonPressed` | `part` | verdadero mientras el botón está apretado |
| `buttonClicked` | `part` | verdadero **una vez** por cada apretón (con antirrebote) |
| `switchOn` | `part` | interruptor deslizante en posición «activo» |
| `potPercent` | `part` | perilla 0..100 |
| `lightPercent` | `part` | luz sobre la LDR 0..100 |
| `analogRaw` | `part` | lectura cruda del ADC del pin del componente |

## Qué componente habilita qué nodo (`PartDef.blocks`)

| Tipo de componente | Nodos |
|---|---|
| `led` | `led`, `ledBrightness` |
| `led-rgb` | `rgb` |
| `button` | `buttonPressed`, `buttonClicked` |
| `switch-slide` | `switchOn` |
| `potentiometer` | `potPercent`, `analogRaw` |
| `ldr` | `lightPercent`, `analogRaw` |
| `buzzer` | `buzzerTone`, `buzzerOff` |
| `servo-sg90` | `servo` |
| `motor-dc` | `motor` (a través de un transistor NPN) |

Usar un nodo de componente con un `part` que no existe, o cuyo tipo no lo
permite, es un error. Si el componente no está cableado a un pin de la placa
(binding sin pin), el bloque se omite y aparece una advertencia «no conectado».

## Modelo numérico (código y simulación coinciden)

- Variables `number` → `double` en C; `boolean` → `bool`. Toda variable usada
  (también la de un `for`) se declara global; si falta en `variables` se
  declara sola como número (con advertencia).
- `/` es división real; `%` es `fmod`. Dividir por 0 da 0.
- `map` usa decimales (no el `map` entero de Arduino). `random(min, max)` incluye `max`.
- Pines: `digitalWrite(v ≠ 0 ? HIGH : LOW)`; `analogWrite` redondea y limita a 0..255;
  `delay` con negativos espera 0.
- `serialPrint`: los enteros se imprimen sin decimales (`3`), los demás con 2
  (`3.14`); booleanos como `verdadero`/`falso`; `newline: true` agrega salto de línea.

## Setup implícito (no lo escribas tú)

Antes de tu `setup`, la app agrega automáticamente:
- `pinMode` correcto para cada componente usado por un nodo de componente
  (salidas → OUTPUT; botones/interruptores → INPUT o INPUT_PULLUP según el cableado;
  sensores analógicos → nada).
- `servo.attach(pin)` para cada servo y `Serial.begin(baudios de la placa)` si hay `serialPrint`.
- Un `digitalWrite`/`analogWrite`/`tone` genérico en un pin sin `pinMode` recibe
  `pinMode(OUTPUT)` automático (con advertencia).
- `analogWrite` en un pin sin PWM se comporta como en Arduino (< 128 → LOW, si no HIGH).

## Fórmulas de sensores

- `potPercent` / `lightPercent` = `round(crudo × 100 / máximoADC)`, invertido
  (`100 − x`) si el cableado hace que más luz/giro baje el voltaje.
- `buttonPressed` / `switchOn` = `digitalRead(pin) == (activoEnBajo ? LOW : HIGH)`.
  Un botón entre el pin y GND usa INPUT_PULLUP y está «activo en bajo»: tú solo
  usas `buttonPressed`, la app resuelve la lógica.
- `buttonClicked` = flanco de subida de «apretado» con 30 ms de antirrebote.
- `waitUntil(cond)` = `while (!cond) delay(1)`.
- En el Uno: usar un servo desactiva el PWM en D9/D10; `tone` lo desactiva en D3/D11
  y solo puede sonar un tono a la vez.

## Pines, referencias y protoboard (para el cableado)

- **Pin de placa en el IR**: id canónico de la placa. Uno: `D0`..`D13`, `A0`..`A5`
  (`SDA` = `A4`, `SCL` = `A5`: usa `A4`/`A5`). ESP32-C6: `GPIO0`..`GPIO23` (no existe `GPIO14`).
- **PinRef** (herramientas `connect`, `highlight`): `"<idComponente>.<idPin>"`,
  p. ej. `led1.anode`, `r1.b`, `uno1.D13`, `uno1.GND1`, `esp1.GPIO4`, `bb1.e10`.
- **Protoboard** (`bb1`, media protoboard de 30 columnas):
  - Agujeros `a1`..`j30`: fila (`a`–`j`) + columna (1–30).
  - En cada columna, `a`–`e` están unidos entre sí y `f`–`j` también; el canal
    central separa ambas mitades (un chip o un ESP32 lo «monta»).
  - Rieles: `T+` y `T-` arriba, `B+` y `B-` abajo, recorren todo el largo
    (ids `T+1`, `T-7`, `B+12`…; no existe la columna 6, 12, 18, 24 ni 30 en los rieles).
  - Dos patas en la misma columna (misma mitad) quedan conectadas; por eso
    un componente de dos patas se pone a lo largo de una fila, en columnas distintas.

## Ejemplos

### 1. Parpadeo (LED `led1` con resistencia en D13)

```json
{
  "setup": [],
  "loop": [
    { "k": "led", "part": "led1", "on": { "k": "bool", "v": true } },
    { "k": "delay", "ms": { "k": "num", "v": 500 } },
    { "k": "led", "part": "led1", "on": { "k": "bool", "v": false } },
    { "k": "delay", "ms": { "k": "num", "v": 500 } }
  ]
}
```

### 2. Botón que enciende un LED y cuenta los clics (`btn1` entre D2 y GND, `led1`)

```json
{
  "variables": [{ "name": "clics", "type": "number", "init": 0 }],
  "setup": [
    { "k": "serialPrint", "value": { "k": "str", "v": "¡Listo! Aprieta el botón" }, "newline": true }
  ],
  "loop": [
    {
      "k": "if",
      "branches": [
        { "cond": { "k": "buttonPressed", "part": "btn1" },
          "body": [{ "k": "led", "part": "led1", "on": { "k": "bool", "v": true } }] }
      ],
      "else": [{ "k": "led", "part": "led1", "on": { "k": "bool", "v": false } }]
    },
    {
      "k": "if",
      "branches": [
        { "cond": { "k": "buttonClicked", "part": "btn1" },
          "body": [
            { "k": "change", "var": "clics", "delta": { "k": "num", "v": 1 } },
            { "k": "serialPrint", "value": { "k": "str", "v": "Clics: " }, "newline": false },
            { "k": "serialPrint", "value": { "k": "var", "name": "clics" }, "newline": true }
          ] }
      ]
    }
  ]
}
```

### 3. Servo controlado por una perilla (`pot1` cursor en A0, `servo1` señal en D9)

```json
{
  "setup": [],
  "loop": [
    {
      "k": "servo",
      "part": "servo1",
      "angle": {
        "k": "map",
        "value": { "k": "potPercent", "part": "pot1" },
        "fromLow": { "k": "num", "v": 0 }, "fromHigh": { "k": "num", "v": 100 },
        "toLow": { "k": "num", "v": 0 }, "toHigh": { "k": "num", "v": 180 }
      }
    },
    { "k": "delay", "ms": { "k": "num", "v": 15 } }
  ]
}
```
