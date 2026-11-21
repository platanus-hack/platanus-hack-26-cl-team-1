/**
 * Compile corpus: a wide variety of Block IR programs (every node kind, every
 * C operand type combination, risky user names, both boards) used by
 * arduino-compile.test.ts to check that EVERY generated sketch compiles with
 * the real arduino-cli. Pure data + generateCode; no Blockly.
 */
import type { BoardId, Expr, ProgramIR, Stmt } from '@/contracts';
import type { ProgramContext } from '../context';
import { kitchenSink } from './fixtures';
import { bin, bool, delay, ir, led, makeCtx, num, print, set, str, v, type BindingSpec, type PartSpec } from './testkit';

export interface CorpusCase {
  name: string;
  board: BoardId;
  ir: ProgramIR;
  ctx: ProgramContext;
}

const P = (board: BoardId, uno: string, esp: string) => (board === 'uno' ? uno : esp);

/** Standard hardware: every part type bound to a sensible pin. */
function stdHardware(board: BoardId, labels: Partial<Record<string, string>> = {}): { parts: PartSpec[]; bindings: BindingSpec[] } {
  const parts: PartSpec[] = [
    { id: 'led1', type: 'led', label: labels.led1 ?? 'LED 1' },
    { id: 'led2', type: 'led', label: labels.led2 ?? 'LED 2' },
    { id: 'rgb1', type: 'led-rgb', label: labels.rgb1 ?? 'LED RGB 1' },
    { id: 'bz1', type: 'buzzer', label: labels.bz1 ?? 'Zumbador 1' },
    { id: 'm1', type: 'motor-dc', label: labels.m1 ?? 'Motor 1' },
    { id: 'btn1', type: 'button', label: labels.btn1 ?? 'Botón 1' },
    { id: 'btn2', type: 'button', label: labels.btn2 ?? 'Botón 2' },
    { id: 'sw1', type: 'switch-slide', label: labels.sw1 ?? 'Interruptor 1' },
    { id: 'pot1', type: 'potentiometer', label: labels.pot1 ?? 'Potenciómetro 1' },
    { id: 'ldr1', type: 'ldr', label: labels.ldr1 ?? 'LDR 1' },
    { id: 'servo1', type: 'servo-sg90', label: labels.servo1 ?? 'Servo 1' },
  ];
  const b = (u: string, e: string) => P(board, u, e);
  const bindings: BindingSpec[] = [
    { part: 'led1', boardPin: b('D13', 'GPIO10') },
    { part: 'led2', boardPin: b('D12', 'GPIO11'), activeLow: true, pin: 'cathode' },
    { part: 'rgb1', boardPin: b('D3', 'GPIO18'), channel: 'r', pin: 'r' },
    { part: 'rgb1', boardPin: b('D5', 'GPIO19'), channel: 'g', pin: 'g' },
    { part: 'rgb1', boardPin: b('D6', 'GPIO20'), channel: 'b', pin: 'b', activeLow: true },
    { part: 'bz1', boardPin: b('D8', 'GPIO21'), pin: 'plus' },
    { part: 'm1', boardPin: b('D10', 'GPIO22'), pin: 'b', driver: 'npn', via: ['q1', 'r2'] },
    { part: 'btn1', boardPin: b('D2', 'GPIO23'), pin: 'a1', mode: 'INPUT_PULLUP', activeLow: true },
    { part: 'btn2', boardPin: b('D7', 'GPIO6'), pin: 'a1', mode: 'INPUT' },
    { part: 'sw1', boardPin: b('D4', 'GPIO15'), pin: 'com', mode: 'INPUT_PULLUP', activeLow: true },
    { part: 'pot1', boardPin: b('A0', 'GPIO0'), pin: 'wiper', mode: 'ANALOG' },
    { part: 'ldr1', boardPin: b('A1', 'GPIO1'), pin: 'a', mode: 'ANALOG', invert: true },
    { part: 'servo1', boardPin: b('D9', 'GPIO2'), pin: 'signal' },
  ];
  return { parts, bindings };
}

