/**
 * Differential test: generated C++ vs the IR interpreter.
 * Each program is turned into a sketch (generateCode, ESP32-C6 profile: 64-bit
 * double, libm round), compiled with the HOST C++ compiler against a tiny
 * Arduino mock (differential/Arduino.h: Print::printFloat, virtual millis) and
 * run; its Serial output must equal the interpreter's byte for byte.
 * Skipped when no host compiler is available.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { BinOp, Expr, MathFn, ProgramIR, Stmt } from '@/contracts';
import type { ProgramContext } from '../context';
import { createInterpreter } from '../interpreter';
import { generateCode } from './index';
import { bin, bool, delay, ir, makeCtx, num, print, set, str, v } from './testkit';

const CXX = process.env.CXX ?? 'c++';
const MOCK_DIR = fileURLToPath(new URL('./differential', import.meta.url));
const BUILD = join(tmpdir(), 'cv-differential');

function hasCompiler(): boolean {
  try {
    execFileSync(CXX, ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Inputs: GPIO number → digital level / raw ADC value (same for both sides). */
interface Inputs {
  digital?: Record<number, 0 | 1>;
  analog?: Record<number, number>;
  /** Time-varying digital level: [pin, fromMs, toMs, level] windows (half-open). */
  windows?: Array<[number, number, number, 0 | 1]>;
}

const levelAt = (inputs: Inputs, pin: number, ms: number): 0 | 1 | null => {
  const w = inputs.windows?.find(([p, a, b]) => p === pin && ms >= a && ms < b);
  return w ? w[3] : null;
};

const PASSES = 3;

const ctx = (): ProgramContext =>
  makeCtx('esp32c6', [
    { id: 'pot1', type: 'potentiometer', label: 'Perilla' },
    { id: 'ldr1', type: 'ldr', label: 'Luz' },
    { id: 'btn1', type: 'button', label: 'Botón' },
    { id: 'sw1', type: 'switch-slide', label: 'Interruptor' },
  ], [
    { part: 'pot1', boardPin: 'GPIO0', pin: 'wiper', mode: 'ANALOG' },
    { part: 'ldr1', boardPin: 'GPIO1', pin: 'a', mode: 'ANALOG', invert: true },
    { part: 'btn1', boardPin: 'GPIO4', pin: 'a1', mode: 'INPUT_PULLUP', activeLow: true },
    { part: 'sw1', boardPin: 'GPIO5', pin: 'com', mode: 'INPUT' },
  ]);

const INPUTS: Inputs = { digital: { 4: 0, 5: 1, 6: 1, 7: 0 }, analog: { 0: 1234, 1: 3000, 2: 4095, 3: 0 } };

function runInterpreter(program: ProgramIR, c: ProgramContext, inputs: Inputs): string {
  let out = '';
  const gpio = (pin: string) => Number(/^GPIO(\d+)$/.exec(pin)?.[1] ?? -1);
  const it = createInterpreter(program, c, {
    pinMode: () => {},
    digitalWrite: () => {},
    analogWrite: () => {},
    tone: () => {},
    noTone: () => {},
    servoWrite: () => {},
    onboardRgb: () => {},
    serial: (t) => {
      out += t;
    },
    digitalRead: (pin) => levelAt(inputs, gpio(pin), Math.floor(it.timeMs)) ?? inputs.digital?.[gpio(pin)] ?? 0,
    analogRead: (pin) => inputs.analog?.[gpio(pin)] ?? 0,
  });
  // Every loop() pass ends with delay(1000): stop in the middle of the last one.
  const until = (PASSES - 1) * 1000 + 500;
  let r = it.runUntil(0);
  for (let t = 50; t <= until && r.status !== 'error'; t += 50) {
    do r = it.runUntil(t);
    while (r.status === 'yield');
  }
  if (r.status === 'error') return `${out}<<error: ${r.error}>>`;
  return out;
}

