import { describe, expect, it } from 'vitest';
import type { PartSimState } from '@/contracts';
import { BurnoutTracker, ShortTracker } from './health';

const st = (overloaded: boolean, extra: Partial<PartSimState> = {}): PartSimState => ({ currentA: 0.1, voltage: 2, overloaded, ...extra });
const always = () => true;

describe('BurnoutTracker', () => {
  it('burns a part overloaded continuously for more than 300 ms', () => {
    const b = new BurnoutTracker(300);
    const parts = { led1: st(true) };
    expect(b.update(parts, 16, always)).toEqual([]); // starts counting
    expect(b.active).toBe(true);
    let burned: string[] = [];
    let elapsed = 0;
    while (burned.length === 0 && elapsed < 1000) {
      burned = b.update(parts, 50, always);
      elapsed += 50;
    }
    expect(burned).toEqual(['led1']);
    expect(elapsed).toBe(350);
    expect(b.active).toBe(false);
  });

  it('resets the accumulator when the overload stops', () => {
    const b = new BurnoutTracker(300);
    b.update({ led1: st(true) }, 16, always);
    b.update({ led1: st(true) }, 250, always);
    b.update({ led1: st(false) }, 16, always);
    expect(b.active).toBe(false);
    b.update({ led1: st(true) }, 16, always);
    expect(b.update({ led1: st(true) }, 250, always)).toEqual([]);
  });

  it('ignores parts filtered out and already burned parts', () => {
    const b = new BurnoutTracker(300);
    const parts = { r1: st(true), led2: st(true, { burned: true }) };
    b.update(parts, 16, (id) => id !== 'r1');
    expect(b.update(parts, 1000, (id) => id !== 'r1')).toEqual([]);
    expect(b.active).toBe(false);
  });

  it('caps dt sanity (NaN / negative dt add nothing)', () => {
    const b = new BurnoutTracker(300);
    b.update({ led1: st(true) }, 16, always);
    expect(b.update({ led1: st(true) }, Number.NaN, always)).toEqual([]);
    expect(b.update({ led1: st(true) }, -500, always)).toEqual([]);
  });
});

describe('ShortTracker', () => {
  const short = (parts: string[]) => ({ parts, nets: ['n1'], currentA: 16, message: 'Corto entre 5V y GND' });

  it('reports each distinct short once while it persists', () => {
    const s = new ShortTracker(4000);
    expect(s.update([short(['uno1'])], 0)).toHaveLength(1);
    expect(s.update([short(['uno1'])], 16)).toHaveLength(0);
    expect(s.update([short(['uno1']), short(['bat1'])], 32)).toHaveLength(1);
  });

  it('re-reports after it disappears, but only after the cooldown', () => {
    const s = new ShortTracker(4000);
    s.update([short(['uno1'])], 0);
    s.update([], 100);
    expect(s.update([short(['uno1'])], 200)).toHaveLength(0);
    s.update([], 300);
    expect(s.update([short(['uno1'])], 5000)).toHaveLength(1);
  });
});
