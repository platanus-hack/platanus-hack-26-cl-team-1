import { describe, expect, it } from 'vitest';
import { buildNetlist } from './netlist';
import { BB, UNO, holePos, makeProject, part, placeBy } from './fixtures';
import { luSolve } from './linalg';

describe('buildNetlist — breadboard', () => {
  const bb = BB(0, 0);
  const nl = buildNetlist(makeProject([bb]));

  it('joins a–e of a column but not e–f', () => {
    expect(nl.pinNet['bb1.a5']).toBe(nl.pinNet['bb1.e5']);
    expect(nl.pinNet['bb1.f5']).toBe(nl.pinNet['bb1.j5']);
    expect(nl.pinNet['bb1.e5']).not.toBe(nl.pinNet['bb1.f5']);
    expect(nl.pinNet['bb1.a5']).not.toBe(nl.pinNet['bb1.a6']);
  });

  it('joins each rail along its length, rails stay separate', () => {
    expect(nl.pinNet['bb1.T+1']).toBe(nl.pinNet['bb1.T+29']);
    expect(nl.pinNet['bb1.T+1']).not.toBe(nl.pinNet['bb1.T-1']);
    expect(nl.pinNet['bb1.B-2']).toBe(nl.pinNet['bb1.B-29']);
  });

  it('uses deterministic ids n1…', () => {
    expect(nl.nets[0].id).toBe('n1');
    expect(buildNetlist(makeProject([BB(0, 0)])).nets.map((n) => n.id)).toEqual(nl.nets.map((n) => n.id));
    expect(nl.nets).toHaveLength(30 * 2 + 4);
  });
});

describe('buildNetlist — overlap rules', () => {
  it('a male leg in a female hole connects and is listed as insertion', () => {
    const bb = BB(0, 0);
    const led = placeBy('led1', 'led', 'anode', holePos(bb, 'e10'));
    const nl = buildNetlist(makeProject([bb, led]));
    expect(nl.pinNet['led1.anode']).toBe(nl.pinNet['bb1.a10']);
    expect(nl.pinNet['led1.cathode']).toBe(nl.pinNet['bb1.c11']);
    expect(nl.insertions).toContainEqual({ pin: 'led1.anode', into: 'bb1.e10' });
    expect(nl.insertions).toContainEqual({ pin: 'led1.cathode', into: 'bb1.e11' });
  });

  it('male–male overlap does not connect', () => {
    const a = placeBy('r1', 'resistor', 'b', { x: 50, y: 50 });
    const b = placeBy('r2', 'resistor', 'a', { x: 50, y: 50 });
    const nl = buildNetlist(makeProject([a, b]));
    expect(nl.pinNet['r1.b']).not.toBe(nl.pinNet['r2.a']);
    expect(nl.insertions).toHaveLength(0);
  });

  it('female–female overlap (Uno header on a breadboard hole) does not connect', () => {
    const bb = BB(0, 0);
    const hole = holePos(bb, 'a10');
    const uno = part('uno1', 'arduino-uno', hole.x - 12, hole.y - 1); // D13 socket at (12,1)
    const nl = buildNetlist(makeProject([bb, uno]));
    expect(nl.pinNet['uno1.D13']).not.toBe(nl.pinNet['bb1.a10']);
  });

  it('a leg pushed into an Uno socket connects and names the net', () => {
    const led = placeBy('led1', 'led', 'anode', { x: 12, y: 1 });
    const nl = buildNetlist(makeProject([UNO(), led]));
    const net = nl.nets.find((n) => n.id === nl.pinNet['led1.anode']);
    expect(net?.name).toBe('D13');
  });

  it('ESP32 male header pins plug into the breadboard', () => {
    const nl = buildNetlist(makeProject([BB(0, 0), part('esp1', 'esp32c6-devkit', 0, 6)]));
    expect(nl.pinNet['esp1.GPIO4']).toBe(nl.pinNet['bb1.a15']);
    expect(nl.pinNet['esp1.3V3']).toBe(nl.pinNet['bb1.e17']);
    const net = nl.nets.find((n) => n.id === nl.pinNet['bb1.a15']);
    expect(net?.name).toBe('GPIO4');
  });
});

describe('buildNetlist — wires, buses, names', () => {
  it('wires join nets and are listed on the net', () => {
    const bb = BB();
    const nl = buildNetlist(makeProject([UNO(), bb], [['uno1.5V', 'bb1.T+1'], ['uno1.GND2', 'bb1.T-1']]));
    const vcc = nl.nets.find((n) => n.id === nl.pinNet['bb1.T+10']);
    const gnd = nl.nets.find((n) => n.id === nl.pinNet['bb1.T-10']);
    expect(vcc?.name).toBe('5V');
    expect(vcc?.wires).toEqual(['w1']);
    expect(gnd?.name).toBe('GND');
    // board internal buses: all GND pins, IOREF = 5V, SDA = A4
    expect(nl.pinNet['uno1.GND1']).toBe(nl.pinNet['uno1.GND3']);
    expect(nl.pinNet['uno1.IOREF']).toBe(nl.pinNet['uno1.5V']);
    expect(nl.nets.find((n) => n.id === nl.pinNet['uno1.SDA'])?.name).toBe('A4');
  });

  it('names battery terminals, prefixed when there are several', () => {
    const one = buildNetlist(makeProject([part('bat1', 'battery-9v', 0, 0)]));
    expect(one.nets.find((n) => n.id === one.pinNet['bat1.plus'])?.name).toBe('BAT+');
    expect(one.nets.find((n) => n.id === one.pinNet['bat1.minus'])?.name).toBe('BAT−');
    const two = buildNetlist(makeProject([part('bat1', 'battery-9v', 0, 0), part('bat2', 'battery-aa4', 20, 0)]));
    expect(two.nets.find((n) => n.id === two.pinNet['bat2.plus'])?.name).toBe('Pilas 4xAA 2 BAT+');
  });

  it('ignores wires to unknown pins and unknown part types', () => {
    const p = makeProject([BB(), { id: 'x1', type: 'nope', label: 'x', x: 0, y: 0, rotation: 0, props: {} }], [['bb1.a1', 'ghost.pin']]);
    expect(() => buildNetlist(p)).not.toThrow();
  });

  it('is fast (400 holes + 30 parts)', () => {
    const make = () => {
      const bb = BB(0, 0);
      const parts = [bb, part('uno1', 'arduino-uno', -40, 0)];
      for (let i = 0; i < 28; i++) parts.push(placeBy(`led${i + 1}`, 'led', 'anode', holePos(bb, `${i % 2 ? 'f' : 'a'}${(i % 29) + 1}`)));
      return makeProject(parts, [['uno1.5V', 'bb1.T+1'], ['uno1.GND1', 'bb1.T-1']]);
    };
    buildNetlist(make());
    const runs = 20;
    const t0 = performance.now();
    for (let i = 0; i < runs; i++) buildNetlist(make());
    const avg = (performance.now() - t0) / runs;
    expect(avg).toBeLessThan(10); // target < 3 ms; loose bound for slow CI
  });
});

describe('luSolve', () => {
  it('solves with pivoting and detects singular matrices', () => {
    const x = luSolve(Float64Array.from([0, 2, 1, 1]), Float64Array.from([4, 3]), 2);
    expect(x && Array.from(x)).toEqual([1, 2]);
    expect(luSolve(Float64Array.from([1, 2, 2, 4]), Float64Array.from([1, 2]), 2)).toBeNull();
  });
});
