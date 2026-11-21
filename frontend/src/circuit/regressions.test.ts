/**
 * Regression tests from the adversarial bug hunt (each one failed before its fix).
 */
import { describe, expect, it } from 'vitest';
import type { CircuitInputs, CircuitResult, PinDrive, ProjectModel } from '@/contracts';
import { buildExampleStrict } from '@/examples';
import { buildNetlist, deriveBindings, idleInputs, runChecks, solveCircuit } from './index';
import { BB, UNO, holePos, makeProject, part, placeBy } from './fixtures';
import { getTopology } from './topology';

const solve = (p: ProjectModel, inputs: Partial<CircuitInputs> = {}) => {
  const nl = buildNetlist(p);
  const result = solveCircuit(p, nl, { ...idleInputs(), ...inputs });
  return { nl, result, issues: runChecks(p, nl, result), bindings: deriveBindings(p, nl) };
};
const out = (level: 0 | 1, extra: Partial<PinDrive> = {}): PinDrive => ({ mode: 'output', level, ...extra });

/** Worst |Σ currents| over solver nodes (pin currents of legs/board pins + wire currents leaving the node). */
function kclError(p: ProjectModel, r: CircuitResult): number {
  const topo = getTopology(p);
  let worst = 0;
  for (let g = 0; g < topo.nodeCount; g++) {
    let s = 0;
    for (const idx of topo.nodePins[g]) {
      const pin = topo.pins[idx];
      if (!pin.hole) s += r.pinCurrents[pin.ref] ?? 0;
    }
    for (const w of topo.wires) {
      if (w.from < 0 || w.to < 0) continue;
      const i = r.wireCurrents[w.wire.id] ?? 0;
      if (topo.node[w.from] === g) s += i;
      if (topo.node[w.to] === g) s -= i;
    }
    worst = Math.max(worst, Math.abs(s));
  }
  return worst;
}

const EXAMPLE_IDS = ['battery-led', 'blink-uno', 'traffic-light-uno', 'button-led-uno', 'servo-pot-uno', 'motor-transistor-uno', 'rgb-esp32c6'];

/** Inputs the example programs produce while running (their "ON" phase). */
const RUNNING: Record<string, Partial<CircuitInputs>> = {
  'blink-uno': { drives: { D13: out(1) } },
  'traffic-light-uno': { drives: { D13: out(1), D12: out(0), D11: out(0) } },
  'button-led-uno': { drives: { D2: { mode: 'input_pullup', level: 0 }, D13: out(1) }, runtime: { btn1: { pressed: true } } },
  'servo-pot-uno': { servoAngles: { servo1: 90 }, runtime: { pot1: { position: 100 } } },
  'motor-transistor-uno': { drives: { D9: out(1, { duty: 0.4 }) } },
  'rgb-esp32c6': { drives: { GPIO21: out(1, { duty: 0.2 }), GPIO22: out(1, { duty: 0.7 }), GPIO23: out(1) } },
};

describe('examples stay clean, consistent and fast', () => {
  for (const id of EXAMPLE_IDS) {
    it(`${id}: no errors/warnings idle or running, KCL holds, solve < 2 ms`, () => {
      const p = buildExampleStrict(id).project;
      for (const inputs of [{}, RUNNING[id] ?? {}]) {
        const { result, issues } = solve(p, inputs);
        expect(result.converged).toBe(true);
        expect(issues.filter((i) => i.severity !== 'info').map((i) => `${i.code}: ${i.message}`)).toEqual([]);
        for (const [pid, st] of Object.entries(result.parts)) {
          expect(st.reversed ?? false, `${pid} reversed`).toBe(false);
          expect(st.overloaded ?? false, `${pid} overloaded`).toBe(false);
        }
        expect(kclError(p, result)).toBeLessThan(1e-6);
      }
      const nl = buildNetlist(p);
      const inputs = { ...idleInputs(), ...(RUNNING[id] ?? {}) };
      for (let i = 0; i < 50; i++) solveCircuit(p, nl, inputs); // warm-up (JIT)
      const t0 = performance.now();
      for (let i = 0; i < 200; i++) solveCircuit(p, nl, inputs);
      expect((performance.now() - t0) / 200).toBeLessThan(2);
    });
  }
});

