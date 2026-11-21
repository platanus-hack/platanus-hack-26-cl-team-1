/**
 * CONTRACT 3 — Block IR
 * ---------------------------------------------------------------------------
 * What the block editor produces (program/blocks/workspaceToIR) and what the
 * simulator (program/interpreter), the C++ generator (program/codegen) and the
 * agent (set_program tool) consume. irToWorkspace is the inverse, used when
 * the agent writes a program.
 *
 * Design rules
 *  - Plain JSON, no functions. Every node may carry `id` = source Blockly
 *    block id (used to highlight the running block and map compile errors).
 *  - Part-level nodes (k: 'led', 'buttonPressed', …) reference a PartInstance
 *    id. Pins are resolved at codegen/sim time through Bindings, so the program
 *    keeps working if the user rewires the LED to another pin.
 *  - Generic pin nodes reference a BoardPin.id ('D13', 'A0', 'GPIO4').
 *  - Numbers are JS numbers. Truthiness follows C (0 = false).
 *  - Value ranges are normalized and board-independent:
 *      analogWrite.value 0..255 · percent 0..100 · rgb channels 0..255
 *      analogRead returns the RAW board value (Uno 0..1023, ESP32-C6 0..4095)
 *      potPercent / lightPercent return 0..100.
 *
 * NUMERIC MODEL (codegen and interpreter MUST agree)
 *  - VarDecl 'number' → C `double`; 'boolean' → C `bool`. Codegen declares every
 *    referenced variable (incl. `for` vars) as a global, even if missing from
 *    `variables` (auto-declared as number).
 *  - `/` is real division; `%` → fmod(a, b) (JS % has the same sign rule);
 *    division/modulo by 0 yields 0 in BOTH (codegen emits a safe helper).
 *  - map → float helper cv_map(v, a, b, c, d) (NOT Arduino's long map);
 *    random(min, max) → integer in [min, max] (C: random(min, max + 1)).
 *  - Truthiness: value != 0. Pin values: digitalWrite(value != 0 ? HIGH : LOW);
 *    analogWrite((int) constrain(round(v), 0, 255)); delay((unsigned long) max(0, ms)).
 *  - Serial printing goes through a generated helper cvPrint(): numbers with an
 *    integral value print without decimals ("3"), others with 2 decimals
 *    ("3.14"); booleans print "verdadero"/"falso"; strings verbatim. The
 *    interpreter formats identically. host.serial receives raw chunks; the
 *    runtime splits lines on "\n" (newline:true appends "\n").
 *  - ctx.board always wins over ir.board (ir.board is informational).
 *  - repeat evaluates `times` ONCE before looping.
 *  - tone/buzzerTone with freq < 1 Hz means noTone.
 *  - cvPrint mirrors Arduino Print::printFloat digit by digit (0.375 → "0.37"),
 *    printing "ovf" beyond ±4294967040.
 *  - Boards with maxPwmChannels (ESP32-C6: 6) allocate shared channels like
 *    ledcAttach; a PWM/tone/servo write without a free channel does nothing
 *    (programChecks warns).
 *
 * IMPLICIT SETUP (run before the user's setup, identical in codegen + interpreter)
 *  - For each part referenced by a part-level node, from its Binding:
 *    outputs → pinMode(OUTPUT); digital inputs → pinMode(INPUT | INPUT_PULLUP);
 *    'ANALOG' → no pinMode. Unbound parts → skipped (+ warning).
 *  - Servo parts → servo.attach(pin). Any serialPrint → Serial.begin(board.serial.baud).
 *  - Generic digitalWrite/analogWrite/tone on a pin never configured by a
 *    pinMode node → automatic pinMode(OUTPUT) + codegen warning.
 *  - analogWrite on a non-PWM pin follows Arduino (v < 128 → LOW else HIGH) + warning.
 *  - onboardRgb on the Uno → skipped + warning.
 *
 * SENSOR FORMULAS (same in both)
 *  - potPercent / lightPercent = round(raw * 100 / board.adc.maxValue), then
 *    100 − x when Binding.invert.
 *  - buttonPressed / switchOn = digitalRead(pin) == (activeLow ? LOW : HIGH).
 *  - buttonClicked = true ONCE per press (rising edge of "pressed", 30 ms debounce,
 *    per-part state; codegen emits a static helper per part).
 *  - waitUntil(cond) = while (!cond) delay(1).
 *
 * TIME (interpreter): every executed statement costs 0.01 ms of virtual time and
 * each loop() pass at least 0.1 ms, so millis() always advances (see
 * program/interpreter for the run/yield protocol).
 */
import type { BoardId, Id } from './model';