function std(board: BoardId, labels?: Partial<Record<string, string>>, name = 'Corpus'): ProgramContext {
  const { parts, bindings } = stdHardware(board, labels);
  return makeCtx(board, parts, bindings, name);
}

/** One expression of every C static type the generator can produce. */
function typedExprs(board: BoardId): Record<string, Expr> {
  return {
    intLit: num(7),
    longLit: num(100000),
    hugeLit: num(5e9),
    negLit: num(-3),
    dblLit: num(2.5),
    boolLit: bool(true),
    numVar: v('x'),
    boolVar: v('flag'),
    millis: { k: 'millis' },
    dread: { k: 'digitalRead', pin: P(board, 'D7', 'GPIO6') },
    aread: { k: 'analogRead', pin: P(board, 'A2', 'GPIO3') },
    random: { k: 'random', min: num(1), max: v('x') },
    pressed: { k: 'buttonPressed', part: 'btn1' },
    clicked: { k: 'buttonClicked', part: 'btn2' },
    switchOn: { k: 'switchOn', part: 'sw1' },
    pot: { k: 'potPercent', part: 'pot1' },
    light: { k: 'lightPercent', part: 'ldr1' },
    raw: { k: 'analogRaw', part: 'pot1' },
    round: { k: 'math', fn: 'round', a: v('x') },
    constrainInt: { k: 'constrain', value: { k: 'analogRead', pin: P(board, 'A2', 'GPIO3') }, low: num(0), high: num(100) },
    constrainMixed: { k: 'constrain', value: { k: 'millis' }, low: num(0), high: v('x') },
    constrainBool: { k: 'constrain', value: bool(true), low: num(0), high: num(1) },
    constrainUlong: { k: 'constrain', value: { k: 'millis' }, low: num(0), high: num(1000) },
    map: { k: 'map', value: v('x'), fromLow: num(0), fromHigh: num(1023), toLow: num(0), toHigh: num(255) },
    cmp: bin('<', v('x'), num(3)),
    not: { k: 'not', a: v('flag') },
    neg: { k: 'neg', a: { k: 'millis' } },
    negBool: { k: 'neg', a: bool(true) },
    negRead: { k: 'neg', a: { k: 'analogRead', pin: P(board, 'A2', 'GPIO3') } },
  };
}

/**
 * Every binop × typed operands (chunk 0), then every statement / function with
 * every operand type (chunks 1..3; split so each sketch fits in the Uno's flash).
 */
