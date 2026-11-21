/**
 * Regression tests for defects found in the codegen ↔ interpreter pipeline
 * (each one failed before its fix). The real compile check of the same cases
 * lives in arduino-compile.test.ts (corpus.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Expr, ProgramIR, Stmt } from '@/contracts';
import type { ProgramContext } from '../context';
import { createInterpreter, type Interpreter, type InterpreterHost } from '../interpreter';
import { generateCode, programChecks } from './index';
import { formatValue } from './shared';
import { bin, delay, ir, makeCtx, num, print, set, v } from './testkit';

const unoParts = () =>
  makeCtx('uno', [
    { id: 'bz1', type: 'buzzer', label: 'Zumbador 1' },
    { id: 'btn1', type: 'button', label: 'Botón 1' },
    { id: 'led1', type: 'led', label: 'LED 1' },
  ], [
    { part: 'bz1', boardPin: 'D8', pin: 'plus' },
    { part: 'btn1', boardPin: 'D2', pin: 'a1', mode: 'INPUT_PULLUP', activeLow: true },
    { part: 'led1', boardPin: 'D13' },
  ]);

function host(digital: Record<string, 0 | 1> = {}) {
  const events: Array<{ kind: string; pin?: string; value?: number | string }> = [];
  let serial = '';
  const h: InterpreterHost = {
    pinMode: () => {},
    digitalWrite: (pin, value) => events.push({ kind: 'dw', pin, value }),
    analogWrite: (pin, value) => events.push({ kind: 'aw', pin, value }),
    tone: (pin, value) => events.push({ kind: 'tone', pin, value }),
    noTone: (pin) => events.push({ kind: 'noTone', pin }),
    servoWrite: () => {},
    onboardRgb: () => {},
    serial: (t) => {
      serial += t;
    },
    digitalRead: (pin) => digital[pin] ?? 0,
    analogRead: () => 0,
  };
  return { h, events, get serial() { return serial; } };
}

function run(program: ProgramIR, ctx: ProgramContext, ms: number, digital?: Record<string, 0 | 1>) {
  const x = host(digital);
  const it: Interpreter = createInterpreter(program, ctx, x.h);
  let r = it.runUntil(0);
  for (let t = 16; t <= ms + 16 && r.status !== 'error'; t += 16) {
    do r = it.runUntil(Math.min(t, ms));
    while (r.status === 'yield');
  }
  return { ...x, result: r };
}

const loopLines = (code: string) => code.slice(code.indexOf('void loop()'));

describe('identifier collisions with the Arduino / C libraries', () => {
  it('renames variables that clash with libc / newlib functions (time, index, read, signal…)', () => {
    const names = ['time', 'index', 'read', 'write', 'select', 'signal', 'sleep', 'pause', 'clock', 'free', 'exit', 'abort', 'square', 'div', 'rand', 'y1', 'errno', 'assert'];
    const program = ir({ variables: names.map((name) => ({ name, type: 'number' as const })), loop: names.map((name) => ({ k: 'change', var: name, delta: num(1) }) as Stmt) });
    const code = generateCode(program, unoParts()).code;
    for (const n of names) {
      expect(code, n).not.toMatch(new RegExp(`^double ${n} = `, 'm'));
      expect(code, n).toMatch(new RegExp(`^double ${n}_2 = 0;`, 'm'));
    }
  });

  it('renames part constants that clash with core macros (DEFAULT, EXTERNAL, STATUS, OK, NAN…)', () => {
    const labels = ['Default', 'External', 'Internal', 'Status', 'Ok', 'Nan', 'Eof', 'Analog', 'Pullup', 'Signal', 'Fail'];
    const ctx = makeCtx('uno', labels.map((label, i) => ({ id: `led${i}`, type: 'led', label })), labels.map((_, i) => ({ part: `led${i}`, boardPin: `D${i + 2}` })));
    const code = generateCode(ir({ loop: labels.map((_, i) => ({ k: 'led', part: `led${i}`, on: { k: 'bool', v: true } }) as Stmt) }), ctx).code;
    for (const l of labels) {
      const c = l.toUpperCase();
      expect(code, c).not.toMatch(new RegExp(`const int ${c} = `));
      expect(code, c).toMatch(new RegExp(`const int ${c}_2 = `));
    }
  });

  it('terminates and stays unique for names whose numbered variants also look like macros', () => {
    const labels = ['ESP', 'ESP sensor', 'ESP sensor', 'Config', 'Soc x'];
    const ctx = makeCtx('esp32c6', labels.map((label, i) => ({ id: `led${i}`, type: 'led', label })), labels.map((_, i) => ({ part: `led${i}`, boardPin: `GPIO${i + 2}` })));
    const program = ir({
      variables: [{ name: 'ESP', type: 'number' }, { name: 'ESP_valor', type: 'number' }],
      loop: [...labels.map((_, i) => ({ k: 'led', part: `led${i}`, on: { k: 'bool', v: true } }) as Stmt), { k: 'change', var: 'ESP', delta: num(1) }, { k: 'change', var: 'ESP_valor', delta: num(1) }],
    });
    const code = generateCode(program, ctx).code;
    const consts = [...code.matchAll(/^const int (\w+) = /gm)].map((m) => m[1]);
    expect(consts).toEqual(['P_ESP', 'P_ESP_SENSOR', 'P_ESP_SENSOR_2', 'CONFIG', 'P_SOC_X']);
    expect(code).toMatch(/^double P_ESP_2 = 0;/m);
    expect(code).toMatch(/^double P_ESP_valor = 0;/m);
  });

  it('renames functions that clash with function-like macros (offsetof, assert, ISR…)', () => {
    const names = ['offsetof', 'assert', 'ISR', 'SIGNAL', 'sei', 'cli', 'PSTR'];
    const code = generateCode(ir({ loop: names.map((name) => ({ k: 'call', name }) as Stmt), functions: names.map((name) => ({ name, body: [] })) }), unoParts()).code;
    for (const n of names) expect(code, n).toMatch(new RegExp(`^void ${n}_2\\(\\);`, 'm'));
  });
});

describe('constrain() with side effects', () => {
  it('never puts random / buttonClicked inside the multi-evaluating constrain() macro', () => {
    const value: Expr = { k: 'random', min: num(0), max: num(200) };
    const clicked: Expr = { k: 'buttonClicked', part: 'btn1' };
    const program = ir({
      variables: [{ name: 'x', type: 'number' }],
      loop: [
        set('x', { k: 'constrain', value, low: num(50), high: num(150) }),
        set('x', { k: 'constrain', value: clicked, low: num(0), high: num(1) }),
        { k: 'servo', part: 'servo1', angle: { k: 'random', min: num(-90), max: num(270) } },
      ],
    });
    const ctx = makeCtx('uno', [{ id: 'btn1', type: 'button', label: 'Botón 1' }, { id: 'servo1', type: 'servo-sg90', label: 'Servo 1' }], [
      { part: 'btn1', boardPin: 'D2', mode: 'INPUT_PULLUP', activeLow: true },
      { part: 'servo1', boardPin: 'D9' },
    ]);
    const code = loopLines(generateCode(program, ctx).code);
    // Arduino's constrain(amt, low, high) evaluates `amt` up to three times: three random draws
    // can return a value outside [low, high], and a click is consumed by the first call.
    expect(code).not.toMatch(/\bconstrain\(random\(/);
    expect(code).not.toMatch(/\bconstrain\(clicked_/);
    expect(code).toContain('cv_constrain(random(0, 201), 50, 150)');
    // Pure arguments keep the familiar Arduino macro.
    const pure = generateCode(ir({ variables: [{ name: 'x', type: 'number' }], loop: [set('x', { k: 'constrain', value: v('x'), low: num(0), high: num(10) })] }), ctx).code;
    expect(pure).toContain('x = constrain(x, 0, 10);');
    expect(pure).not.toContain('cv_constrain');
  });
});

describe('tone() with a frequency below 1 Hz', () => {
  const freqProgram = (freq: Expr, ms?: Expr) =>
    ir({
      variables: [{ name: 'f', type: 'number' }],
      setup: [{ k: 'buzzerTone', part: 'bz1', freq: num(440) }, { k: 'buzzerTone', part: 'bz1', freq, ...(ms ? { ms } : {}) }],
      loop: [delay(1000)],
    });

  it('the interpreter silences the buzzer for 0 Hz…', () => {
    const { events } = run(freqProgram(num(0)), unoParts(), 10);
    expect(events.filter((e) => e.kind === 'tone' || e.kind === 'noTone')).toEqual([
      { kind: 'tone', pin: 'D8', value: 440 },
      { kind: 'noTone', pin: 'D8' },
    ]);
  });

  it('…and so does the generated code (tone(pin, 0) divides by zero on the AVR core)', () => {
    const setupCode = generateCode(freqProgram(num(0)), unoParts()).code;
    expect(setupCode).not.toMatch(/tone\(ZUMBADOR_1, 0\)/);
    expect(setupCode).toMatch(/noTone\(ZUMBADOR_1\);/);
    const neg = generateCode(freqProgram(num(-3), num(100)), unoParts()).code;
    expect(neg).not.toMatch(/tone\(ZUMBADOR_1, -3/);
    // A computed frequency goes through a helper that calls noTone() below 1 Hz.
    const dyn = generateCode(freqProgram(bin('-', v('f'), num(10))), unoParts()).code;
    expect(dyn).toMatch(/cv_tone\(ZUMBADOR_1, f - 10, 0\);/);
    expect(dyn).toMatch(/void cv_tone\(int pin, double hz, unsigned long ms\) \{/);
    expect(dyn).toMatch(/if \(hz >= 1\) tone\(pin, \(unsigned int\) hz, ms\);\s+else noTone\(pin\);/);
    const generic = generateCode(ir({ setup: [{ k: 'tone', pin: 'D7', freq: num(0.5) }] }), unoParts()).code;
    expect(generic).toMatch(/noTone\(7\);/);
    expect(generic).not.toMatch(/\btone\(7, 0.5\)/);
  });
});

describe('repeat N times evaluates N once (Scratch / Blockly semantics)', () => {
  const dice = (times: Expr) =>
    ir({
      variables: [{ name: 'n', type: 'number', init: 3 }, { name: 'veces', type: 'number' }],
      setup: [{ k: 'repeat', times, body: [{ k: 'change', var: 'veces', delta: num(1) }, { k: 'change', var: 'n', delta: num(1) }] }, print(v('veces'))],
      loop: [delay(1000)],
    });

  it('interpreter: changing the count inside the body does not change the number of turns', () => {
    const { serial, result } = run(dice(v('n')), unoParts(), 50);
    expect(result.status).not.toBe('error');
    expect(serial).toBe('3\n');
  });

  it('codegen: the count is computed once before the loop', () => {
    const code = generateCode(dice(v('n')), unoParts()).code;
    expect(code).not.toMatch(/for \(int i = 0; i < n; i\+\+\)/);
    expect(code).toMatch(/double iVeces = n;/);
    expect(code).toMatch(/for \(long i = 0; i < iVeces; i\+\+\) \{/);
    // Literal counts keep the simple form; big ones use a long counter (int is 16-bit on the Uno).
    const lit = generateCode(ir({ loop: [{ k: 'repeat', times: num(10), body: [] }, { k: 'repeat', times: num(40000), body: [] }] }), unoParts()).code;
    expect(lit).toContain('for (int i = 0; i < 10; i++) {');
    expect(lit).toContain('for (long i = 0; i < 40000; i++) {');
  });

  it('a random count is drawn once per repeat block', () => {
    const counts = new Map<number, number>();
    const program = ir({
      variables: [{ name: 'veces', type: 'number' }],
      loop: [set('veces', num(0)), { k: 'repeat', times: { k: 'random', min: num(1), max: num(6) }, body: [{ k: 'change', var: 'veces', delta: num(1) }] }, print(v('veces')), delay(1)],
    });
    const { serial } = run(program, unoParts(), 3000);
    for (const line of serial.trim().split('\n')) counts.set(Number(line), (counts.get(Number(line)) ?? 0) + 1);
    // Re-evaluating random(1, 6) on every turn makes 1–2 turns far more likely than 5–6.
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    for (let k = 1; k <= 6; k++) expect((counts.get(k) ?? 0) / total, `count ${k}`).toBeGreaterThan(0.1);
  });
});

describe('Serial printing', () => {
  it('prints "ovf" for numbers beyond ±4294967040 like Arduino Print::printFloat', () => {
    expect(formatValue(1e10)).toBe('ovf');
    expect(formatValue(-5e9)).toBe('ovf');
    expect(formatValue(3e9)).toBe('3000000000.00');
    expect(formatValue(4294967040)).toBe('4294967040.00');
  });

  it('formats decimals with the same digit-by-digit algorithm as Print::printFloat (0.375 → "0.37")', () => {
    // printFloat adds 0.005 and then extracts digits with *10 / truncation: 0.38 * 10 = 3.7999… → "0.37",
    // while Number.prototype.toFixed rounds the exact decimal value ("0.38").
    expect(formatValue(0.375)).toBe('0.37');
    expect(formatValue(10.375)).toBe('10.38');
    expect(formatValue(0.125)).toBe('0.13');
    expect(formatValue(-0.375)).toBe('-0.37');
    expect(formatValue(-0.001)).toBe('-0.00');
    expect(formatValue(2.675)).toBe('2.67');
    expect(formatValue(3.14159)).toBe('3.14');
  });

  it('cvPrint checks the magnitude before casting to long (out-of-range casts are undefined behaviour)', () => {
    const code = generateCode(ir({ loop: [print(v('x'))], variables: [{ name: 'x', type: 'number' }] }), unoParts()).code;
    expect(code).toContain('if (fabs(value) < 2000000000.0 && value == (long) value) Serial.print((long) value);');
  });
});

describe('static types', () => {
  it('constrain() of millis() never mixes unsigned and signed arithmetic', () => {
    const neg = { k: 'neg', a: { k: 'constrain', value: { k: 'millis' }, low: num(0), high: num(1000) } } as Expr;
    const low = { k: 'constrain', value: { k: 'millis' }, low: num(-5), high: num(10) } as Expr;
    const program = ir({ variables: [{ name: 'x', type: 'number' }], loop: [set('x', neg), set('x', low)] });
    const code = generateCode(program, unoParts()).code;
    // -(unsigned long) wraps around to 4294966296 instead of -1000, and `millis() < -5`
    // compares as unsigned (always true) so the macro would return (unsigned long) -5.
    expect(code).not.toContain('x = -constrain(millis(), 0, 1000);');
    expect(code).not.toMatch(/[^_]constrain\(millis\(\), -5, 10\)/);
    expect(code).toContain('x = -cv_constrain(millis(), 0, 1000);');
    expect(code).toContain('x = cv_constrain(millis(), -5, 10);');
  });
});

describe('comments built from user text', () => {
  it('raw IR names / pins never break out of a // comment', () => {
    const program = ir({ loop: [{ k: 'call', name: 'a\nint roto = ;' }, { k: 'digitalWrite', pin: 'X\nint roto2 = ;', value: num(1) }, set('y', { k: 'analogRead', pin: 'Q\nint roto3 = ;' })] });
    const code = generateCode(program, unoParts()).code;
    expect(code).not.toMatch(/^int roto/m);
    expect(code).not.toMatch(/^\s*int roto/m);
  });

  it('a blank part label falls back to the part id in messages', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: '   ' }], [{ part: 'led1', boardPin: null }]);
    const res = generateCode(ir({ loop: [{ k: 'led', part: 'led1', on: { k: 'bool', v: true } }] }), ctx);
    expect(res.warnings[0].message).toContain('«led1»');
    expect(res.code).not.toContain('«»');
  });
});

describe('Spanish texts name the blocks as the editor shows them', () => {
  it('uses the real block labels («repetir para siempre», «configurar pin», «continuar con la siguiente vuelta»)', () => {
    const empty = generateCode(ir({ setup: [delay(1)] }), unoParts()).code;
    expect(empty).toContain('// Agrega bloques en «repetir para siempre»');
    const res = generateCode(ir({ loop: [{ k: 'digitalWrite', pin: 'D7', value: num(1) }, { k: 'continue' }] }), unoParts());
    const texts = res.warnings.map((w) => w.message).join('\n');
    expect(texts).toContain('ningún bloque «configurar pin» lo configura');
    expect(texts).toContain('«continuar con la siguiente vuelta» solo funciona dentro de un bucle');
  });
});

describe('ESP32-C6 LEDC channels (BoardProfile.maxPwmChannels = 6)', () => {
  const parts = [
    { id: 'rgb1', type: 'led-rgb', label: 'RGB A' },
    { id: 'rgb2', type: 'led-rgb', label: 'RGB B' },
    { id: 'servo1', type: 'servo-sg90', label: 'Servo 1' },
  ];
  const bindings = [
    ...['r', 'g', 'b'].map((ch, i) => ({ part: 'rgb1', boardPin: `GPIO${18 + i}`, channel: ch, pin: ch })),
    ...['r', 'g', 'b'].map((ch, i) => ({ part: 'rgb2', boardPin: `GPIO${21 + i}`, channel: ch, pin: ch })),
    { part: 'servo1', boardPin: 'GPIO2', pin: 'signal' },
  ];
  const rgb = (part: string): Stmt => ({ k: 'rgb', part, r: num(255), g: num(0), b: num(0) });

  it('warns when analogWrite + servos + tones need more channels than the chip has', () => {
    // On the real board the 7th ledcAttach fails ("No more LEDC channels available!") and that
    // output silently stays off, while the simulator would show it working.
    const ctx = makeCtx('esp32c6', parts, bindings);
    const issues = programChecks(ir({ loop: [rgb('rgb1'), rgb('rgb2'), { k: 'servo', part: 'servo1', angle: num(90) }] }), ctx);
    const issue = issues.find((i) => i.code === 'timer-conflict');
    expect(issue).toBeDefined();
    expect(issue!.title).toContain('6');
    expect(issue!.message).toContain('7');
    expect(issue!.parts).toEqual(['rgb1', 'rgb2', 'servo1']);
    // Six channels are fine.
    expect(programChecks(ir({ loop: [rgb('rgb1'), rgb('rgb2')] }), ctx).filter((i) => i.code === 'timer-conflict')).toEqual([]);
  });

  it('the interpreter runs out of channels like the chip: the 7th PWM output does nothing', () => {
    const ctx = makeCtx('esp32c6', parts, bindings);
    const program = ir({ setup: [{ k: 'servo', part: 'servo1', angle: num(10) }, rgb('rgb1'), rgb('rgb2')], loop: [delay(1000)] });
    const { events } = run(program, ctx, 10);
    const pwmPins = [...new Set(events.filter((e) => e.kind === 'aw' || e.kind === 'dw').map((e) => e.pin))];
    // Servo (GPIO2) + RGB A (GPIO18-20) + R and G of RGB B (GPIO21-22) = 6; GPIO23 gets no channel.
    expect(pwmPins).toEqual(['GPIO18', 'GPIO19', 'GPIO20', 'GPIO21', 'GPIO22']);
    // A sounding tone holds a channel; noTone() frees it (ledcDetach), so a later PWM write can take it.
    const freed = ir({
      setup: [rgb('rgb1'), { k: 'tone', pin: 'GPIO4', freq: num(440) }, rgb('rgb2'), { k: 'noTone', pin: 'GPIO4' }, set('x', num(1)), rgb('rgb2')],
      loop: [delay(1000)],
    });
    const after = run(freed, makeCtx('esp32c6', parts, bindings), 10).events;
    const writes23 = after.map((e, i) => ({ ...e, i })).filter((e) => e.kind === 'aw' && e.pin === 'GPIO23');
    const noTone = after.findIndex((e) => e.kind === 'noTone');
    expect(writes23.length).toBe(1);
    expect(writes23[0].i).toBeGreaterThan(noTone);
  });
});
