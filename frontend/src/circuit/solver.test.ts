import { describe, expect, it } from 'vitest';
import type { CircuitInputs, PinDrive, ProjectModel } from '@/contracts';
import { buildNetlist, idleInputs, runChecks, solveCircuit } from './index';
import { BB, UNO, holePos, makeProject, part, placeBy } from './fixtures';

const solve = (p: ProjectModel, inputs: Partial<CircuitInputs> = {}) => {
  const nl = buildNetlist(p);
  const result = solveCircuit(p, nl, { ...idleInputs(), ...inputs });
  return { nl, result, issues: runChecks(p, nl, result) };
};
const out = (level: 0 | 1, extra: Partial<PinDrive> = {}): PinDrive => ({ mode: 'output', level, ...extra });

/** 9 V battery + 470 Ω + red LED on a breadboard at the origin. */
function batteryLed() {
  const bb = BB(0, 0);
  const r = placeBy('r1', 'resistor', 'a', holePos(bb, 'c6'), { resistance: 470 }); // b → c10
  const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'), { color: 'red' }); // cathode → e11
  const bat = part('bat1', 'battery-9v', -20, 0);
  return makeProject([bb, r, led, bat], [
    ['bat1.plus', 'bb1.a6'],
    ['bat1.minus', 'bb1.a11'],
  ]);
}

/** Uno + breadboard, LED in e10/e11 with wires from `anodeFrom` and `cathodeTo`. */
function unoLed(anodeFrom: string, cathodeTo: string) {
  const bb = BB();
  const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
  return makeProject([UNO(), bb, led], [
    [anodeFrom, 'bb1.a10'],
    [cathodeTo, 'bb1.a11'],
  ]);
}

describe('solveCircuit — battery + resistor + LED', () => {
  const p = batteryLed();
  const { result } = solve(p);
  const expected = (9 - 1.9) / (470 + 12 + 1.5);

  it('converges and gives the textbook current', () => {
    expect(result.converged).toBe(true);
    expect(result.project).toBe(p);
    const led = result.parts.led1;
    expect(led.currentA).toBeGreaterThan(expected * 0.95);
    expect(led.currentA).toBeLessThan(expected * 1.05);
    expect(led.brightness).toBeGreaterThan(0.5);
    expect(led.overloaded).toBe(false);
    expect(result.parts.r1.currentA).toBeCloseTo(led.currentA, 6);
  });

  it('battery: discharging current positive, minus is the 0 V reference', () => {
    expect(result.parts.bat1.currentA).toBeCloseTo(expected, 3);
    expect(result.pinVoltages['bat1.minus']).toBeCloseTo(0, 6);
    expect(result.pinVoltages['bat1.plus']).toBeGreaterThan(8.9);
    const sup = result.supplies.find((s) => s.id === 'bat1');
    expect(sup?.overloaded).toBe(false);
    expect(sup?.currentA).toBeCloseTo(expected, 3);
  });

  it('wire current sign follows from → to', () => {
    expect(result.wireCurrents.w1).toBeCloseTo(expected, 3); // battery + → a6
    expect(result.wireCurrents.w2).toBeCloseTo(-expected, 3); // current flows a11 → battery −
  });

  it('pin currents: legs carry the LED current, strip holes balance', () => {
    expect(result.pinCurrents['led1.anode']).toBeCloseTo(expected, 3);
    expect(result.pinCurrents['led1.cathode']).toBeCloseTo(-expected, 3);
    const strip = ['a10', 'b10', 'c10', 'd10', 'e10'].map((h) => result.pinCurrents[`bb1.${h}`]);
    expect(strip.reduce((s, x) => s + x, 0)).toBeCloseTo(0, 6);
    expect(result.pinCurrents['bb1.e10']).toBeCloseTo(expected, 3);
  });

  it('net voltages are keyed by the netlist ids', () => {
    const nl = buildNetlist(p);
    expect(result.netVoltages[nl.pinNet['bb1.a6']]).toBeGreaterThan(8.9);
  });
});

