import { describe, expect, it } from 'vitest';
import type { ProgramIR, Stmt } from '@/contracts';
import type { ProgramContext } from '../context';
import { kitchenSink } from '../codegen/fixtures';
import { bin, bool, delay, ir, led, makeCtx, num, print, set, str, v } from '../codegen/testkit';
import { createInterpreter, type Interpreter, type InterpreterHost } from './index';

interface Ev {
  t: number;
  kind: string;
  pin?: string;
  value?: number | string;
}

function fakeHost(inputs: { digital?: Record<string, 0 | 1>; analog?: Record<string, number> } = {}) {
  const events: Ev[] = [];
  const ref: { it: Interpreter | null } = { it: null };
  const t = () => ref.it?.timeMs ?? 0;
  const blocks: string[] = [];
  let serial = '';
  const host: InterpreterHost = {
    pinMode: (pin, mode) => events.push({ t: t(), kind: 'pinMode', pin, value: mode }),
    digitalWrite: (pin, level) => events.push({ t: t(), kind: 'dw', pin, value: level }),
    analogWrite: (pin, value) => events.push({ t: t(), kind: 'aw', pin, value }),
    tone: (pin, f) => events.push({ t: t(), kind: 'tone', pin, value: f }),
    noTone: (pin) => events.push({ t: t(), kind: 'noTone', pin }),
    servoWrite: (part, angle) => events.push({ t: t(), kind: 'servo', pin: part, value: angle }),
    onboardRgb: (r, g, b) => events.push({ t: t(), kind: 'rgb', value: `${r},${g},${b}` }),
    serial: (text) => {
      serial += text;
    },
    digitalRead: (pin) => inputs.digital?.[pin] ?? 0,
    analogRead: (pin) => inputs.analog?.[pin] ?? 0,
    onBlock: (id) => blocks.push(id),
  };
  return { host, events, ref, blocks, inputs, get serial() { return serial; } };
}

function start(program: ProgramIR, ctx: ProgramContext, inputs?: Parameters<typeof fakeHost>[0]) {
  const h = fakeHost(inputs);
  const it = createInterpreter(program, ctx, h.host);
  h.ref.it = it;
  return { it, h };
}

/** Drive like the sim runtime: 16 ms frames until `ms`, re-calling on 'yield'. */
function runFor(it: Interpreter, ms: number, frame = 16) {
  let last = it.runUntil(0);
  for (let t = frame; t <= ms + frame; t += frame) {
    const target = Math.min(t, ms);
    do last = it.runUntil(target);
    while (last.status === 'yield');
    if (last.status === 'error' || last.status === 'done') break;
  }
  return last;
}

const unoLed = () => makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: 'D13' }]);
const noParts = () => makeCtx('uno', [], []);
const loopOnce = (stmts: Stmt[]) => ir({ setup: stmts, loop: [delay(1_000_000)] });

