/**
 * JSON definitions of the custom blocks (Spanish). Each block maps 1:1 to a
 * Block IR node (see kinds.ts and toIR.ts).
 */
import { B } from './kinds';
import { blockStyle, type CategoryKey } from './palette';
import { ICONS, swatch } from './icons';
import { NOTES, RGB_PRESETS } from './kinds';
import { PART_FIELD, PIN_FIELD } from './fields';

type Json = Record<string, unknown>;

const icon = (src: string): Json => ({ type: 'field_image', src, width: 16, height: 16, alt: '' });
const num = (name: string): Json => ({ type: 'input_value', name, check: 'Number' });
const bool = (name: string): Json => ({ type: 'input_value', name, check: 'Boolean' });
const part = (partKind: string): Json => ({ type: PART_FIELD, name: 'PART', partKind });
const pin = (pinFilter: string): Json => ({ type: PIN_FIELD, name: 'PIN', pinFilter });

function stmt(type: string, cat: CategoryKey, message0: string, args0: Json[], tooltip: string, extra: Json = {}): Json {
  return { type, message0, args0, previousStatement: null, nextStatement: null, inputsInline: true, style: blockStyle(cat), tooltip, ...extra };
}

function expr(type: string, cat: CategoryKey, message0: string, args0: Json[], output: string | null, tooltip: string, extra: Json = {}): Json {
  return { type, message0, args0, output, inputsInline: true, style: blockStyle(cat), tooltip, ...extra };
}

export const RGB_PRESET_OPTIONS = [
  [{ src: swatch(null), width: 18, height: 18, alt: 'personalizado' }, 'custom'],
  ...RGB_PRESETS.map((p) => [{ src: swatch(p.rgb), width: 18, height: 18, alt: p.label }, p.id]),
];

const PRESET_FIELD: Json = { type: 'field_dropdown', name: 'PRESET', options: RGB_PRESET_OPTIONS };