describe('solveCircuit — Uno', () => {
  it('LED without resistor on 5V overloads (and is flagged)', () => {
    const { result, issues } = solve(unoLed('uno1.5V', 'uno1.GND2'));
    expect(result.boardPart).toBe('uno1');
    expect(result.parts.led1.overloaded).toBe(true);
    expect(result.parts.led1.currentA).toBeGreaterThan(0.2);
    const issue = issues.find((i) => i.code === 'led-no-resistor');
    expect(issue?.severity).toBe('error');
    expect(issue?.id).toBe('led-no-resistor:led1');
  });

  it('reversed LED: no current, reversed flag + issue', () => {
    const { result, issues } = solve(unoLed('uno1.GND2', 'uno1.5V'));
    expect(Math.abs(result.parts.led1.currentA)).toBeLessThan(1e-6);
    expect(result.parts.led1.reversed).toBe(true);
    expect(result.parts.led1.brightness).toBe(0);
    expect(issues.some((i) => i.code === 'led-reversed')).toBe(true);
  });

  it('button to GND with INPUT_PULLUP reads 1 released / 0 pressed', () => {
    const bb = BB();
    const btn = placeBy('btn1', 'button', 'a1', holePos(bb, 'e10')); // b1 e12, a2 f10, b2 f12
    const p = makeProject([UNO(), bb, btn], [
      ['uno1.D2', 'bb1.a10'],
      ['uno1.GND1', 'bb1.a12'],
    ]);
    const drives = { D2: { mode: 'input_pullup', level: 0 } as PinDrive };
    const released = solve(p, { drives }).result;
    expect(released.boardPins.D2.digital).toBe(1);
    expect(released.boardPins.D2.volts).toBeGreaterThan(4.9);
    const pressed = solve(p, { drives, runtime: { btn1: { pressed: true } } }).result;
    expect(pressed.boardPins.D2.digital).toBe(0);
    expect(pressed.boardPins.D2.currentA).toBeCloseTo(5 / 35000, 5);
    // runtime override wins over the prop
    const p2 = { ...p, parts: p.parts.map((x) => (x.id === 'btn1' ? { ...x, props: { pressed: true } } : x)) };
    expect(solve(p2, { drives, runtime: { btn1: { pressed: false } } }).result.boardPins.D2.digital).toBe(1);
  });

  it('potentiometer divider: wiper ≈ position · 5 V', () => {
    const bb = BB();
    const pot = placeBy('pot1', 'potentiometer', 'a', holePos(bb, 'e10'), { position: 30 }); // wiper e12, b e14
    const p = makeProject([UNO(), bb, pot], [
      ['uno1.GND2', 'bb1.a10'],
      ['uno1.5V', 'bb1.a14'],
      ['bb1.a12', 'uno1.A0'],
    ]);
    const r = solve(p).result;
    expect(r.boardPins.A0.volts).toBeCloseTo(1.5, 1);
    expect(r.boardPins.A0.adc).toBeGreaterThan(300);
    expect(r.boardPins.A0.adc).toBeLessThan(314);
    const r2 = solve(p, { runtime: { pot1: { position: 80 } } }).result;
    expect(r2.boardPins.A0.volts).toBeCloseTo(4, 1);
  });

  it('NPN saturates driving a motor from 5V when the GPIO is HIGH', () => {
    const bb = BB();
    const q = placeBy('q1', 'npn', 'e', holePos(bb, 'e20')); // b e21, c e22
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'd21'), { resistance: 1000 }); // a d17
    const m = part('m1', 'motor-dc', 80, 0);
    const p = makeProject([UNO(), bb, q, r, m], [
      ['uno1.5V', 'm1.a'],
      ['m1.b', 'bb1.a22'],
      ['uno1.GND2', 'bb1.a20'],
      ['uno1.D9', 'bb1.a17'],
    ]);
    const on = solve(p, { drives: { D9: out(1) } }).result;
    expect(on.converged).toBe(true);
    expect(on.parts.q1.region).toBe('saturación');
    expect(on.parts.m1.speed).toBeGreaterThan(0.5);
    expect(on.pinCurrents['q1.b']).toBeGreaterThan(0.003);
    const off = solve(p, { drives: { D9: out(0) } }).result;
    expect(off.parts.q1.region).toBe('corte');
    expect(off.parts.m1.speed).toBe(0);
    const pwm = solve(p, { drives: { D9: out(1, { duty: 0.5 }) } }).result;
    expect(pwm.parts.m1.speed).toBeCloseTo((on.parts.m1.speed ?? 0) * 0.5, 3);
  });

  it('5V–GND wire is a short: removed source, overloaded supply, issue', () => {
    const p = makeProject([UNO(), BB()], [['uno1.5V', 'uno1.GND2']]);
    const { result, issues } = solve(p);
    expect(result.shorts.length).toBeGreaterThan(0);
    expect(result.shorts[0].currentA).toBeCloseTo(5 / 0.3, 3);
    expect(result.shorts[0].message).toMatch(/Cortocircuito/);
    const usb = result.supplies.find((s) => s.id === 'uno1:5V');
    expect(usb?.overloaded).toBe(true);
    expect(result.wireCurrents.w1).toBeCloseTo(5 / 0.3, 3);
    expect(issues.some((i) => i.code === 'short-circuit' && i.severity === 'error')).toBe(true);
    expect(issues.some((i) => i.code === 'supply-overload')).toBe(false); // explained by the short
  });

  it('a pressed button between 5V and GND is a solved short', () => {
    const bb = BB();
    const btn = placeBy('btn1', 'button', 'a1', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, btn], [
      ['uno1.5V', 'bb1.a10'],
      ['uno1.GND2', 'bb1.a12'],
    ]);
    const idle = solve(p).result;
    expect(idle.shorts).toHaveLength(0);
    const r = solve(p, { runtime: { btn1: { pressed: true } } }).result;
    expect(r.shorts.length).toBe(1);
    expect(r.shorts[0].parts).toContain('btn1');
  });

  it('PWM scales LED brightness; active-low LEDs use the LOW phase', () => {
    const bb = BB();
    const r = placeBy('r1', 'resistor', 'b', holePos(bb, 'c10'), { resistance: 220 });
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const p = makeProject([UNO(), bb, r, led], [
      ['uno1.D9', 'bb1.a6'],
      ['uno1.GND2', 'bb1.a11'],
    ]);
    const full = solve(p, { drives: { D9: out(1) } }).result.parts.led1.brightness ?? 0;
    const half = solve(p, { drives: { D9: out(1, { duty: 0.5 }) } }).result.parts.led1;
    expect(full).toBeGreaterThan(0.5);
    expect(half.brightness).toBeCloseTo(full * 0.5, 4);
    expect(half.currentA).toBeGreaterThan(0.01); // peak current

    // Sinking LED: anode → 220 Ω → 5V, cathode → D9. ON while D9 is LOW.
    const sink = makeProject([UNO(), bb, r, led], [
      ['uno1.5V', 'bb1.a6'],
      ['uno1.D9', 'bb1.a11'],
    ]);
    const low = solve(sink, { drives: { D9: out(0) } }).result.parts.led1.brightness ?? 0;
    expect(low).toBeGreaterThan(0.5);
    expect(solve(sink, { drives: { D9: out(1) } }).result.parts.led1.brightness).toBe(0);
    const quarter = solve(sink, { drives: { D9: out(1, { duty: 0.25 }) } }).result.parts.led1.brightness;
    expect(quarter).toBeCloseTo(low * 0.75, 4);
  });

  it('passive buzzer sounds only with tone()', () => {
    const bb = BB();
    const bz = placeBy('bz1', 'buzzer', 'plus', holePos(bb, 'e10')); // minus e13
    const p = makeProject([UNO(), bb, bz], [
      ['uno1.D8', 'bb1.a10'],
      ['uno1.GND2', 'bb1.a13'],
    ]);
    expect(solve(p, { drives: { D8: out(1) } }).result.parts.bz1.sounding).toBe(false);
    const tone = solve(p, { drives: { D8: out(1, { duty: 0.5, toneHz: 440 }) } }).result.parts.bz1;
    expect(tone.sounding).toBe(true);
    expect(tone.toneHz).toBe(440);
  });

  it('servo powered from 5V follows the commanded angle', () => {
    const s = part('servo1', 'servo-sg90', 60, 30);
    const p = makeProject([UNO(), s], [
      ['uno1.5V', 'servo1.vcc'],
      ['uno1.GND2', 'servo1.gnd'],
      ['uno1.D9', 'servo1.signal'],
    ]);
    const r = solve(p, { servoAngles: { servo1: 120 } }).result.parts.servo1;
    expect(r.powered).toBe(true);
    expect(r.angle).toBe(120);
    const unpowered = solve(makeProject([UNO(), s], [['uno1.D9', 'servo1.signal']]), { servoAngles: { servo1: 120 } }).result.parts.servo1;
    expect(unpowered.powered).toBe(false);
    expect(unpowered.angle).toBeUndefined();
  });

  it('burned parts are open circuits', () => {
    const p = unoLed('uno1.5V', 'uno1.GND2');
    const { result, issues } = solve(p, { burned: ['led1'] });
    expect(result.parts.led1.burned).toBe(true);
    expect(result.parts.led1.currentA).toBe(0);
    expect(issues.some((i) => i.code === 'part-burned')).toBe(true);
  });

  it('onboard indicators and alias drives', () => {
    const led = placeBy('led1', 'led', 'anode', { x: 9, y: 1 }); // into the SDA socket (= A4)
    const p = makeProject([UNO(), led], [['led1.cathode', 'uno1.GND3']]);
    const r = solve(p, { drives: { D13: out(1, { duty: 0.25 }), SDA: out(1) } }).result;
    expect(r.parts.uno1.onboard).toEqual({ power: true, led: 0.25 });
    expect(r.boardPins.A4.volts).toBeGreaterThan(2);
    expect(r.boardPins.SDA).toBeUndefined();
    expect(r.boardPins.A4.currentA).toBeGreaterThan(0.02); // sourcing through the SDA alias
    expect(r.boardPins.D13.digital).toBe(1);
  });

  it('GPIO overcurrent is reported per pin', () => {
    const { issues } = solve(unoLed('uno1.D7', 'uno1.GND2'), { drives: { D7: out(1) } });
    const oc = issues.find((i) => i.code === 'pin-overcurrent');
    expect(oc?.severity).toBe('error');
    expect(oc?.parts).toEqual(['uno1', 'led1']);
  });
});

