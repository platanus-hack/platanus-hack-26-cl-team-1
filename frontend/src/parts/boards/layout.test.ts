import { describe, expect, it } from 'vitest';
import { circlesPath, headerRuns, leadPath, ledColor, meanderPath, mixHex, n, parseHex, pinPoint, rectSubpath, rgbHex, smdPaths, squaresPath } from './layout';

/** Start points ("M x y") of every sub-path. */
function starts(d: string): Array<[number, number]> {
  return [...d.matchAll(/M(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe('n()', () => {
  it('rounds to 3 decimals and drops -0', () => {
    expect(n(1.23456)).toBe('1.235');
    expect(n(2)).toBe('2');
    expect(n(-0.0001)).toBe('0');
  });
});

describe('headerRuns', () => {
  it('splits a row on gaps larger than one pitch', () => {
    const pins = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 26].map((x) => ({ x, y: 1 }));
    const runs = headerRuns(pins);
    expect(runs.map((r) => [r.x0, r.x1, r.pins.length])).toEqual([
      [8, 17, 10],
      [19, 26, 8],
    ]);
  });

  it('groups by key and y, sorted top-to-bottom, unordered input ok', () => {
    const pins = [
      { x: 3, y: 10, h: 'J3' },
      { x: 18, y: 1, h: 'J1' },
      { x: 4, y: 10, h: 'J3' },
      { x: 17, y: 1, h: 'J1' },
    ];
    const runs = headerRuns(pins, (p) => p.h);
    expect(runs.map((r) => [r.y, r.x0, r.x1])).toEqual([
      [1, 17, 18],
      [10, 3, 4],
    ]);
  });

  it('handles an empty pin list', () => {
    expect(headerRuns([])).toEqual([]);
  });
});

describe('path builders', () => {
  it('squaresPath centres each square on its point', () => {
    const d = squaresPath([{ x: 2, y: 5 }, { x: 31, y: 20 }], 0.4);
    expect(starts(d)).toEqual([
      [1.8, 4.8],
      [30.8, 19.8],
    ]);
  });

  it('rounded squares start after the corner radius', () => {
    expect(starts(squaresPath([{ x: 2, y: 5 }], 0.4, 0.1))).toEqual([[1.9, 4.8]]);
    expect(rectSubpath(0, 0, 1, 1, 5)).toContain('a0.5 0.5'); // radius clamped to half the side
  });

  it('circlesPath starts at the left edge of each circle', () => {
    expect(starts(circlesPath([{ x: 6, y: 1 }], 0.6))).toEqual([[5.4, 1]]);
  });

  it('meanderPath alternates between the top and bottom edges', () => {
    const d = meanderPath(0, 1, 2, 5, 0.5);
    expect(d).toBe('M0 5V2H0.5V5H1V2');
    expect(meanderPath(1, 0, 0, 1, 0.5)).toBe('');
  });

  it('smdPaths emits one body and two caps per part', () => {
    const { body, caps } = smdPaths([{ x: 1, y: 1 }, { x: 3, y: 3, v: true, big: true }]);
    expect(starts(body)).toHaveLength(2);
    expect(starts(caps)).toHaveLength(4);
  });

  it('leadPath ends where the tinned tip starts (tip ends on the pin)', () => {
    const d = leadPath(2.6, 12.85, 2, 16, 1.15);
    expect(d.startsWith('M2.6 12.85C')).toBe(true);
    expect(d.endsWith(' 2 14.85')).toBe(true);
  });

  it('pinPoint finds a pin or falls back', () => {
    const pins = [{ id: 'plus', x: 5, y: 16 }];
    expect(pinPoint(pins, 'plus', { x: 0, y: 0 })).toEqual({ x: 5, y: 16 });
    expect(pinPoint(pins, 'minus', { x: 2, y: 16 })).toEqual({ x: 2, y: 16 });
  });
});

describe('colour helpers', () => {
  it('converts and mixes hex colours', () => {
    expect(rgbHex(1, 0.5, 0)).toBe('#ff8000');
    expect(parseHex('#0f0')).toEqual([0, 1, 0]);
    expect(parseHex('nope')).toEqual([0, 0, 0]);
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mixHex('#000000', '#ffffff', 7)).toBe('#ffffff');
  });

  it('ledColor normalises hue and reports intensity', () => {
    expect(ledColor(undefined)).toBeNull();
    expect(ledColor(null)).toBeNull();
    expect(ledColor([0, 0, 0])).toBeNull();
    expect(ledColor([0.2, 0, 0])).toEqual({ hex: '#ff0000', level: 0.2 });
    expect(ledColor([0.8, 0.1, 1])).toEqual({ hex: '#cc1aff', level: 1 });
    expect(ledColor([Number.NaN, 2, -1])).toEqual({ hex: '#00ff00', level: 1 });
  });
});