export interface ProgramIR {
  version: 1;
  board: BoardId | null;
  variables: VarDecl[];
  setup: Stmt[];
  loop: Stmt[];
  functions: FunctionDecl[];
}

export interface VarDecl {
  name: string; // valid C identifier (codegen sanitizes anyway)
  type: 'number' | 'boolean';
  /** Optional initial value (default 0 / false). */
  init?: number | boolean;
}

export interface FunctionDecl {
  id?: string;
  name: string;
  body: Stmt[];
}

type Node<K extends string, T = object> = { k: K; id?: string } & T;

export type Stmt =
  // ---- generic pins
  | Node<'pinMode', { pin: string; mode: 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP' }>
  | Node<'digitalWrite', { pin: string; value: Expr }>
  | Node<'analogWrite', { pin: string; value: Expr }> // 0..255
  | Node<'tone', { pin: string; freq: Expr; ms?: Expr }>
  | Node<'noTone', { pin: string }>
  // ---- time & flow
  | Node<'delay', { ms: Expr }>
  | Node<'waitUntil', { cond: Expr }>
  | Node<'if', { branches: Array<{ cond: Expr; body: Stmt[] }>; else?: Stmt[] }>
  | Node<'repeat', { times: Expr; body: Stmt[] }>
  | Node<'while', { cond: Expr; body: Stmt[]; until?: boolean }> // until=true → loop while !cond
  | Node<'for', { var: string; from: Expr; to: Expr; by: Expr; body: Stmt[] }>
  | Node<'break'>
  | Node<'continue'>
  | Node<'call', { name: string }>
  // ---- variables
  | Node<'set', { var: string; value: Expr }>
  | Node<'change', { var: string; delta: Expr }>
  // ---- serial
  | Node<'serialPrint', { value: Expr; newline: boolean }>
  // ---- part-level actions (resolved through Bindings)
  | Node<'led', { part: Id; on: Expr }>
  | Node<'ledBrightness', { part: Id; percent: Expr }> // 0..100, needs PWM pin
  | Node<'rgb', { part: Id; r: Expr; g: Expr; b: Expr }> // 0..255 each
  | Node<'buzzerTone', { part: Id; freq: Expr; ms?: Expr }>
  | Node<'buzzerOff', { part: Id }>
  | Node<'servo', { part: Id; angle: Expr }> // 0..180
  | Node<'motor', { part: Id; speed: Expr }> // 0..100 (% PWM on the driver pin)
  | Node<'onboardLed', { on: Expr }> // Uno: 'L' on D13 · ESP32-C6: RGB LED white/off
  | Node<'onboardRgb', { r: Expr; g: Expr; b: Expr }>; // ESP32-C6 WS2812 on GPIO8 (Uno: ignored + warning)

export type BinOp =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | '&&'
  | '||';

/** sin/cos take DEGREES (codegen emits sin(x * DEG_TO_RAD); the interpreter matches). */
export type MathFn = 'abs' | 'sqrt' | 'round' | 'floor' | 'ceil' | 'sin' | 'cos' | 'pow10';

export type Expr =
  | Node<'num', { v: number }>
  | Node<'bool', { v: boolean }>
  | Node<'str', { v: string }> // only valid inside serialPrint
  | Node<'var', { name: string }>
  | Node<'bin', { op: BinOp; a: Expr; b: Expr }>
  | Node<'not', { a: Expr }>
  | Node<'neg', { a: Expr }>
  | Node<'math', { fn: MathFn; a: Expr }>
  | Node<'random', { min: Expr; max: Expr }> // integer in [min, max]
  | Node<'map', { value: Expr; fromLow: Expr; fromHigh: Expr; toLow: Expr; toHigh: Expr }>
  | Node<'constrain', { value: Expr; low: Expr; high: Expr }>
  | Node<'millis'>
  // ---- generic pins
  | Node<'digitalRead', { pin: string }> // 0 | 1
  | Node<'analogRead', { pin: string }> // raw ADC
  // ---- part-level sensors (resolved through Bindings)
  | Node<'buttonPressed', { part: Id }> // boolean, honours Binding.activeLow
  | Node<'buttonClicked', { part: Id }> // true once per press (edge + debounce)
  | Node<'switchOn', { part: Id }> // slide switch: true when the bound pin reads "active"
  | Node<'potPercent', { part: Id }> // 0..100
  | Node<'lightPercent', { part: Id }> // 0..100 (LDR divider)
  | Node<'analogRaw', { part: Id }>; // raw ADC of the part's bound pin

export type StmtKind = Stmt['k'];
export type ExprKind = Expr['k'];

export const emptyProgram = (board: BoardId | null = null): ProgramIR => ({
  version: 1,
  board,
  variables: [],
  setup: [],
  loop: [],
  functions: [],
});
