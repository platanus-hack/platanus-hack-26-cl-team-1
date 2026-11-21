import { describe, expect, it } from 'vitest';
import type { Netlist } from '@/contracts';
import { getPartDef } from '@/catalog';
import { buildPinIndex, carriedParts, getPinIndex, insertionsFor, pinAt } from './pinIndex';
import { part, project, unoAndBreadboard } from './fixtures';

describe('pin index', () => {
  const p = project(unoAndBreadboard());
  const idx = buildPinIndex(p);

  it('indexes every pin at its world position', () => {
    // bb at x=34: hole a10 at local (11, 5) → world (45, 5)
    expect(idx.byRef.get('bb1.a10')).toMatchObject({ x: 45, y: 5, contact: 'female', isHole: true });
    expect(idx.byRef.get('uno1.D13')).toMatchObject({ x: 12, y: 1, contact: 'female' });
    expect(idx.byPart.get('bb1')).toHaveLength(400);
  });

  it('memoizes per project object', () => {
    expect(getPinIndex(p)).toBe(getPinIndex(p));
  });

  it('pinAt finds the nearest pin within the radius', () => {
    expect(pinAt(idx, { x: 45.2, y: 5.1 }, 0.4)?.ref).toBe('bb1.a10');
    expect(pinAt(idx, { x: 45.5, y: 5.5 }, 0.4)).toBeNull();
  });

  it('pinAt prefers the part drawn on top at the same point', () => {
    const q = project([...unoAndBreadboard(), part('led1', 'led', 45, 6)]); // anode at (45, 9) = hole e10
    const i2 = buildPinIndex(q);
    expect(pinAt(i2, { x: 45, y: 9 }, 0.4)?.ref).toBe('led1.anode');
    expect(pinAt(i2, { x: 45, y: 9 }, 0.4, (e) => e.partId !== 'led1')?.ref).toBe('bb1.e10');
  });
});

describe('insertionsFor (drop preview)', () => {
  const p = project(unoAndBreadboard());
  const idx = buildPinIndex(p);
  const led = getPartDef('led');

  it('reports holes where male legs land on female holes', () => {
    const ins = insertionsFor(led, { x: 45, y: 6 }, 0, idx);
    expect(ins.map((i) => i.into).sort()).toEqual(['bb1.e10', 'bb1.e11']);
  });

  it('reports nothing off the breadboard', () => {
    expect(insertionsFor(led, { x: 100, y: 100 }, 0, idx)).toEqual([]);
  });

  it('plugs LED legs into the Uno header sockets too', () => {
    // anode at (x, y+3): put it on D13 (12, 1) → origin (12, -2); cathode → (13, 1) = D12
    const ins = insertionsFor(led, { x: 12, y: -2 }, 0, idx);
    expect(ins.map((i) => i.into).sort()).toEqual(['uno1.D12', 'uno1.D13']);
  });

  it('ignores excluded parts', () => {
    expect(insertionsFor(led, { x: 45, y: 6 }, 0, idx, new Set(['bb1']))).toEqual([]);
  });

  it('male-on-male does not connect (ESP32 pins over a loose leg)', () => {
    const q = project([part('led1', 'led', 0, 0)]);
    const i2 = buildPinIndex(q);
    expect(insertionsFor(led, { x: 0, y: 0 }, 0, i2)).toEqual([]);
  });
});

describe('carriedParts', () => {
  it('carries parts plugged into a dragged breadboard', () => {
    const p = project([...unoAndBreadboard(), part('led1', 'led', 45, 6), part('r1', 'resistor', 60, 40)]);
    expect([...carriedParts(p, new Set(['bb1']))]).toEqual(['led1']);
  });

  it('carries an ESP32 devkit straddling the breadboard', () => {
    const p = project([part('bb1', 'breadboard-half', 0, 0), part('esp1', 'esp32c6-devkit', 0, 6)]);
    expect(carriedParts(p, new Set(['bb1'])).has('esp1')).toBe(true);
  });

  it('does not carry anything when moving a component', () => {
    const p = project([...unoAndBreadboard(), part('led1', 'led', 45, 6)]);
    expect(carriedParts(p, new Set(['led1'])).size).toBe(0);
  });

  it('also uses netlist insertions', () => {
    const p = project([...unoAndBreadboard(), part('r1', 'resistor', 90, 40)]);
    const netlist: Netlist = { nets: [], pinNet: {}, insertions: [{ pin: 'r1.a', into: 'bb1.a1' }] };
    expect(carriedParts(p, new Set(['bb1']), netlist).has('r1')).toBe(true);
  });
});