function runCompiled(name: string, code: string, inputs: Inputs): string {
  const dir = join(BUILD, name);
  mkdirSync(dir, { recursive: true });
  const assigns = [
    ...Object.entries(inputs.digital ?? {}).map(([p, val]) => `cv_digital[${p}] = ${val};`),
    ...Object.entries(inputs.analog ?? {}).map(([p, val]) => `cv_analog[${p}] = ${val};`),
  ].join(' ');
  const windows = (inputs.windows ?? []).map(([p, a, b, l]) => `if (pin == ${p} && now >= ${a} && now < ${b}) return ${l};`).join(' ');
  const hook = `\nstatic int cv_windows(int pin, unsigned long now) { ${windows} return -1; }\n`;
  const main = `${hook}int main() { cv_digital_at = cv_windows; ${assigns} setup(); for (int i = 0; i < ${PASSES}; i++) loop(); fwrite(cv_out.data(), 1, cv_out.size(), stdout); return 0; }\n`;
  const src = join(dir, 'sketch.cpp');
  writeFileSync(src, `#include "Arduino.h"\n${code}${main}`);
  const bin = join(dir, 'sketch');
  execFileSync(CXX, ['-std=c++17', '-O1', '-w', '-I', MOCK_DIR, src, '-o', bin], { stdio: 'pipe' });
  return execFileSync(bin, { encoding: 'utf8', timeout: 10_000 });
}

/** Programs end every loop() pass with delay(1000) so both sides run exactly PASSES passes. */
function program(p: { variables?: ProgramIR['variables']; setup?: Stmt[]; loop?: Stmt[]; functions?: ProgramIR['functions'] }): ProgramIR {
  return ir({ ...p, loop: [...(p.loop ?? []), delay(1000)] });
}

const n = num;
const pr = (e: Expr, newline = true) => print(e, newline);
const fn = (f: MathFn, a: Expr): Expr => ({ k: 'math', fn: f, a });
const change = (name: string, d: Expr): Stmt => ({ k: 'change', var: name, delta: d });
const forLoop = (name: string, from: Expr, to: Expr, by: Expr, body: Stmt[]): Stmt => ({ k: 'for', var: name, from, to, by, body });
const repeat = (times: Expr, body: Stmt[]): Stmt => ({ k: 'repeat', times, body });
const iff = (cond: Expr, body: Stmt[], other?: Stmt[]): Stmt => ({ k: 'if', branches: [{ cond, body }], ...(other ? { else: other } : {}) });