describe('reverse-biased by design is not "reversed"', () => {
  it('flyback diode across the motor (motor-transistor-uno running)', () => {
    const p = buildExampleStrict('motor-transistor-uno').project;
    const d1 = solve(p, { drives: { D9: out(1) } }).result.parts.d1;
    expect(d1.voltage).toBeLessThan(-1); // reverse-biased, as it should be
    expect(d1.reversed).toBe(false);
  });

  it('antiparallel (bicolor) LED pair: the off LED is not flagged', () => {
    const la = part('led1', 'led', 0, 40);
    const lb = part('led2', 'led', 10, 40, { color: 'green' });
    const r = part('r1', 'resistor', 0, 50, { resistance: 220 });
    const p = makeProject([UNO(), la, lb, r], [
      ['uno1.D9', 'r1.a'],
      ['r1.b', 'led1.anode'],
      ['r1.b', 'led2.cathode'],
      ['led1.cathode', 'uno1.D10'],
      ['led2.anode', 'uno1.D10'],
    ]);
    const { result, issues } = solve(p, { drives: { D9: out(1), D10: out(0) } });
    expect(result.parts.led1.brightness).toBeGreaterThan(0.5);
    expect(result.parts.led2.reversed).toBe(false);
    expect(issues.some((i) => i.code === 'led-reversed')).toBe(false);
  });

  it('a diode inserted backwards in series is still reversed', () => {
    const d = part('d1', 'diode', 0, 60);
    const led = part('led1', 'led', 0, 40);
    const r = part('r1', 'resistor', 0, 50, { resistance: 220 });
    const p = makeProject([UNO(), d, led, r], [
      ['uno1.5V', 'd1.cathode'],
      ['d1.anode', 'r1.a'],
      ['r1.b', 'led1.anode'],
      ['led1.cathode', 'uno1.GND1'],
    ]);
    expect(solve(p).result.parts.d1.reversed).toBe(true);
  });
});

describe('a battery pushing current back into a board rail', () => {
  const aa = part('bat1', 'battery-aa4', 20, 0);

  it('4×AA into the Uno 5V pin back-feeds the USB port → error', () => {
    const p = makeProject([UNO(), aa], [
      ['bat1.plus', 'uno1.5V'],
      ['bat1.minus', 'uno1.GND1'],
    ]);
    const { result, issues } = solve(p);
    const usb = result.supplies.find((s) => s.id === 'uno1:5V');
    expect(usb?.currentA).toBeLessThan(-0.5);
    expect(usb?.overloaded).toBe(true);
    const issue = issues.find((i) => i.code === 'supply-overload' && i.parts.includes('uno1'));
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toMatch(/al revés/);
    expect(issue?.message).not.toMatch(/-\d/); // never "pidiendo -1 A"
  });

  it('a GPIO driven HIGH into 3V3 is not blamed on the 5V rail', () => {
    const p = makeProject([UNO()], [['uno1.D7', 'uno1.3V3']]);
    const { issues } = solve(p, { drives: { D7: out(1) } });
    const back = issues.find((i) => i.code === 'supply-overload');
    expect(back?.message).toMatch(/al revés/);
    expect(back?.message).not.toMatch(/5V \(USB\)/);
    expect(issues.some((i) => i.code === 'pin-overcurrent')).toBe(true);
  });

  it('4×AA into the Uno 3V3 pin → error', () => {
    const p = makeProject([UNO(), aa], [
      ['bat1.plus', 'uno1.3V3'],
      ['bat1.minus', 'uno1.GND1'],
    ]);
    const { issues } = solve(p);
    expect(issues.find((i) => i.code === 'supply-overload' && i.parts.includes('uno1'))?.severity).toBe('error');
  });
});