function exprMatrix(board: BoardId, chunk: number): CorpusCase {
  const t = typedExprs(board);
  const keys = Object.keys(t);
  const ops = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||'] as const;
  const loop: Stmt[] = [];
  let i = 0;
  if (chunk === 0) {
    for (const op of ops) {
      for (const a of keys) {
        // Pair each type with a rotating partner to keep the sketch reasonably small.
        const b = keys[(i++ * 7) % keys.length];
        loop.push(set(i % 2 ? 'x' : 'y', bin(op, t[a], t[b])));
      }
    }
  }
  const third = Math.ceil(keys.length / 3);
  for (const k of chunk === 0 ? [] : keys.slice((chunk - 1) * third, chunk * third)) {
    loop.push(print(t[k]));
    loop.push(print(t[k], false));
    loop.push(set('x', t[k]));
    loop.push(set('flag', t[k]));
    loop.push({ k: 'change', var: 'x', delta: t[k] });
    loop.push({ k: 'change', var: 'flag', delta: t[k] });
    loop.push({ k: 'delay', ms: t[k] });
    loop.push({ k: 'waitUntil', cond: t[k] });
    loop.push({ k: 'if', branches: [{ cond: t[k], body: [] }] });
    loop.push({ k: 'repeat', times: t[k], body: [] });
    loop.push({ k: 'while', cond: t[k], body: [{ k: 'break' }] });
    loop.push({ k: 'digitalWrite', pin: P(board, 'D11', 'GPIO7'), value: t[k] });
    loop.push({ k: 'analogWrite', pin: P(board, 'D11', 'GPIO7'), value: t[k] });
    loop.push({ k: 'tone', pin: P(board, 'D11', 'GPIO7'), freq: t[k] });
    loop.push({ k: 'tone', pin: P(board, 'D11', 'GPIO7'), freq: t[k], ms: t[k] });
    loop.push(led('led1', t[k]));
    loop.push(led('led2', t[k]));
    loop.push({ k: 'ledBrightness', part: 'led1', percent: t[k] });
    loop.push({ k: 'ledBrightness', part: 'led2', percent: t[k] });
    loop.push({ k: 'rgb', part: 'rgb1', r: t[k], g: t[k], b: t[k] });
    loop.push({ k: 'buzzerTone', part: 'bz1', freq: t[k] });
    loop.push({ k: 'buzzerTone', part: 'bz1', freq: t[k], ms: t[k] });
    loop.push({ k: 'servo', part: 'servo1', angle: t[k] });
    loop.push({ k: 'motor', part: 'm1', speed: t[k] });
    loop.push({ k: 'onboardLed', on: t[k] });
    loop.push({ k: 'onboardRgb', r: t[k], g: t[k], b: t[k] });
    loop.push({ k: 'for', var: 'j', from: t[k], to: t[k], by: t[k], body: [] });
    for (const fn of ['abs', 'sqrt', 'round', 'floor', 'ceil', 'sin', 'cos', 'pow10'] as const) loop.push(set('y', { k: 'math', fn, a: t[k] }));
    loop.push(set('y', { k: 'neg', a: t[k] }));
    loop.push(set('y', { k: 'not', a: t[k] }));
    loop.push(set('y', { k: 'random', min: t[k], max: t[k] }));
    loop.push(set('y', { k: 'map', value: t[k], fromLow: t[k], fromHigh: t[k], toLow: t[k], toHigh: t[k] }));
    loop.push(set('y', { k: 'constrain', value: t[k], low: t[k], high: t[k] }));
    loop.push(set('y', { k: 'constrain', value: t[k], low: num(0), high: num(10) }));
    loop.push(set('y', { k: 'constrain', value: num(5), low: t[k], high: num(10.5) }));
  }
  return {
    name: `matrix${chunk}_${board}`,
    board,
    ctx: std(board),
    ir: ir({ variables: [{ name: 'x', type: 'number', init: 3 }, { name: 'y', type: 'number' }, { name: 'flag', type: 'boolean' }], loop }),
  };
}

/** Control-flow shapes: for loops (literal/dynamic/down/zero/fractional), nested break/continue, functions, recursion. */
function controlFlow(board: BoardId): CorpusCase {
  const loop: Stmt[] = [
    { k: 'for', var: 'i', from: num(1), to: num(10), by: num(1), body: [print(v('i'))] },
    { k: 'for', var: 'i', from: num(10), to: num(1), by: num(1), body: [print(v('i'))] },
    { k: 'for', var: 'i', from: num(10), to: num(1), by: num(-2), body: [print(v('i'))] },
    { k: 'for', var: 'i', from: num(0), to: num(1), by: num(0.1), body: [print(v('i'))] },
    { k: 'for', var: 'i', from: num(0), to: num(5), by: num(0), body: [{ k: 'break' }] },
    { k: 'for', var: 'i', from: v('a'), to: v('b'), by: v('c'), body: [{ k: 'continue' }] },
    { k: 'for', var: 'i', from: num(0), to: v('b'), by: num(1), body: [] },
    { k: 'for', var: 'i', from: v('a'), to: num(3), by: num(1), body: [] },
    { k: 'for', var: 'iDesde', from: num(0), to: v('b'), by: num(1), body: [] },
    {
      k: 'for',
      var: 'i',
      from: v('a'),
      to: v('b'),
      by: num(1),
      body: [
        { k: 'for', var: 'k', from: v('i'), to: v('b'), by: num(1), body: [{ k: 'if', branches: [{ cond: bin('==', v('k'), num(3)), body: [{ k: 'break' }] }], else: [{ k: 'continue' }] }] },
        { k: 'repeat', times: num(3), body: [{ k: 'repeat', times: v('a'), body: [{ k: 'repeat', times: num(2), body: [{ k: 'repeat', times: num(2), body: [{ k: 'break' }] }] }] }] },
      ],
    },
    { k: 'repeat', times: num(40000), body: [{ k: 'continue' }] },
    { k: 'repeat', times: num(2.5), body: [] },
    { k: 'repeat', times: { k: 'random', min: num(1), max: num(6) }, body: [led('led1', true), delay(100)] },
    { k: 'while', cond: bool(true), body: [{ k: 'while', cond: bool(true), until: true, body: [] }, { k: 'break' }] },
    { k: 'if', branches: [], else: [delay(1)] },
    { k: 'if', branches: [{ cond: bool(false), body: [] }, { cond: bool(true), body: [delay(1)] }] },
    { k: 'break' },
    { k: 'continue' },
    { k: 'call', name: 'parpadear' },
    { k: 'call', name: 'no existe' },
    { k: 'call', name: 'recursiva' },
  ];
  return {
    name: `control_${board}`,
    board,
    ctx: std(board),
    ir: ir({
      variables: [
        { name: 'a', type: 'number', init: 1 },
        { name: 'b', type: 'number', init: 5 },
        { name: 'c', type: 'number', init: -1 },
        { name: 'k', type: 'number' },
      ],
      loop,
      functions: [
        { name: 'parpadear', body: [led('led1', true), delay(200), led('led1', false), { k: 'break' }, { k: 'call', name: 'otra función' }] },
        { name: 'otra función', body: [{ k: 'for', var: 'i', from: num(0), to: num(2), by: num(1), body: [{ k: 'continue' }] }] },
        { name: 'recursiva', body: [{ k: 'if', branches: [{ cond: bin('>', v('a'), num(0)), body: [{ k: 'change', var: 'a', delta: num(-1) }, { k: 'call', name: 'recursiva' }] }] }] },
      ],
    }),
  };
}