const CASES: Record<string, ProgramIR> = {
  printing: program({
    setup: [
      pr(n(3)), pr(n(-3)), pr(n(3.14159)), pr(n(-0.001)), pr(n(2.675)), pr(n(0.125)), pr(n(1e9)), pr(n(3e9)), pr(n(1e10)), pr(n(-5e9)),
      pr(bool(true)), pr(bool(false)), pr(str('Hola "mundo"\t✓')), pr(str('sin salto'), false), pr(str('!')),
      pr(fn('sqrt', n(-1))), pr(bin('/', n(1), n(0))), pr(bin('%', n(5), n(0))), pr(fn('pow10', n(400))), pr(n(1e-7)), pr(n(-2.5)),
      pr(bin('==', n(1), n(1))), pr(bin('+', bool(true), bool(true))), pr({ k: 'neg', a: bool(true) }), pr({ k: 'not', a: n(5) }),
    ],
  }),
  arithmetic: program({
    variables: [{ name: 'x', type: 'number', init: 7 }, { name: 'y', type: 'number', init: -2.5 }],
    setup: [
      pr(bin('/', n(7), n(2))), pr(bin('/', v('x'), n(2))), pr(bin('/', v('x'), v('y'))), pr(bin('%', n(-7), n(3))), pr(bin('%', v('x'), n(2.5))),
      pr(bin('%', v('y'), v('x'))), pr(bin('*', n(30000), n(30000))), pr(bin('+', n(32767), n(1))), pr(bin('-', n(-32768), n(1))),
      pr(bin('*', n(100000), n(100000))), pr(bin('-', v('x'), { k: 'neg', a: v('y') })), pr({ k: 'neg', a: bin('-', v('x'), v('y')) }),
      pr({ k: 'map', value: v('x'), fromLow: n(0), fromHigh: n(10), toLow: n(0), toHigh: n(255) }),
      pr({ k: 'map', value: v('x'), fromLow: n(5), fromHigh: n(5), toLow: n(1), toHigh: n(2) }),
      pr({ k: 'constrain', value: v('x'), low: n(0), high: n(5) }), pr({ k: 'constrain', value: v('y'), low: n(0), high: n(5) }),
      pr({ k: 'constrain', value: n(3), low: n(0), high: n(5) }), pr({ k: 'constrain', value: n(3), low: n(4.5), high: n(5) }),
      pr(fn('round', n(2.5))), pr(fn('round', n(-2.5))), pr(fn('round', v('y'))), pr(fn('floor', v('y'))), pr(fn('ceil', v('y'))),
      pr(fn('abs', v('y'))), pr(fn('sqrt', n(2))), pr(fn('sin', n(30))), pr(fn('cos', n(60))), pr(fn('sin', n(90))), pr(fn('pow10', n(-2))),
      pr(bin('<', v('y'), v('x'))), pr(bin('>=', v('y'), v('x'))), pr(bin('!=', v('x'), n(7))), pr(bin('&&', v('x'), v('y'))),
      pr(bin('||', n(0), v('y'))), pr(bin('&&', n(0), v('y'))), pr(bin('==', bin('/', n(1), n(3)), bin('/', n(2), n(6)))),
      set('x', bin('*', bin('+', v('x'), n(1)), bin('-', v('y'), n(1)))), pr(v('x')),
    ],
  }),
  variablesAcrossPasses: program({
    variables: [{ name: 'contador', type: 'number', init: 1.5 }, { name: 'activo', type: 'boolean', init: true }, { name: 'nada', type: 'boolean' }],
    loop: [
      change('contador', n(1)), change('activo', n(1)), set('activo', { k: 'not', a: v('activo') }), set('nada', n(2.5)),
      pr(v('contador'), false), pr(str(' '), false), pr(v('activo'), false), pr(str(' '), false), pr(v('nada')),
      change('nada', n(-1)), pr(v('nada')), change('contador', n(-0.25)),
    ],
  }),
  forLoops: program({
    variables: [{ name: 'i', type: 'number' }, { name: 'a', type: 'number', init: 5 }, { name: 'b', type: 'number', init: 1 }, { name: 'paso', type: 'number', init: -2 }],
    setup: [
      forLoop('i', n(1), n(4), n(1), [pr(v('i'), false)]), pr(str('|')),
      forLoop('i', n(4), n(1), n(1), [pr(v('i'), false)]), pr(str('|')),
      forLoop('i', n(10), n(1), n(-3), [pr(v('i'), false)]), pr(str('|')),
      forLoop('i', n(0), n(1), n(0.25), [pr(v('i'), false)]), pr(str('|')),
      forLoop('i', v('a'), v('b'), v('paso'), [pr(v('i'), false)]), pr(str('|')),
      forLoop('i', v('b'), v('a'), v('paso'), [pr(v('i'), false), iff(bin('==', v('i'), n(3)), [set('a', n(100))])]), pr(str('|')),
      forLoop('i', n(1), n(10), n(1), [iff(bin('==', bin('%', v('i'), n(2)), n(0)), [{ k: 'continue' }]), iff(bin('>', v('i'), n(7)), [{ k: 'break' }]), pr(v('i'), false)]),
      pr(str('|')), pr(v('i')),
      forLoop('i', n(1), n(3), n(1), [set('i', bin('+', v('i'), n(1))), pr(v('i'), false)]), pr(str('|')),
      forLoop('i', n(3), n(3), n(1), [pr(v('i'), false)]), pr(str('|')),
    ],
  }),
  nestedFlow: program({
    variables: [{ name: 'i', type: 'number' }, { name: 'j', type: 'number' }, { name: 'n', type: 'number', init: 3 }, { name: 'total', type: 'number' }],
    setup: [
      forLoop('i', n(1), n(3), n(1), [
        forLoop('j', n(1), n(3), n(1), [iff(bin('==', v('j'), n(2)), [{ k: 'continue' }]), iff(bin('==', v('i'), n(2)), [{ k: 'break' }]), pr(bin('+', bin('*', v('i'), n(10)), v('j')), false), pr(str(','), false)]),
        pr(str(';'), false),
      ]),
      pr(str('')),
      repeat(v('n'), [change('n', n(1)), change('total', n(1)), repeat(n(2), [{ k: 'continue' }, change('total', n(100))]), repeat(n(5), [change('total', n(10)), { k: 'break' }])]),
      pr(v('total')), pr(v('n')),
      repeat(n(2.5), [change('total', n(1))]), pr(v('total')),
      repeat(n(-1), [change('total', n(1))]), pr(v('total')),
      { k: 'while', cond: bin('<', v('total'), n(50)), body: [change('total', n(7))] }, pr(v('total')),
      { k: 'while', cond: bin('>', v('total'), n(0)), until: true, body: [change('total', n(-7))] }, pr(v('total')),
      { k: 'while', cond: bool(true), body: [change('total', n(1)), iff(bin('>=', v('total'), n(60)), [{ k: 'break' }])] }, pr(v('total')),
      { k: 'if', branches: [{ cond: bin('<', v('total'), n(0)), body: [pr(str('a'))] }, { cond: bin('<', v('total'), n(100)), body: [pr(str('b'))] }], else: [pr(str('c'))] },
      { k: 'if', branches: [], else: [pr(str('solo si no'))] },
      { k: 'break' },
      pr(str('después del break')),
    ],
  }),
  functions: program({
    variables: [{ name: 'k', type: 'number', init: 4 }, { name: 'acc', type: 'number' }],
    setup: [{ k: 'call', name: 'cuenta atrás' }, pr(v('acc')), { k: 'call', name: 'saluda' }, { k: 'call', name: 'con bucle' }],
    functions: [
      { name: 'cuenta atrás', body: [iff(bin('>', v('k'), n(0)), [change('acc', v('k')), change('k', n(-1)), { k: 'call', name: 'cuenta atrás' }])] },
      { name: 'saluda', body: [pr(str('hola'), false), { k: 'break' }, pr(str(' mundo'))] },
      { name: 'con bucle', body: [repeat(n(3), [{ k: 'call', name: 'saluda' }, { k: 'continue' }])] },
    ],
  }),
  sensors: program({
    variables: [{ name: 'x', type: 'number' }],
    setup: [
      pr({ k: 'potPercent', part: 'pot1' }), pr({ k: 'lightPercent', part: 'ldr1' }), pr({ k: 'analogRaw', part: 'pot1' }),
      pr({ k: 'buttonPressed', part: 'btn1' }), pr({ k: 'switchOn', part: 'sw1' }), pr({ k: 'digitalRead', pin: 'GPIO6' }),
      pr({ k: 'analogRead', pin: 'GPIO2' }), pr({ k: 'analogRead', pin: 'GPIO3' }),
      set('x', bin('+', { k: 'potPercent', part: 'pot1' }, { k: 'buttonPressed', part: 'btn1' })), pr(v('x')),
      pr(bin('*', { k: 'analogRaw', part: 'pot1' }, { k: 'analogRaw', part: 'ldr1' })),
      pr(bin('-', { k: 'digitalRead', pin: 'GPIO7' }, n(1))),
      pr({ k: 'map', value: { k: 'analogRaw', part: 'pot1' }, fromLow: n(0), fromHigh: n(4095), toLow: n(0), toHigh: n(180) }),
      pr({ k: 'constrain', value: { k: 'analogRead', pin: 'GPIO2' }, low: n(0), high: n(1000) }),
    ],
  }),
  timing: program({
    variables: [{ name: 't', type: 'number' }],
    setup: [delay(250), delay(n(-5)), delay(n(10.9)), { k: 'waitUntil', cond: bool(true) }, set('t', bin('/', { k: 'millis' }, n(10))), pr(fn('round', v('t')))],
  }),
};