it('one short through two series-opposed batteries is reported once', () => {
  const b1 = part('bat1', 'battery-9v', 20, 0);
  const b2 = part('bat2', 'battery-9v', 40, 0);
  const p = makeProject([b1, b2], [
    ['bat1.plus', 'bat2.minus'],
    ['bat2.plus', 'bat1.minus'],
  ]);
  const { result, issues } = solve(p);
  expect(result.shorts).toHaveLength(1);
  expect(issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(['short-circuit']);
});

it('a battery reversed into the Uno 5V pin is one short, not short + overload', () => {
  const bat = part('bat1', 'battery-9v', 20, 0);
  const p = makeProject([UNO(), bat], [
    ['bat1.plus', 'uno1.GND1'],
    ['bat1.minus', 'uno1.5V'],
  ]);
  const { issues } = solve(p);
  expect(issues.filter((i) => i.severity === 'error').map((i) => i.code)).toEqual(['short-circuit']);
});

it('an unrelated overload on another rail is still reported next to a short', () => {
  const led = part('led1', 'led', 0, 40);
  const p = makeProject([UNO(), led], [
    ['uno1.5V', 'uno1.GND2'],
    ['uno1.3V3', 'led1.anode'],
    ['led1.cathode', 'uno1.GND3'],
  ]);
  const { issues } = solve(p);
  expect(issues.some((i) => i.code === 'short-circuit')).toBe(true);
  expect(issues.some((i) => i.code === 'supply-overload' && i.id.endsWith(':3V3'))).toBe(true);
});

it('a second, different short on the same board is not swallowed by the de-duplication', () => {
  const bb = BB();
  const btn = placeBy('btn1', 'button', 'a1', holePos(bb, 'e10')); // a-group col 10, b-group col 12
  const p = makeProject([UNO(), bb, btn], [
    ['uno1.5V', 'uno1.GND2'],
    ['uno1.3V3', 'bb1.a10'],
    ['uno1.GND3', 'bb1.a12'],
  ]);
  const { result } = solve(p, { runtime: { btn1: { pressed: true } } });
  expect(result.shorts).toHaveLength(2);
  expect(result.shorts[1].parts).toEqual(['uno1', 'btn1']);
});

describe('same-net shorts keep currents consistent', () => {
  it('5V wired to GND through the breadboard: KCL holds and the 5V pin reports the short current', () => {
    const p = makeProject([UNO(), BB()], [
      ['uno1.5V', 'bb1.T+1'],
      ['bb1.T+3', 'uno1.GND2'],
    ]);
    const { result } = solve(p);
    expect(result.shorts).toHaveLength(1);
    expect(kclError(p, result)).toBeLessThan(1e-6);
    expect(result.boardPins['5V'].currentA).toBeCloseTo(5 / 0.3, 3);
    expect(result.pinCurrents['uno1.5V']).toBeCloseTo(-5 / 0.3, 3);
  });

  it('battery shorted through the Uno GND bus: KCL holds', () => {
    const bat = part('bat1', 'battery-9v', 20, 20);
    const p = makeProject([UNO(), bat], [
      ['bat1.plus', 'uno1.GND1'],
      ['uno1.GND2', 'bat1.minus'],
    ]);
    const { result } = solve(p);
    expect(result.shorts.length).toBeGreaterThan(0);
    expect(kclError(p, result)).toBeLessThan(1e-6);
    expect(result.pinCurrents['bat1.plus']).toBeCloseTo(-6, 3);
  });
});

describe('PWM on a sinking (active-low) load', () => {
  function sink(withResistor: boolean) {
    const bb = BB();
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10')); // cathode e11
    if (!withResistor) {
      return makeProject([UNO(), bb, led], [
        ['uno1.5V', 'bb1.a10'],
        ['uno1.D9', 'bb1.a11'],
      ]);
    }
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'c10'), { resistance: 220 }); // a c6
    return makeProject([UNO(), bb, r, led], [
      ['uno1.5V', 'bb1.a6'],
      ['uno1.D9', 'bb1.a11'],
    ]);
  }

  it('the series resistor and the pin report the peak (LOW-phase) current like the LED', () => {
    const { result } = solve(sink(true), { drives: { D9: out(1, { duty: 0.25 }) } });
    const iLed = result.parts.led1.currentA;
    expect(iLed).toBeGreaterThan(0.01);
    expect(result.parts.r1.currentA).toBeCloseTo(iLed, 5);
    expect(result.boardPins.D9.currentA).toBeCloseTo(-iLed, 4); // sinking
  });

  it('the supply feeding a sinking PWM load reports its peak draw', () => {
    const { result } = solve(sink(true), { drives: { D9: out(1, { duty: 0.25 }) } });
    const usb = result.supplies.find((s) => s.id === 'uno1:5V');
    expect(usb?.currentA).toBeCloseTo(result.parts.led1.currentA, 4);
  });

  it('a sinking LED without resistor on a PWM pin also overloads the pin', () => {
    const { issues } = solve(sink(false), { drives: { D9: out(1, { duty: 0.5 }) } });
    expect(issues.find((i) => i.code === 'pin-overcurrent')?.severity).toBe('error');
  });
});

