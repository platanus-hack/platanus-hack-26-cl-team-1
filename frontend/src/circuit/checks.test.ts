import { describe, expect, it } from 'vitest';
import type { CircuitResult, ProjectModel } from '@/contracts';
import { buildNetlist, idleInputs, runChecks, solveCircuit } from './index';
import { BB, UNO, holePos, makeProject, part, placeBy } from './fixtures';
import { createStarterProject } from '@/store/newProject';

const checks = (p: ProjectModel, live = true) => {
  const nl = buildNetlist(p);
  const result: CircuitResult | null = live ? solveCircuit(p, nl, idleInputs()) : null;
  return runChecks(p, nl, result);
};
const codes = (p: ProjectModel, live = true) => checks(p, live).map((i) => i.code);

describe('runChecks', () => {
  it('no board → info; several boards → error', () => {
    expect(checks(makeProject([BB()])).find((i) => i.code === 'no-board')?.severity).toBe('info');
    const two = checks(makeProject([UNO(), part('esp1', 'esp32c6-devkit', 0, 40)]));
    expect(two.find((i) => i.code === 'multiple-boards')).toMatchObject({ severity: 'error', id: 'multiple-boards:uno1,esp1' });
  });

  it('starter projects are clean', () => {
    for (const board of ['uno', 'esp32c6', null] as const) {
      const issues = checks(createStarterProject(board));
      expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
    }
  });

  it('a short keeps the culprit wire highlighted', () => {
    const p = makeProject([UNO(), BB()], [['uno1.5V', 'bb1.T+1'], ['bb1.T+3', 'uno1.GND2']]);
    const short = checks(p).find((i) => i.code === 'short-circuit');
    expect(short?.wires).toEqual(['w1', 'w2']);
    expect(short?.message).toMatch(/A/);
  });

  it('LED rotated into one column is bypassed', () => {
    const bb = BB();
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'a10'), {}, 90); // cathode lands on b10
    const p = makeProject([UNO(), bb, led], [['uno1.5V', 'bb1.e10']]);
    const issue = checks(p).find((i) => i.code === 'part-bypassed');
    expect(issue?.parts).toEqual(['led1']);
    expect(issue?.message).toMatch(/columna 10/);
  });

  it('static checks work without a result (LED without resistor = warning)', () => {
    const bb = BB();
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, led], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.GND2', 'bb1.a11'],
    ]);
    expect(checks(p, false).find((i) => i.code === 'led-no-resistor')?.severity).toBe('warning');
  });

  it('reversed LED behind a resistor is caught statically', () => {
    const bb = BB();
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'c11')); // a c7
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10')); // cathode e11 → r1 → D9
    const p = makeProject([UNO(), bb, r, led], [
      ['uno1.GND2', 'bb1.a10'],
      ['uno1.D9', 'bb1.a7'],
    ]);
    expect(codes(p, false)).toContain('led-reversed');
  });

  it('unconnected part (info) and unconnected pin (warning)', () => {
    const bb = BB();
    const lone = part('r9', 'resistor', 0, 40);
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'c10'));
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10')); // cathode strip empty
    const p = makeProject([UNO(), bb, lone, r, led], [['uno1.D13', 'bb1.a6']]);
    const issues = checks(p);
    expect(issues.find((i) => i.id === 'unconnected-part:r9')?.severity).toBe('info');
    const pin = issues.find((i) => i.id === 'unconnected-pin:led1');
    expect(pin?.severity).toBe('warning');
    expect(pin?.message).toMatch(/Cátodo/);
  });

  it('motor straight on a GPIO + missing flyback diode', () => {
    const m = part('m1', 'motor-dc', 80, 0);
    const p = makeProject([UNO(), m], [
      ['uno1.D9', 'm1.a'],
      ['uno1.GND2', 'm1.b'],
    ]);
    const c = codes(p);
    expect(c).toContain('motor-direct-gpio');
    expect(c).toContain('missing-flyback');
  });

  it('battery-powered motor switched by an NPN without common ground', () => {
    const bb = BB();
    const q = placeBy('q1', 'npn', 'e', holePos(bb, 'e20'));
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'd21'), { resistance: 1000 });
    const m = part('m1', 'motor-dc', 80, 0);
    const bat = part('bat1', 'battery-aa4', 80, 30);
    const wires: Array<[string, string]> = [
      ['bat1.plus', 'm1.a'],
      ['m1.b', 'bb1.a22'],
      ['bat1.minus', 'bb1.a20'],
      ['uno1.D9', 'bb1.a17'],
    ];
    const p = makeProject([UNO(), bb, q, r, m, bat], wires);
    const issue = checks(p).find((i) => i.code === 'no-common-ground');
    expect(issue).toMatchObject({ severity: 'error', parts: ['q1', 'bat1'] });
    // Joining the grounds fixes it.
    const fixed = makeProject([UNO(), bb, q, r, m, bat], [...wires, ['uno1.GND2', 'bb1.b20']]);
    expect(codes(fixed)).not.toContain('no-common-ground');
  });

  it('floating input: button to 5V without pull-down', () => {
    const bb = BB();
    const btn = placeBy('btn1', 'button', 'a1', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, btn], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.D2', 'bb1.a12'],
    ]);
    expect(codes(p)).toContain('floating-input');
  });

  it('servo powered from 3V3 and ESP32 strapping pins', () => {
    const s = part('servo1', 'servo-sg90', 60, 30);
    const p = makeProject([UNO(), s], [
      ['uno1.3V3', 'servo1.vcc'],
      ['uno1.GND2', 'servo1.gnd'],
      ['uno1.D9', 'servo1.signal'],
    ]);
    expect(codes(p)).toContain('servo-power');

    const bb = BB(0, 0);
    const esp = part('esp1', 'esp32c6-devkit', 0, 6);
    const r = placeBy('r1', 'resistor', 'a', holePos(bb, 'a15'), { resistance: 220 }); // GPIO4 strip
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'b19'));
    const p2 = makeProject([bb, esp, r, led], [['bb1.a20', 'bb1.f3']]); // f3 = GND4 strip (J3 col 3)
    const strap = checks(p2).find((i) => i.code === 'strapping-pin');
    expect(strap).toMatchObject({ severity: 'info', id: 'strapping-pin:esp1,led1,r1:GPIO4' });
  });

  it('ignores stale results and stays fast', () => {
    const bb = BB();
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, led], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.GND2', 'bb1.a11'],
    ]);
    const nl = buildNetlist(p);
    const result = solveCircuit(p, nl, idleInputs());
    const other = { ...p };
    expect(runChecks(other, buildNetlist(other), result).find((i) => i.code === 'led-no-resistor')?.severity).toBe('warning');
    runChecks(p, nl, result);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) runChecks(p, nl, result);
    expect((performance.now() - t0) / 20).toBeLessThan(5);
  });

  it('every issue has Spanish text and a stable id', () => {
    const bb = BB();
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, led], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.GND2', 'bb1.a11'],
      ['uno1.3V3', 'uno1.GND1'],
    ]);
    const issues = checks(p);
    expect(issues.length).toBeGreaterThan(1);
    for (const i of issues) {
      expect(i.id.startsWith(`${i.code}:`)).toBe(true);
      expect(i.title.length).toBeGreaterThan(3);
      expect(i.message.length).toBeGreaterThan(20);
    }
    expect(issues[0].severity).toBe('error');
    expect(new Set(issues.map((i) => i.id)).size).toBe(issues.length);
  });
});