/** Seeded random expressions (no random/millis/buttonClicked: those cannot match across sides). */
function fuzzProgram(seed: number, count: number): ProgramIR {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const LITS = [0, 1, 2, 3, -1, -4, 0.5, 2.5, -0.75, 10, 100, 255, 1000, 32767, 40000, 1e6];
  const OPS: BinOp[] = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||'];
  const FNS: MathFn[] = ['abs', 'sqrt', 'round', 'floor', 'ceil', 'pow10'];
  const leaf = (): Expr =>
    pick<() => Expr>([
      () => n(pick(LITS)),
      () => v(pick(['x', 'y', 'z'])),
      () => v('f'),
      () => bool(rnd() < 0.5),
      () => ({ k: 'analogRead', pin: pick(['GPIO2', 'GPIO3']) }),
      () => ({ k: 'digitalRead', pin: pick(['GPIO6', 'GPIO7']) }),
      () => ({ k: 'potPercent', part: 'pot1' }),
      () => ({ k: 'buttonPressed', part: 'btn1' }),
    ])();
  const expr = (d: number): Expr => {
    if (d <= 0 || rnd() < 0.25) return leaf();
    const r = rnd();
    if (r < 0.55) return bin(pick(OPS), expr(d - 1), expr(d - 1));
    if (r < 0.65) return { k: 'not', a: expr(d - 1) };
    if (r < 0.75) return { k: 'neg', a: expr(d - 1) };
    if (r < 0.85) return fn(pick(FNS), expr(d - 1));
    if (r < 0.92) return { k: 'constrain', value: expr(d - 1), low: expr(d - 2), high: expr(d - 2) };
    return { k: 'map', value: expr(d - 1), fromLow: n(pick(LITS)), fromHigh: n(pick(LITS)), toLow: expr(d - 2), toHigh: n(pick(LITS)) };
  };
  const setup: Stmt[] = [];
  for (let i = 0; i < count; i++) {
    const e = expr(4);
    const r = rnd();
    // Keep variables bounded so values stay in the range where both sides print the same digits.
    if (r < 0.3) setup.push(set(pick(['x', 'y', 'z']), { k: 'constrain', value: e, low: n(-1e6), high: n(1e6) }));
    else if (r < 0.4) setup.push(set('f', e));
    else setup.push(pr(e, rnd() < 0.8));
  }
  return program({
    variables: [{ name: 'x', type: 'number', init: 3 }, { name: 'y', type: 'number', init: -1.5 }, { name: 'z', type: 'number' }, { name: 'f', type: 'boolean' }],
    setup,
  });
}