describe('solveCircuit — ESP32-C6 & edge cases', () => {
  it('5 V into a GPIO is an overvoltage error', () => {
    const bb = BB(0, 0);
    const esp = part('esp1', 'esp32c6-devkit', 0, 6);
    const p = makeProject([bb, esp], [['esp1.5V', 'bb1.a15']]); // a15 strip = GPIO4
    const { result, issues } = solve(p);
    expect(result.boardPins.GPIO4.volts).toBeCloseTo(5, 1);
    expect(issues.some((i) => i.code === 'pin-overvoltage' && i.severity === 'error')).toBe(true);
    expect(result.parts.esp1.onboard).toEqual({ power: true, rgb: [0, 0, 0] });
    const rgb = solve(p, { onboardRgb: [255, 0, 51] }).result.parts.esp1.onboard?.rgb;
    expect(rgb?.[0]).toBe(1);
    expect(rgb?.[2]).toBeCloseTo(0.2, 5);
  });

  it('RGB LED channels light independently', () => {
    const bb = BB();
    const rgb = placeBy('rgb1', 'led-rgb', 'com', holePos(bb, 'e11')); // r e10, g e12, b e13
    const r1 = placeBy('r1', 'resistor', 'b', holePos(bb, 'c10'), { resistance: 220 }); // a c6
    const r2 = placeBy('r2', 'resistor', 'b', holePos(bb, 'd12'), { resistance: 220 }); // a d8
    const p = makeProject([UNO(), bb, rgb, r1, r2], [
      ['uno1.D9', 'bb1.a6'],
      ['uno1.D10', 'bb1.a8'],
      ['uno1.GND2', 'bb1.a11'],
    ]);
    const r = solve(p, { drives: { D9: out(1), D10: out(1, { duty: 0.5 }) } }).result.parts.rgb1;
    expect(r.rgb?.[0]).toBeGreaterThan(0.5);
    expect(r.rgb?.[1]).toBeGreaterThan(0.2);
    expect(r.rgb?.[1]).toBeLessThan(r.rgb?.[0] ?? 0);
    expect(r.rgb?.[2]).toBe(0);
  });

  it('warm start: repeated solves give the same answer in one iteration', () => {
    const p = unoLed('uno1.5V', 'uno1.GND2');
    const nl = buildNetlist(p);
    const first = solveCircuit(p, nl, idleInputs());
    const again = solveCircuit(p, nl, idleInputs());
    expect(again.iterations).toBe(1);
    expect(again.parts.led1.currentA).toBeCloseTo(first.parts.led1.currentA, 9);
  });

  it('empty project / no board never throws', () => {
    const r = solve(makeProject([])).result;
    expect(r.converged).toBe(true);
    expect(r.boardPart).toBeNull();
    const weird = makeProject([{ id: 'zz', type: 'unknown', label: 'z', x: 0, y: 0, rotation: 0, props: {} }]);
    expect(() => solve(weird)).not.toThrow();
  });

  it('isolated battery circuits use the battery minus as 0 V', () => {
    const p = batteryLed();
    const withUno = makeProject([...p.parts, part('uno1', 'arduino-uno', 0, 40)], p.wires.map((w) => [w.from, w.to]));
    const r = solve(withUno).result;
    expect(r.pinVoltages['bat1.minus']).toBeCloseTo(0, 6);
    expect(r.pinVoltages['bat1.plus']).toBeGreaterThan(8.9);
  });
});
