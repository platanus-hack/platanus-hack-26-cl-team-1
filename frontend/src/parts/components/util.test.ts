import { describe, expect, it } from 'vitest';
import { bool, knobAngle, mix, num, rgbLedColor, servoAngle, spinSeconds, str } from './util';
import { potCode } from './Potentiometer';
import { serpentinePoints } from './Ldr';

describe('prop parsing', () => {
  it('num accepts numbers and numeric strings, falls back otherwise', () => {
    expect(num(220, 1)).toBe(220);
    expect(num('4700', 1)).toBe(4700);
    expect(num('abc', 7)).toBe(7);
    expect(num(undefined, 7)).toBe(7);
    expect(num(true, 7)).toBe(7);
  });
  it('bool / str', () => {
    expect(bool(true)).toBe(true);
    expect(bool('true')).toBe(true);
    expect(bool(false)).toBe(false);
    expect(bool(undefined)).toBe(false);
    expect(str('b', 'a')).toBe('b');
    expect(str('', 'a')).toBe('a');
    expect(str(3, 'a')).toBe('3');
  });
});

describe('colour helpers', () => {
  it('mix blends linearly', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#ff0000', '#0000ff', 0)).toBe('#ff0000');
    expect(mix('#ff0000', '#0000ff', 2)).toBe('#0000ff');
  });
  it('rgbLedColor normalises the hue and reports intensity', () => {
    expect(rgbLedColor(undefined)).toBeNull();
    expect(rgbLedColor([0, 0, 0])).toBeNull();
    expect(rgbLedColor([0.5, 0, 0.5])).toEqual({ hex: '#ff00ff', intensity: 0.5 });
    expect(rgbLedColor([Number.NaN, 1, 0])).toEqual({ hex: '#00ff00', intensity: 1 });
  });
});

describe('animation / geometry helpers', () => {
  it('spinSeconds = clamp(0.15/|speed|)', () => {
    expect(spinSeconds(undefined)).toBeNull();
    expect(spinSeconds(0)).toBeNull();
    expect(spinSeconds(1)).toBeCloseTo(0.15);
    expect(spinSeconds(-0.5)).toBeCloseTo(0.3);
    expect(spinSeconds(0.03)).toBe(3);
    expect(spinSeconds(Number.NaN)).toBeNull();
  });
  it('knobAngle maps 0..100 to −135..135', () => {
    expect(knobAngle(0)).toBe(-135);
    expect(knobAngle(50)).toBe(0);
    expect(knobAngle(100)).toBe(135);
    expect(knobAngle(150)).toBe(135);
    expect(knobAngle(Number.NaN)).toBe(0);
  });
  it('servoAngle defaults to 90 and clamps', () => {
    expect(servoAngle(undefined)).toBe(90);
    expect(servoAngle(200)).toBe(180);
    expect(servoAngle(-3)).toBe(0);
  });
  it('potCode prints the 3-digit resistance code', () => {
    expect(potCode(10000)).toBe('103');
    expect(potCode(1000)).toBe('102');
    expect(potCode(100000)).toBe('104');
    expect(potCode(4700)).toBe('472');
  });
  it('LDR serpentine stays inside the sensor window', () => {
    const pts = serpentinePoints();
    expect(pts.length).toBe(14);
    for (const [x, y] of pts) expect(Math.hypot(x - 1, y - 1.12)).toBeLessThanOrEqual(0.7);
  });
});