describe('malformed projects never kill the whole solve', () => {
  it('a part without props uses the defaults', () => {
    const r = { ...part('r1', 'resistor', 0, 30), props: undefined as never };
    const led = part('led1', 'led', 0, 40);
    const p = makeProject([UNO(), r, led], [
      ['uno1.5V', 'r1.a'],
      ['r1.b', 'led1.anode'],
      ['led1.cathode', 'uno1.GND1'],
    ]);
    const { result } = solve(p);
    expect(result.converged).toBe(true);
    expect(result.parts.led1.currentA).toBeGreaterThan(0.01);
  });

  it('a project without a wires array still builds a netlist', () => {
    const p = { ...makeProject([UNO()]), wires: undefined as never };
    expect(() => buildNetlist(p)).not.toThrow();
    expect(solveCircuit(p, buildNetlist(p), idleInputs()).converged).toBe(true);
  });
});

describe('NPN ratings', () => {
  it('base wired straight to 5V (no base resistor) overloads the transistor', () => {
    const q = part('q1', 'npn', 50, 50);
    const r = part('r1', 'resistor', 0, 30, { resistance: 220 });
    const led = part('led1', 'led', 0, 40);
    const p = makeProject([UNO(), q, r, led], [
      ['uno1.5V', 'q1.b'],
      ['q1.e', 'uno1.GND1'],
      ['uno1.5V', 'r1.a'],
      ['r1.b', 'led1.anode'],
      ['led1.cathode', 'q1.c'],
    ]);
    const { result } = solve(p);
    expect(result.pinCurrents['q1.b']).toBeGreaterThan(0.2);
    expect(result.parts.q1.overloaded).toBe(true);
  });
});

describe('NPN inverter (load between collector and GND)', () => {
  // D7 → 1 kΩ → base; collector pulled up to 5V by 220 Ω; LED from collector to GND.
  const q = part('q1', 'npn', 50, 50);
  const rb = part('r1', 'resistor', 0, 30, { resistance: 1000 });
  const rc = part('r2', 'resistor', 0, 60, { resistance: 220 });
  const led = part('led1', 'led', 0, 40);
  const p = makeProject([UNO(), q, rb, rc, led], [
    ['uno1.D7', 'r1.a'],
    ['r1.b', 'q1.b'],
    ['q1.e', 'uno1.GND1'],
    ['uno1.5V', 'r2.a'],
    ['r2.b', 'q1.c'],
    ['q1.c', 'led1.anode'],
    ['led1.cathode', 'uno1.GND2'],
  ]);

  it('is active-low: the LED is ON while the pin is LOW', () => {
    const { result, bindings } = solve(p, { drives: { D7: out(0) } });
    expect(result.parts.led1.brightness).toBeGreaterThan(0.3);
    expect(solve(p, { drives: { D7: out(1) } }).result.parts.led1.brightness).toBe(0);
    expect(bindings.find((b) => b.part === 'led1')).toMatchObject({ boardPin: 'D7', activeLow: true, driver: 'npn', via: ['q1', 'r1'] });
  });

  it('PWM dims it with the LOW share of the period', () => {
    const full = solve(p, { drives: { D7: out(0) } }).result.parts.led1.brightness ?? 0;
    const pwm = solve(p, { drives: { D7: out(1, { duty: 0.25 }) } }).result.parts.led1.brightness ?? 0;
    expect(pwm).toBeCloseTo(full * 0.75, 4);
  });
});
