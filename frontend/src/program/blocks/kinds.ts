/**
 * Shared vocabulary of the block library: block type names, field values and
 * the tables that map them to Block IR kinds. Pure data (no Blockly import) so
 * the converters, toolbox and validator agree on one source of truth.
 */
import type { BinOp, MathFn } from '@/contracts';

/** Custom block types (built-in Blockly types are referenced by their own names). */
export const B = {
  setup: 'cv_setup',
  loop: 'cv_loop',
  delay: 'cv_delay',
  waitUntil: 'cv_wait_until',
  map: 'cv_map',
  constrain: 'cv_constrain',
  millis: 'cv_millis',
  pinMode: 'cv_pin_mode',
  digitalWrite: 'cv_digital_write',
  digitalRead: 'cv_digital_read',
  analogWrite: 'cv_analog_write',
  analogRead: 'cv_analog_read',
  tone: 'cv_tone',
  toneMs: 'cv_tone_ms',
  noTone: 'cv_no_tone',
  pinLevel: 'cv_pin_level',
  onOff: 'cv_on_off',
  note: 'cv_note',
  led: 'cv_led',
  ledBrightness: 'cv_led_brightness',
  rgb: 'cv_rgb',
  buttonPressed: 'cv_button_pressed',
  buttonClicked: 'cv_button_clicked',
  switchOn: 'cv_switch_on',
  potPercent: 'cv_pot_percent',
  lightPercent: 'cv_light_percent',
  analogRaw: 'cv_analog_raw',
  buzzerTone: 'cv_buzzer_tone',
  buzzerToneMs: 'cv_buzzer_tone_ms',
  buzzerOff: 'cv_buzzer_off',
  servo: 'cv_servo',
  motor: 'cv_motor',
  onboardLed: 'cv_onboard_led',
  onboardRgb: 'cv_onboard_rgb',
  serialPrint: 'cv_serial_print',
} as const;

/** Built-in Blockly block types we rely on. */
export const BI = {
  if: 'controls_if',
  repeat: 'controls_repeat_ext',
  whileUntil: 'controls_whileUntil',
  for: 'controls_for',
  flow: 'controls_flow_statements',
  compare: 'logic_compare',
  operation: 'logic_operation',
  negate: 'logic_negate',
  boolean: 'logic_boolean',
  number: 'math_number',
  arithmetic: 'math_arithmetic',
  modulo: 'math_modulo',
  single: 'math_single',
  randomInt: 'math_random_int',
  varGet: 'variables_get',
  varSet: 'variables_set',
  change: 'math_change',
  procDef: 'procedures_defnoreturn',
  procCall: 'procedures_callnoreturn',
  text: 'text',
} as const;

export const HAT_TYPES: readonly string[] = [B.setup, B.loop];

/* ----------------------------- operators ------------------------------ */

export const ARITH_OPS: Record<string, BinOp> = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/' };
export const COMPARE_OPS: Record<string, BinOp> = { EQ: '==', NEQ: '!=', LT: '<', LTE: '<=', GT: '>', GTE: '>=' };
export const LOGIC_OPS: Record<string, BinOp> = { AND: '&&', OR: '||' };

/** math_single OP value → IR. 'NEG' maps to the `neg` expression. */
export const SINGLE_OPS: Record<string, MathFn | 'neg'> = {
  ROOT: 'sqrt',
  ABS: 'abs',
  NEG: 'neg',
  POW10: 'pow10',
  ROUND: 'round',
  ROUNDUP: 'ceil',
  ROUNDDOWN: 'floor',
  SIN: 'sin',
  COS: 'cos',
};

export const invert = <V extends string>(rec: Record<string, V>): Record<V, string> =>
  Object.fromEntries(Object.entries(rec).map(([k, v]) => [v, k])) as Record<V, string>;

export const BINOP_BLOCK: Record<BinOp, { type: string; op: string }> = {
  '+': { type: BI.arithmetic, op: 'ADD' },
  '-': { type: BI.arithmetic, op: 'MINUS' },
  '*': { type: BI.arithmetic, op: 'MULTIPLY' },
  '/': { type: BI.arithmetic, op: 'DIVIDE' },
  '%': { type: BI.modulo, op: '' },
  '==': { type: BI.compare, op: 'EQ' },
  '!=': { type: BI.compare, op: 'NEQ' },
  '<': { type: BI.compare, op: 'LT' },
  '<=': { type: BI.compare, op: 'LTE' },
  '>': { type: BI.compare, op: 'GT' },
  '>=': { type: BI.compare, op: 'GTE' },
  '&&': { type: BI.operation, op: 'AND' },
  '||': { type: BI.operation, op: 'OR' },
};

export const MATHFN_OP: Record<MathFn, string> = {
  sqrt: 'ROOT',
  abs: 'ABS',
  pow10: 'POW10',
  round: 'ROUND',
  ceil: 'ROUNDUP',
  floor: 'ROUNDDOWN',
  sin: 'SIN',
  cos: 'COS',
};