export function customBlockDefs(): Json[] {
  return [
    /* ------------------------------ eventos ------------------------------ */
    {
      type: B.setup,
      message0: '%1 al iniciar %2 %3',
      args0: [icon(ICONS.play), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      style: blockStyle('events'),
      tooltip: 'Se ejecuta UNA vez cuando la placa arranca. Ideal para preparar pines y valores iniciales.',
      extensions: ['cv_hat'],
    },
    {
      type: B.loop,
      message0: '%1 repetir para siempre %2 %3',
      args0: [icon(ICONS.repeat), { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }],
      style: blockStyle('events'),
      tooltip: 'Se repite una y otra vez mientras la placa tenga energía.',
      extensions: ['cv_hat'],
    },

    /* ------------------------------ control ------------------------------ */
    stmt(B.delay, 'control', 'esperar %1 ms', [num('MS')], 'Pausa el programa. 1000 ms = 1 segundo.'),
    stmt(B.waitUntil, 'control', 'esperar hasta que %1', [bool('COND')], 'Detiene el programa hasta que la condición sea verdadera.'),

    /* ---------------------------- matemáticas ---------------------------- */
    expr(
      B.map,
      'math',
      'mapear %1 de %2 – %3 a %4 – %5',
      [num('VALUE'), num('FROM_LOW'), num('FROM_HIGH'), num('TO_LOW'), num('TO_HIGH')],
      'Number',
      'Convierte un valor de un rango a otro. Ej.: 0–1023 a 0–255.',
    ),
    expr(B.constrain, 'math', 'restringir %1 entre %2 y %3', [num('VALUE'), num('LOW'), num('HIGH')], 'Number', 'Mantiene el valor dentro de los límites.'),
    expr(B.millis, 'math', 'tiempo desde el inicio (ms)', [], 'Number', 'Milisegundos desde que el programa empezó (millis).'),

    /* ------------------------------- pines ------------------------------- */
    stmt(
      B.pinMode,
      'pins',
      'configurar pin %1 como %2',
      [pin('digital'), { type: 'field_dropdown', name: 'MODE', options: [['salida', 'OUTPUT'], ['entrada', 'INPUT'], ['entrada con pull-up', 'INPUT_PULLUP']] }],
      'Indica si el pin envía (salida) o lee (entrada) señales.',
    ),
    stmt(B.digitalWrite, 'pins', 'escribir digital pin %1 %2', [pin('digital'), num('VALUE')], 'Pone el pin en ALTO (voltaje) o BAJO (0 V).'),
    expr(B.digitalRead, 'pins', 'leer digital pin %1', [pin('digital')], 'Number', 'Devuelve 1 si el pin está en ALTO o 0 si está en BAJO.'),
    stmt(B.analogWrite, 'pins', 'escribir PWM pin %1 valor %2', [pin('pwm'), num('VALUE')], 'PWM de 0 (apagado) a 255 (máximo). Solo pines con PWM.'),
    expr(B.analogRead, 'pins', 'leer analógico pin %1', [pin('analog')], 'Number', 'Lee el voltaje del pin como número (Uno: 0–1023, ESP32-C6: 0–4095).'),
    stmt(B.tone, 'pins', 'tono en pin %1 de %2 Hz', [pin('digital'), num('FREQ')], 'Genera un sonido continuo en el pin.'),
    stmt(B.toneMs, 'pins', 'tono en pin %1 de %2 Hz durante %3 ms', [pin('digital'), num('FREQ'), num('MS')], 'Genera un sonido durante un tiempo.'),
    stmt(B.noTone, 'pins', 'silenciar pin %1', [pin('digital')], 'Detiene el tono del pin.'),
    expr(B.pinLevel, 'pins', '%1', [{ type: 'field_dropdown', name: 'LEVEL', options: [['ALTO', '1'], ['BAJO', '0']] }], 'Number', 'ALTO = 1, BAJO = 0.'),

    /* -------------------------------- LEDs -------------------------------- */
    expr(B.onOff, 'leds', '%1', [{ type: 'field_dropdown', name: 'STATE', options: [['encender', 'TRUE'], ['apagar', 'FALSE']] }], 'Boolean', 'Encendido (verdadero) o apagado (falso).'),
    stmt(B.led, 'leds', '%1 LED %2 %3', [icon(ICONS.bulb), part('led'), bool('ON')], 'Enciende o apaga el LED elegido.'),
    stmt(B.ledBrightness, 'leds', '%1 LED %2 brillo %3 %', [icon(ICONS.bulb), part('ledBrightness'), num('PERCENT')], 'Brillo de 0 % a 100 % (necesita un pin con PWM).'),
    stmt(
      B.rgb,
      'leds',
      '%1 LED RGB %2 color %3 R %4 G %5 B %6',
      [icon(ICONS.bulb), part('rgb'), PRESET_FIELD, num('R'), num('G'), num('B')],
      'Mezcla rojo, verde y azul (0–255 cada uno).',
      { extensions: ['cv_rgb_preset'] },
    ),

    /* ------------------------------ entradas ----------------------------- */
    expr(B.buttonPressed, 'inputs', '¿%1 está presionado?', [part('buttonPressed')], 'Boolean', 'Verdadero mientras mantienes presionado el botón.'),
    expr(B.buttonClicked, 'inputs', '¿se hizo clic en %1?', [part('buttonClicked')], 'Boolean', 'Verdadero UNA vez por cada pulsación.'),
    expr(B.switchOn, 'inputs', '¿%1 está encendido?', [part('switchOn')], 'Boolean', 'Verdadero cuando el interruptor está en la posición de encendido.'),
    expr(B.potPercent, 'inputs', 'valor de %1 (%)', [part('potPercent')], 'Number', 'Posición de la perilla de 0 a 100 %.'),
    expr(B.lightPercent, 'inputs', 'luz en %1 (%)', [part('lightPercent')], 'Number', 'Cantidad de luz de 0 (oscuro) a 100 (mucha luz).'),
    expr(B.analogRaw, 'inputs', 'valor analógico crudo de %1', [part('analogRaw')], 'Number', 'Lectura directa del conversor (Uno: 0–1023, ESP32-C6: 0–4095).'),

    /* ------------------------------- sonido ------------------------------ */
    expr(B.note, 'sound', '%1', [{ type: 'field_dropdown', name: 'NOTE', options: NOTES.map((n) => [n.label, String(n.hz)]) }], 'Number', 'Nota musical (frecuencia en Hz).'),
    stmt(B.buzzerToneMs, 'sound', '%1 zumbador %2 tocar %3 durante %4 ms', [icon(ICONS.note), part('buzzerTone'), num('FREQ'), num('MS')], 'Toca una nota (o una frecuencia en Hz) durante un tiempo.'),
    stmt(B.buzzerTone, 'sound', '%1 zumbador %2 tocar %3', [icon(ICONS.note), part('buzzerTone'), num('FREQ')], 'Toca una nota (o una frecuencia en Hz) sin parar, hasta silenciarlo.'),
    stmt(B.buzzerOff, 'sound', '%1 silenciar zumbador %2', [icon(ICONS.note), part('buzzerOff')], 'Detiene el sonido del zumbador.'),

    /* ----------------------------- movimiento ---------------------------- */
    stmt(B.servo, 'motion', '%1 servo %2 mover a %3 °', [icon(ICONS.motion), part('servo'), num('ANGLE')], 'Gira el servo a un ángulo entre 0° y 180°.'),
    stmt(B.motor, 'motion', '%1 motor %2 velocidad %3 %', [icon(ICONS.motion), part('motor'), num('SPEED')], 'Velocidad del motor de 0 % (detenido) a 100 %.'),

    /* -------------------------------- placa ------------------------------ */
    stmt(B.onboardLed, 'board', '%1 LED integrado %2', [icon(ICONS.chip), bool('ON')], 'El LED que viene soldado en la placa.'),
    stmt(
      B.onboardRgb,
      'board',
      '%1 LED RGB integrado color %2 R %3 G %4 B %5',
      [icon(ICONS.chip), PRESET_FIELD, num('R'), num('G'), num('B')],
      'El LED RGB de la ESP32-C6 (0–255 por color).',
      { extensions: ['cv_rgb_preset'] },
    ),

    /* ---------------------------- comunicación --------------------------- */
    stmt(
      B.serialPrint,
      'comm',
      '%1 monitor serie: imprimir %2 %3',
      [
        icon(ICONS.terminal),
        { type: 'input_value', name: 'VALUE' },
        { type: 'field_dropdown', name: 'NEWLINE', options: [['con salto de línea', 'TRUE'], ['sin salto de línea', 'FALSE']] },
      ],
      'Envía texto o números al monitor serie del computador.',
    ),

  ];
}

/** Replacement definitions for built-in blocks (same type names, IR-compatible options). */
export function builtinOverrideDefs(): Json[] {
  return [
    {
      type: 'math_arithmetic',
      message0: '%1 %2 %3',
      args0: [
        num('A'),
        { type: 'field_dropdown', name: 'OP', options: [['+', 'ADD'], ['−', 'MINUS'], ['×', 'MULTIPLY'], ['÷', 'DIVIDE']] },
        num('B'),
      ],
      inputsInline: true,
      output: 'Number',
      style: 'math_blocks',
      tooltip: 'Suma, resta, multiplicación o división.',
    },
    {
      type: 'math_single',
      message0: '%1 %2',
      args0: [
        {
          type: 'field_dropdown',
          name: 'OP',
          options: [
            ['raíz cuadrada', 'ROOT'],
            ['valor absoluto', 'ABS'],
            ['−', 'NEG'],
            ['10^', 'POW10'],
            ['redondear', 'ROUND'],
            ['redondear hacia arriba', 'ROUNDUP'],
            ['redondear hacia abajo', 'ROUNDDOWN'],
            ['seno', 'SIN'],
            ['coseno', 'COS'],
          ],
        },
        num('NUM'),
      ],
      inputsInline: true,
      output: 'Number',
      style: 'math_blocks',
      tooltip: 'Operación matemática sobre un número.',
    },
  ];
}