/**
 * Button on GPIO4 (INPUT_PULLUP, active low). The interpreter charges 0.01 ms
 * per statement (the mock: 0), so its clock drifts a few ms over the run:
 * windows are wide enough for the click count not to depend on that drift.
 */
const CLICKS: Inputs = {
  ...INPUTS,
  digital: { ...INPUTS.digital, 4: 1 }, // released (pull-up) outside the windows
  windows: [
    [4, 100, 300, 0], // long press → 1 click
    [4, 305, 320, 0], // bounce right after the release (< 30 ms since the last change) → ignored
    [4, 500, 515, 0], // short press of 15 ms → 1 click
    [4, 700, 900, 0], // press → 1 click…
    [4, 925, 1100, 0], // …released 25 ms, pressed again: 30 ms after the release → 1 more click
  ],
};

const clicksProgram = program({
  variables: [{ name: 'clics', type: 'number' }],
  setup: [
    repeat(n(150), [iff({ k: 'buttonClicked', part: 'btn1' }, [change('clics', n(1))]), delay(10)]),
    pr(v('clics')),
    { k: 'waitUntil', cond: bin('>', { k: 'millis' }, n(2100)) },
    pr(bin('>=', { k: 'millis' }, n(2100))),
  ],
});

describe.skipIf(!hasCompiler())('generated C++ and the interpreter print the same', () => {
  it('buttonClicked debounce and waitUntil with time-varying inputs', () => {
    const c = ctx();
    expect(runCompiled('clicks', generateCode(clicksProgram, c).code, CLICKS)).toBe(runInterpreter(clicksProgram, c, CLICKS));
  }, 60_000);

  for (const [name, p] of Object.entries(CASES)) {
    it(name, () => {
      const c = ctx();
      const res = generateCode(p, c);
      expect(runCompiled(name, res.code, INPUTS)).toBe(runInterpreter(p, c, INPUTS));
    }, 60_000);
  }

  it('random expressions (fixed seeds)', () => {
    const seeds = process.env.CV_FUZZ_SEEDS ? Array.from({ length: Number(process.env.CV_FUZZ_SEEDS) }, (_, i) => i + 1) : [1, 2, 3];
    for (const seed of seeds) {
      const p = fuzzProgram(seed, 150);
      const c = ctx();
      const lines = (s: string) => s.split('\n');
      const got = lines(runCompiled(`fuzz${seed}`, generateCode(p, c).code, INPUTS));
      const want = lines(runInterpreter(p, c, INPUTS));
      expect(got.length, `seed ${seed}`).toBe(want.length);
      got.forEach((line, i) => expect(line, `seed ${seed}, line ${i + 1}`).toBe(want[i]));
    }
  }, 120_000);
});