/** Names that collide with C/C++/Arduino/newlib/avr-libc symbols or macros. */
export const RISKY_NAMES = [
  'time', 'y0', 'y1', 'j0', 'j1', 'jn', 'yn', 'div', 'ldiv', 'index', 'rindex', 'rand', 'srand', 'exit', 'abort', 'free',
  'malloc', 'calloc', 'realloc', 'signal', 'raise', 'clock', 'read', 'write', 'open', 'close', 'select', 'sleep', 'usleep',
  'kill', 'wait', 'printf', 'puts', 'putchar', 'getchar', 'gamma', 'lgamma', 'tgamma', 'erf', 'erfc', 'remainder', 'fmin',
  'fmax', 'fdim', 'fma', 'hypot', 'cbrt', 'nan', 'ldexp', 'frexp', 'modf', 'atof', 'atoi', 'atol', 'itoa', 'ltoa', 'utoa',
  'dtostrf', 'string', 'errno', 'stdin', 'stdout', 'stderr', 'environ', 'timezone', 'daylight', 'tzname', 'assert',
  'offsetof', 'EOF', 'FILE', 'DEFAULT', 'EXTERNAL', 'INTERNAL', 'INTERNAL1V1', 'INTERNAL2V56', 'LED', 'TRUE', 'FALSE',
  'BUTTON', 'BOOT_PIN', 'KEY_BUILTIN', 'NOT_A_PIN', 'ON', 'OFF', 'e', 'E', 'pi', 'PIN', 'abs2', 'contador', 'estado',
  'tiempo', 'valor', 'nivel', 'velocidad', 'angulo', 'brillo', 'luz', 'boton', 'led', 'servo', 'motor', 'tono', 'nota',
  'dato', 'suma', 'resta', 'promedio', 'maximo', 'minimo', 'temp', 'count', 'speed', 'value', 'state', 'counter', 'level',
  'distance', 'angle', 'sum', 'average', 'total', 'index2', 'step', 'paso', 'i', 'j', 'n', 'x', 'y', 'z', 'Serial_2',
  'clicked_BOTON_1', 'LED_1', 'servo1', 'cv_helper', 'iHasta', 'iDesde', 'iPaso', 'pressed', 'previous', 'lastChange',
  'yield', 'delayMicroseconds', 'micros', 'attachInterrupt', 'digitalPinToInterrupt', 'bitRead', 'sei', 'cli', 'SREG',
  'TIMER', 'PWM', 'ADC0', 'GPIO', 'LEDC', 'interrupt', 'volatile2', 'register2', 'NOP', 'BIT', 'SET', 'CLEAR', 'HIGH2',
  'lowByte2', 'word2', 'boolean2', 'byte2', 'fabsf', 'sqrtf', 'log2', 'log1p', 'expm1', 'exp2', 'trunc2', 'rint', 'lrint',
  'lround', 'nearbyint', 'copysign', 'signbit', 'isfinite', 'isnormal', 'fpclassify', 'INFINITY', 'NAN', 'HUGE_VAL',
  'M_PI', 'RAND_MAX', 'INT_MAX', 'LONG_MAX', 'CHAR_BIT', 'NULL2', 'true2', 'printf2', 'sprintf', 'snprintf', 'scanf',
  'strlen', 'strcpy', 'strcmp', 'memcpy', 'memset', 'toupper', 'tolower', 'isdigit', 'isalpha', 'random2', 'setup2',
  'Wire2', 'SPI2', 'ESP', 'WiFi', 'Preferences', 'millis2', 'pinMode2', 'CHANGE2', 'RISING2', 'binary', 'B1', 'B0101',
  'BIT3', 'abs_', '_x', 'x__y', 'año', 'niño', 'ángulo', 'número de vueltas', '1er valor', 'ñandú',
];