describe('interpreter', () => {
  it('blink toggles exactly at 500 ms boundaries over 3 s', () => {
    const { it, h } = start(ir({ loop: [led('led1', true, 'on'), delay(500), led('led1', false, 'off'), delay(500)] }), unoLed());
    const r = runFor(it, 3001);
    expect(r.status).toBe('waiting');
    const writes = h.events.filter((e) => e.kind === 'dw' && e.pin === 'D13');
    // millis() resolution: each toggle lands on its 500 ms boundary (+0.01 ms per statement).
    expect(writes.map((w) => Math.floor(w.t))).toEqual([0, 500, 1000, 1500, 2000, 2500, 3000]);
    expect(writes.every((w, i) => w.t - i * 500 < 0.1)).toBe(true);
    expect(writes.map((w) => w.value)).toEqual([1, 0, 1, 0, 1, 0, 1]);
    expect(h.events[0]).toMatchObject({ kind: 'pinMode', pin: 'D13', value: 'OUTPUT' });
    expect(h.blocks.slice(0, 2)).toEqual(['on', 'off']);
  });

  it('waits in delay and reports the wake time', () => {
    const { it } = start(ir({ loop: [led('led1', true), delay(500), led('led1', false), delay(500)] }), unoLed());
    const r = it.runUntil(100);
    expect(r.status).toBe('waiting');
    expect(r.nextWakeMs).toBeCloseTo(500.01, 5);
    expect(it.timeMs).toBe(100);
  });

  it('for loops count up and down (literal and variable bounds)', () => {
    const program = loopOnce([
      { k: 'for', var: 'i', from: num(1), to: num(3), by: num(1), body: [print(v('i'))] },
      { k: 'for', var: 'i', from: num(10), to: num(2), by: num(2), body: [print(v('i'))] },
      set('hasta', num(-1)),
      { k: 'for', var: 'i', from: num(1), to: v('hasta'), by: num(-1), body: [print(v('i'), false)] },
    ]);
    const { it, h } = start(program, noParts());
    it.runUntil(10);
    expect(h.serial).toBe('1\n2\n3\n10\n8\n6\n4\n2\n10-1');
  });

  it('real division, fmod and safe division (numeric model)', () => {
    const program = loopOnce([
      print(bin('/', num(7), num(2))),
      print(bin('/', num(6), num(3))),
      print(bin('/', num(1), num(0))),
      print(bin('%', num(7), num(3))),
      print(bin('%', num(-7), num(3))),
      print(bin('%', num(5.5), num(2))),
      print(bin('%', num(5), num(0))),
      print(bin('/', num(1), num(3))),
      print(bin('>', num(2), num(1))),
      print(str('fin')),
    ]);
    const { it, h } = start(program, noParts());
    it.runUntil(10);
    expect(h.serial).toBe('3.50\n2\n0\n1\n-1\n1.50\n0\n0.33\nverdadero\nfin\n');
  });

  it('button read honours activeLow', () => {
    const ctx = makeCtx('uno', [{ id: 'btn1', type: 'button', label: 'Botón 1' }, { id: 'led1', type: 'led', label: 'LED 1' }], [
      { part: 'btn1', boardPin: 'D2', mode: 'INPUT_PULLUP', activeLow: true, pin: 'a1' },
      { part: 'led1', boardPin: 'D13' },
    ]);
    const program = ir({ loop: [led('led1', { k: 'buttonPressed', part: 'btn1' }), delay(10)] });
    const { it, h } = start(program, ctx, { digital: { D2: 1 } });
    it.runUntil(5);
    expect(h.events.find((e) => e.kind === 'pinMode' && e.pin === 'D2')?.value).toBe('INPUT_PULLUP');
    expect(h.events.filter((e) => e.kind === 'dw').at(-1)?.value).toBe(0);
    h.inputs.digital!.D2 = 0; // pressed: pin pulled LOW
    it.runUntil(15);
    expect(h.events.filter((e) => e.kind === 'dw').at(-1)?.value).toBe(1);
  });

  it('sinking LED (activeLow output) writes LOW to turn on', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: 'D9', activeLow: true, pin: 'cathode' }]);
    const program = loopOnce([led('led1', true), { k: 'ledBrightness', part: 'led1', percent: num(25) }]);
    const { it, h } = start(program, ctx);
    it.runUntil(1);
    expect(h.events.filter((e) => e.kind === 'dw' || e.kind === 'aw').map((e) => [e.kind, e.value])).toEqual([['dw', 0], ['aw', 191]]);
  });

  it('nested repeat + break', () => {
    const program = loopOnce([
      {
        k: 'repeat',
        times: num(3),
        body: [
          {
            k: 'repeat',
            times: num(5),
            body: [
              { k: 'change', var: 'n', delta: num(1) },
              { k: 'if', branches: [{ cond: bin('>=', bin('%', v('n'), num(4)), num(2)), body: [{ k: 'break' }] }] },
            ],
          },
          { k: 'change', var: 'outer', delta: num(1) },
        ],
      },
      print(v('n')),
      print(v('outer')),
    ]);
    const { it, h } = start(program, noParts());
    it.runUntil(5);
    // n: 1,2(break) | 3(break) | 4,5,6(break) → n = 6, outer = 3
    expect(h.serial).toBe('6\n3\n');
  });

  it('functions and calls (with nested calls)', () => {
    const program = ir({
      functions: [
        { name: 'sumar', body: [{ k: 'change', var: 'total', delta: num(2) }, { k: 'call', name: 'mostrar' }] },
        { name: 'mostrar', body: [print(v('total'))] },
      ],
      loop: [{ k: 'call', name: 'sumar' }, delay(100)],
    });
    const { it, h } = start(program, noParts());
    runFor(it, 250);
    expect(h.serial).toBe('2\n4\n6\n');
  });

  it('delay inside an if suspends and resumes correctly', () => {
    const program = ir({
      setup: [{ k: 'if', branches: [{ cond: bool(true), body: [print(str('a')), delay(100), print({ k: 'millis' })] }] }, print(str('fin'))],
      loop: [delay(1000)],
    });
    const { it, h } = start(program, noParts());
    expect(it.runUntil(50).status).toBe('waiting');
    expect(h.serial).toBe('a\n');
    it.runUntil(150);
    expect(h.serial).toBe('a\n100\nfin\n');
  });

  it('busy loop without delay still advances time and returns', () => {
    const program = ir({ loop: [{ k: 'change', var: 'x', delta: num(1) }] });
    const { it, h } = start(program, noParts());
    const r = it.runUntil(10);
    expect(r.status).toBe('waiting');
    expect(it.timeMs).toBeGreaterThanOrEqual(10);
    // A huge target is cut by the statement budget: 'yield' well before reaching it.
    const big = it.runUntil(1e7);
    expect(big.status).toBe('yield');
    expect(it.timeMs).toBeLessThan(1e7);
    expect(big.nextWakeMs).toBe(it.timeMs);
    void h;
  });

  it('empty loop passes cost at least 0.1 ms', () => {
    const { it } = start(ir({ setup: [print(str('x'))] }), noParts());
    const r = it.runUntil(5);
    expect(r.status).toBe('waiting');
    expect(it.timeMs).toBeGreaterThanOrEqual(5);
  });

  it('empty program is done', () => {
    const { it } = start(ir({}), noParts());
    expect(it.runUntil(100).status).toBe('done');
  });

  it('tone with duration schedules its own noTone in virtual time', () => {
    const ctx = makeCtx('uno', [{ id: 'bz1', type: 'buzzer', label: 'Zumbador 1' }], [{ part: 'bz1', boardPin: 'D8', pin: 'plus' }]);
    const program = ir({ setup: [{ k: 'buzzerTone', part: 'bz1', freq: num(440.7), ms: num(200) }], loop: [delay(1000)] });
    const { it, h } = start(program, ctx);
    const r = it.runUntil(50);
    expect(r.nextWakeMs).toBeCloseTo(200, 1);
    expect(h.events.filter((e) => e.kind === 'tone')).toEqual([{ t: 0, kind: 'tone', pin: 'D8', value: 440 }]);
    expect(h.events.some((e) => e.kind === 'noTone')).toBe(false);
    it.runUntil(250);
    expect(h.events.filter((e) => e.kind === 'noTone')).toHaveLength(1);
  });

  it('Uno plays only one tone at a time', () => {
    const program = loopOnce([
      { k: 'tone', pin: 'D8', freq: num(440) },
      { k: 'tone', pin: 'D7', freq: num(880) },
      { k: 'noTone', pin: 'D8' },
      { k: 'tone', pin: 'D7', freq: num(880) },
    ]);
    const { it, h } = start(program, noParts());
    it.runUntil(1);
    expect(h.events.filter((e) => e.kind === 'tone').map((e) => e.pin)).toEqual(['D8', 'D7']);
  });

  it('buttonClicked fires once per press with debounce', () => {
    const ctx = makeCtx('uno', [{ id: 'btn1', type: 'button', label: 'Botón 1' }], [{ part: 'btn1', boardPin: 'D2', mode: 'INPUT_PULLUP', activeLow: true }]);
    const program = ir({
      loop: [{ k: 'if', branches: [{ cond: { k: 'buttonClicked', part: 'btn1' }, body: [{ k: 'change', var: 'clics', delta: num(1) }, print(v('clics'))] }] }],
    });
    const { it, h } = start(program, ctx, { digital: { D2: 1 } });
    it.runUntil(100);
    h.inputs.digital!.D2 = 0; // press
    it.runUntil(105);
    h.inputs.digital!.D2 = 1; // bounce (released within 30 ms → ignored)
    it.runUntil(110);
    h.inputs.digital!.D2 = 0;
    it.runUntil(300); // still held
    h.inputs.digital!.D2 = 1; // release
    it.runUntil(400);
    h.inputs.digital!.D2 = 0; // second press
    it.runUntil(500);
    expect(h.serial).toBe('1\n2\n');
  });

  it('potentiometer / LDR percent with invert, analogRaw', () => {
    const ctx = makeCtx('uno', [{ id: 'pot1', type: 'potentiometer', label: 'Pot' }, { id: 'ldr1', type: 'ldr', label: 'LDR' }], [
      { part: 'pot1', boardPin: 'A0', mode: 'ANALOG' },
      { part: 'ldr1', boardPin: 'A1', mode: 'ANALOG', invert: true },
    ]);
    const program = loopOnce([print({ k: 'potPercent', part: 'pot1' }), print({ k: 'lightPercent', part: 'ldr1' }), print({ k: 'analogRaw', part: 'pot1' })]);
    const { it, h } = start(program, ctx, { analog: { A0: 512, A1: 1023 } });
    it.runUntil(1);
    expect(h.serial).toBe('50\n0\n512\n');
    expect(h.events.some((e) => e.kind === 'pinMode')).toBe(false);
  });

  it('analogWrite on non-PWM pins and on pins disabled by the servo timer uses the 128 threshold', () => {
    const ctx = makeCtx('uno', [{ id: 's1', type: 'servo-sg90', label: 'Servo' }, { id: 'led1', type: 'led', label: 'LED' }], [
      { part: 's1', boardPin: 'D3', pin: 'signal' },
      { part: 'led1', boardPin: 'D10' },
    ]);
    const program = loopOnce([
      { k: 'analogWrite', pin: 'D7', value: num(200) },
      { k: 'analogWrite', pin: 'D6', value: num(100.6) },
      { k: 'ledBrightness', part: 'led1', percent: num(40) },
      { k: 'servo', part: 's1', angle: num(250) },
    ]);
    const { it, h } = start(program, ctx);
    it.runUntil(1);
    const out = h.events.filter((e) => ['dw', 'aw', 'servo'].includes(e.kind)).map((e) => `${e.kind}:${e.pin}=${e.value}`);
    expect(out).toEqual(['servo:s1=90', 'dw:D7=1', 'aw:D6=101', 'dw:D10=0', 'servo:s1=180']);
  });

  it('ESP32-C6 onboard LED and RGB', () => {
    const ctx = makeCtx('esp32c6', [], []);
    const program = loopOnce([{ k: 'onboardLed', on: bool(true) }, { k: 'onboardRgb', r: num(300), g: num(-5), b: num(127.5) }]);
    const { it, h } = start(program, ctx);
    it.runUntil(1);
    expect(h.events.filter((e) => e.kind === 'rgb').map((e) => e.value)).toEqual(['255,255,255', '255,0,128']);
  });

  it('ESP32: digital writes on PWM pins are simulated as analogWrite 0/255 (like the generated code)', () => {
    const ctx = makeCtx('esp32c6', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: 'GPIO4' }]);
    const program = loopOnce([led('led1', true), { k: 'ledBrightness', part: 'led1', percent: num(50) }, led('led1', false)]);
    const { it, h } = start(program, ctx);
    it.runUntil(1);
    expect(h.events.filter((e) => e.kind === 'dw' || e.kind === 'aw').map((e) => `${e.kind}=${e.value}`)).toEqual(['aw=255', 'aw=128', 'aw=0']);
  });

  it('Uno onboard LED drives D13; onboardRgb is ignored', () => {
    const program = loopOnce([{ k: 'onboardLed', on: num(1) }, { k: 'onboardRgb', r: num(1), g: num(1), b: num(1) }]);
    const { it, h } = start(program, noParts());
    it.runUntil(1);
    expect(h.events.map((e) => `${e.kind}:${e.pin}=${e.value}`)).toEqual(['pinMode:D13=OUTPUT', 'dw:D13=1']);
  });

  it('waitUntil polls every millisecond', () => {
    const ctx = makeCtx('uno', [{ id: 'btn1', type: 'button', label: 'B' }], [{ part: 'btn1', boardPin: 'D2', mode: 'INPUT_PULLUP', activeLow: true }]);
    const program = loopOnce([{ k: 'waitUntil', cond: { k: 'buttonPressed', part: 'btn1' } }, print({ k: 'millis' })]);
    const { it, h } = start(program, ctx, { digital: { D2: 1 } });
    expect(it.runUntil(20).status).toBe('waiting');
    h.inputs.digital!.D2 = 0;
    it.runUntil(40);
    expect(h.serial).toBe('20\n');
  });

  it('random is deterministic and inside [min, max]', () => {
    const program = ir({ loop: [print({ k: 'random', min: num(1), max: num(6) }), delay(1)] });
    const a = start(program, noParts());
    const b = start(program, noParts());
    runFor(a.it, 200);
    runFor(b.it, 200);
    const nums = a.h.serial.trim().split('\n').map(Number);
    expect(a.h.serial).toBe(b.h.serial);
    expect(nums.length).toBeGreaterThan(100);
    expect(nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 6)).toBe(true);
    expect(new Set(nums).size).toBe(6);
  });

  it('runtime errors: unknown function and runaway recursion', () => {
    const unknown = start(ir({ loop: [{ k: 'call', name: 'fantasma' }] }), noParts());
    const r = unknown.it.runUntil(10);
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/fantasma/);
    expect(unknown.it.runUntil(20).status).toBe('error');

    const rec = start(ir({ functions: [{ name: 'f', body: [{ k: 'call', name: 'f' }] }], loop: [{ k: 'call', name: 'f' }] }), noParts());
    expect(rec.it.runUntil(10).status).toBe('error');
  });

  it('reset restarts time, variables and setup', () => {
    const program = ir({ variables: [{ name: 'n', type: 'number', init: 5 }], setup: [print(v('n'))], loop: [{ k: 'change', var: 'n', delta: num(1) }, delay(10)] });
    const { it, h } = start(program, noParts());
    runFor(it, 100);
    it.reset();
    expect(it.timeMs).toBe(0);
    it.runUntil(1);
    expect(h.serial).toBe('5\n5\n');
  });

  it('booleans: storage coercion and printing', () => {
    const program = loopOnce([
      set('b', num(2)),
      print(v('b')),
      { k: 'change', var: 'b', delta: num(-1) },
      print(v('b')),
    ]);
    const ctxIr = { ...program, variables: [{ name: 'b', type: 'boolean' as const }] };
    const { it, h } = start(ctxIr, noParts());
    it.runUntil(1);
    expect(h.serial).toBe('verdadero\nfalso\n');
  });
});


describe('interpreter smoke run of the kitchen-sink program', () => {
  for (const board of ['uno', 'esp32c6'] as const) {
    it(`runs 2 s on ${board} without runtime errors`, () => {
      const { ir: program, ctx } = kitchenSink(board, true);
      const { it: interp, h } = start(program, ctx, { analog: { A0: 700, A1: 200, GPIO0: 3000, GPIO1: 100 } });
      const r = runFor(interp, 2000);
      expect(r.status).not.toBe('error');
      expect(h.serial.startsWith('Hola "mundo"\n\t??(fin)\n')).toBe(true);
      expect(interp.timeMs).toBeGreaterThan(0);
    });
  }
});