export const ALL_BINOPS = Object.keys(BINOP_BLOCK) as BinOp[];
export const ALL_MATHFNS = Object.keys(MATHFN_OP) as MathFn[];

/* ----------------------------- part nodes ----------------------------- */

/** Part-level IR kinds (statements and expressions) → the block type that represents them. */
export const PART_STMT_BLOCK = {
  led: B.led,
  ledBrightness: B.ledBrightness,
  rgb: B.rgb,
  buzzerTone: B.buzzerTone, // B.buzzerToneMs when `ms` is present
  buzzerOff: B.buzzerOff,
  servo: B.servo,
  motor: B.motor,
} as const;

export const PART_EXPR_BLOCK = {
  buttonPressed: B.buttonPressed,
  buttonClicked: B.buttonClicked,
  switchOn: B.switchOn,
  potPercent: B.potPercent,
  lightPercent: B.lightPercent,
  analogRaw: B.analogRaw,
} as const;

export type PartStmtKind = keyof typeof PART_STMT_BLOCK;
export type PartExprKind = keyof typeof PART_EXPR_BLOCK;
export type PartKind = PartStmtKind | PartExprKind;

export const PART_KINDS: readonly PartKind[] = [
  ...(Object.keys(PART_STMT_BLOCK) as PartStmtKind[]),
  ...(Object.keys(PART_EXPR_BLOCK) as PartExprKind[]),
];

/** Block type → the IR kind used to filter its part dropdown (PartDef.blocks). */
export const BLOCK_PART_KIND: Record<string, PartKind> = {
  [B.led]: 'led',
  [B.ledBrightness]: 'ledBrightness',
  [B.rgb]: 'rgb',
  [B.buzzerTone]: 'buzzerTone',
  [B.buzzerToneMs]: 'buzzerTone',
  [B.buzzerOff]: 'buzzerOff',
  [B.servo]: 'servo',
  [B.motor]: 'motor',
  [B.buttonPressed]: 'buttonPressed',
  [B.buttonClicked]: 'buttonClicked',
  [B.switchOn]: 'switchOn',
  [B.potPercent]: 'potPercent',
  [B.lightPercent]: 'lightPercent',
  [B.analogRaw]: 'analogRaw',
};

/** Pin capability filter of the generic pin blocks' dropdowns. */
export type PinFilter = 'digital' | 'pwm' | 'analog';

export const BLOCK_PIN_FILTER: Record<string, PinFilter> = {
  [B.pinMode]: 'digital',
  [B.digitalWrite]: 'digital',
  [B.digitalRead]: 'digital',
  [B.analogWrite]: 'pwm',
  [B.analogRead]: 'analog',
  [B.tone]: 'digital',
  [B.toneMs]: 'digital',
  [B.noTone]: 'digital',
};

/* ------------------------------- presets ------------------------------ */

/** Musical notes offered by the buzzer note dropdown (Hz, rounded like Arduino's pitches.h). */
export const NOTES: ReadonlyArray<{ label: string; hz: number }> = [
  { label: 'Do4', hz: 262 },
  { label: 'Do#4', hz: 277 },
  { label: 'Re4', hz: 294 },
  { label: 'Re#4', hz: 311 },
  { label: 'Mi4', hz: 330 },
  { label: 'Fa4', hz: 349 },
  { label: 'Fa#4', hz: 370 },
  { label: 'Sol4', hz: 392 },
  { label: 'Sol#4', hz: 415 },
  { label: 'La4', hz: 440 },
  { label: 'La#4', hz: 466 },
  { label: 'Si4', hz: 494 },
  { label: 'Do5', hz: 523 },
];

export const noteForHz = (hz: number) => NOTES.find((n) => n.hz === hz);

/** RGB colour presets of the RGB LED blocks (value 'custom' = keep the numbers). */
export const RGB_PRESETS: ReadonlyArray<{ id: string; label: string; rgb: [number, number, number] }> = [
  { id: 'red', label: 'rojo', rgb: [255, 0, 0] },
  { id: 'green', label: 'verde', rgb: [0, 255, 0] },
  { id: 'blue', label: 'azul', rgb: [0, 0, 255] },
  { id: 'yellow', label: 'amarillo', rgb: [255, 200, 0] },
  { id: 'cyan', label: 'cian', rgb: [0, 255, 255] },
  { id: 'magenta', label: 'magenta', rgb: [255, 0, 255] },
  { id: 'orange', label: 'naranjo', rgb: [255, 90, 0] },
  { id: 'white', label: 'blanco', rgb: [255, 255, 255] },
  { id: 'off', label: 'apagado', rgb: [0, 0, 0] },
];

export const presetForRgb = (r: number, g: number, b: number) =>
  RGB_PRESETS.find((p) => p.rgb[0] === r && p.rgb[1] === g && p.rgb[2] === b);