function riskyVariables(board: BoardId): CorpusCase {
  const variables = RISKY_NAMES.map((name, i) => ({ name, type: (i % 5 === 0 ? 'boolean' : 'number') as 'number' | 'boolean', init: i % 5 === 0 ? true : i }));
  const loop: Stmt[] = RISKY_NAMES.map((name) => ({ k: 'change', var: name, delta: num(1) }));
  loop.push(print(v('time')));
  return { name: `vars_${board}`, board, ctx: std(board), ir: ir({ variables, loop }) };
}

function riskyFunctions(board: BoardId): CorpusCase {
  const functions = RISKY_NAMES.map((name) => ({ name, body: [delay(1)] }));
  const loop: Stmt[] = RISKY_NAMES.map((name) => ({ k: 'call', name }));
  return { name: `funcs_${board}`, board, ctx: std(board), ir: ir({ loop, functions }) };
}

/** Part labels become UPPER_CASE constants: try labels that collide with macros. */
const RISKY_LABELS = [
  'Default', 'External', 'Internal', 'Led', 'Led builtin', 'High', 'Input', 'A0', 'Boot', 'Button', 'True', 'On', 'Pin',
  'RGB', 'Servo', 'LED_BUILTIN', 'Timer', 'PWM', 'B1', 'Bit3', 'Serial', 'Null', 'EOF', 'Clicked BTN', 'Errno', 'Rand max',
  'Int max', 'M PI', 'NAN', 'INFINITY', 'SS', 'MOSI', 'TX', 'Pi', 'Euler', 'Botón', 'Ñandú', '1er LED', '   ', 'LED 1',
];

function riskyLabels(board: BoardId): CorpusCase[] {
  const keys = ['led1', 'led2', 'rgb1', 'bz1', 'm1', 'btn1', 'btn2', 'sw1', 'pot1', 'ldr1', 'servo1'];
  const out: CorpusCase[] = [];
  for (let start = 0; start < RISKY_LABELS.length; start += keys.length) {
    const labels: Record<string, string> = {};
    keys.forEach((k, i) => {
      labels[k] = RISKY_LABELS[(start + i) % RISKY_LABELS.length];
    });
    out.push({ name: `labels${start}_${board}`, board, ctx: std(board, labels), ir: everyPartNode(board) });
  }
  return out;
}

