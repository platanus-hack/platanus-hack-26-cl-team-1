import { describe, expect, it } from 'vitest';
import { buildWirePath, closestSegment, endDirection, flowParams, FLOW_THRESHOLD_A, sagFor } from './wirePath';

/** Parse "M x y C ..." into numbers per command. */
function commands(d: string): Array<{ cmd: string; nums: number[] }> {
  return [...d.matchAll(/([MC])([^MC]*)/g)].map((m) => ({ cmd: m[1], nums: m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number) }));
}

describe('buildWirePath', () => {
  it('returns empty / move-only paths for degenerate inputs', () => {
    expect(buildWirePath([])).toBe('');
    expect(buildWirePath([{ x: 1, y: 2 }])).toBe('M1 2');
  });

  it('draws one cubic between two points that starts and ends on the pins', () => {
    const d = buildWirePath([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    const c = commands(d);
    expect(c.map((x) => x.cmd)).toEqual(['M', 'C']);
    expect(c[0].nums).toEqual([0, 0]);
    expect(c[1].nums.slice(4)).toEqual([10, 0]);
  });

  it('sags downwards (y+) for a horizontal wire, regardless of direction', () => {
    for (const pts of [
      [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      [{ x: 10, y: 0 }, { x: 0, y: 0 }],
    ]) {
      const c = commands(buildWirePath(pts))[1].nums;
      expect(c[1]).toBeGreaterThan(0);
      expect(c[3]).toBeGreaterThan(0);
    }
  });

  it('bows to the right for a vertical wire', () => {
    const c = commands(buildWirePath([{ x: 0, y: 0 }, { x: 0, y: 10 }]))[1].nums;
    expect(c[0]).toBeGreaterThan(0);
    expect(c[2]).toBeGreaterThan(0);
  });

  it('goes through every waypoint with one cubic per segment', () => {
    const pts = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }, { x: 15, y: 3 }];
    const c = commands(buildWirePath(pts));
    expect(c.filter((x) => x.cmd === 'C')).toHaveLength(3);
    const ends = c.filter((x) => x.cmd === 'C').map((x) => x.nums.slice(4));
    expect(ends).toEqual([[5, 5], [10, 0], [15, 3]]);
  });

  it('caps the sag for long wires', () => {
    expect(sagFor(2)).toBeCloseTo(0.2);
    expect(sagFor(100)).toBe(1.1);
  });
});

describe('endDirection', () => {
  it('points from an end towards its neighbour', () => {
    const pts = [{ x: 0, y: 0 }, { x: 0, y: 4 }, { x: 3, y: 4 }];
    expect(endDirection(pts, true)).toEqual({ x: 0, y: 1 });
    expect(endDirection(pts, false)).toEqual({ x: -1, y: 0 });
  });
});

describe('flowParams', () => {
  it('is inactive at or below 0.05 mA', () => {
    expect(flowParams(0).active).toBe(false);
    expect(flowParams(undefined).active).toBe(false);
    expect(flowParams(FLOW_THRESHOLD_A).active).toBe(false);
    expect(flowParams(Number.NaN).active).toBe(false);
  });

  it('animates faster for larger currents (log scale)', () => {
    const small = flowParams(0.2e-3);
    const led = flowParams(20e-3);
    const big = flowParams(0.4);
    expect(small.active && led.active && big.active).toBe(true);
    expect(led.durationS).toBeLessThan(small.durationS);
    expect(big.durationS).toBeLessThan(led.durationS);
    expect(big.durationS).toBeGreaterThan(0.05);
  });

  it('uses the sign for the direction', () => {
    expect(flowParams(10e-3).reverse).toBe(false);
    expect(flowParams(-10e-3).reverse).toBe(true);
  });
});

describe('closestSegment', () => {
  it('finds the polyline segment nearest to a point', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(closestSegment(pts, { x: 4, y: 1 })).toBe(0);
    expect(closestSegment(pts, { x: 11, y: 6 })).toBe(1);
  });
});