/** Uses every part-level node at least once. */
function everyPartNode(board: BoardId): ProgramIR {
  return ir({
    variables: [{ name: 'x', type: 'number' }],
    setup: [print(str('Hola'))],
    loop: [
      led('led1', { k: 'buttonPressed', part: 'btn1' }),
      led('led2', { k: 'buttonClicked', part: 'btn2' }),
      { k: 'ledBrightness', part: 'led1', percent: { k: 'potPercent', part: 'pot1' } },
      { k: 'rgb', part: 'rgb1', r: { k: 'lightPercent', part: 'ldr1' }, g: num(0), b: { k: 'analogRaw', part: 'pot1' } },
      { k: 'buzzerTone', part: 'bz1', freq: num(440), ms: num(100) },
      { k: 'buzzerOff', part: 'bz1' },
      { k: 'servo', part: 'servo1', angle: { k: 'potPercent', part: 'pot1' } },
      { k: 'motor', part: 'm1', speed: { k: 'switchOn', part: 'sw1' } },
      { k: 'if', branches: [{ cond: { k: 'buttonClicked', part: 'btn1' }, body: [{ k: 'change', var: 'x', delta: num(1) }] }] },
      print(v('x')),
      delay(10),
    ],
  });
}

/** Unbound / missing parts, unknown pins, onboard blocks on the wrong board, no board at all. */
function degenerate(board: BoardId): CorpusCase[] {
  const ctx = makeCtx(board, [
    { id: 'led1', type: 'led', label: 'LED 1' },
    { id: 'btn1', type: 'button', label: 'Botón 1' },
    { id: 'pot1', type: 'potentiometer', label: 'Pot 1' },
    { id: 'servo1', type: 'servo-sg90', label: 'Servo 1' },
    { id: 'rgb1', type: 'led-rgb', label: 'RGB 1' },
  ], [
    { part: 'led1', boardPin: null },
    { part: 'btn1', boardPin: null },
    { part: 'pot1', boardPin: P(board, '5V', '3V3') },
    { part: 'servo1', boardPin: null },
    { part: 'rgb1', boardPin: P(board, 'D3', 'GPIO18'), channel: 'r', pin: 'r' },
    { part: 'rgb1', boardPin: null, channel: 'g', pin: 'g' },
  ]);
  const loop: Stmt[] = [
    led('led1', { k: 'buttonClicked', part: 'btn1' }),
    led('ghost', { k: 'buttonPressed', part: 'ghost2' }),
    { k: 'servo', part: 'servo1', angle: { k: 'potPercent', part: 'pot1' } },
    { k: 'rgb', part: 'rgb1', r: num(1), g: num(2), b: num(3) },
    { k: 'digitalWrite', pin: 'GPIO99', value: num(1) },
    { k: 'pinMode', pin: 'NOPE', mode: 'INPUT' },
    { k: 'analogWrite', pin: P(board, 'D2', 'GPIO5'), value: { k: 'analogRead', pin: 'X9' } },
    set('x', { k: 'digitalRead', pin: 'Z1' }),
    { k: 'onboardLed', on: bool(true) },
    { k: 'onboardRgb', r: num(1), g: num(2), b: num(3) },
    { k: 'tone', pin: P(board, 'SDA', 'GPIO4'), freq: num(0) },
    { k: 'noTone', pin: P(board, 'SCL', 'GPIO4') },
    { k: 'servo', part: 'led1', angle: num(5) },
    set('x', str('texto')),
  ];
  return [
    { name: `degenerate_${board}`, board, ctx, ir: ir({ loop }) },
    { name: `empty_${board}`, board, ctx, ir: ir({}) },
    { name: `setuponly_${board}`, board, ctx, ir: ir({ setup: [print(num(1))] }) },
    { name: `nameless_${board}`, board, ctx: makeCtx(board, [], [], ''), ir: ir({ loop: [print(str('*/ \\ ??/'))] }) },
  ];
}

export function compileCorpus(): CorpusCase[] {
  const out: CorpusCase[] = [];
  for (const board of ['uno', 'esp32c6'] as const) {
    const ks = kitchenSink(board, true);
    out.push({ name: `kitchen_${board}`, board, ir: ks.ir, ctx: ks.ctx });
    for (const chunk of [0, 1, 2, 3]) out.push(exprMatrix(board, chunk));
    out.push(controlFlow(board));
    out.push(riskyVariables(board));
    out.push(riskyFunctions(board));
    out.push(...riskyLabels(board));
    out.push(...degenerate(board));
  }
  return out;
}
