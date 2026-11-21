import { describe, expect, it } from 'vitest';
import { describeBands, resistorBands } from './resistorBands';

describe('resistorBands', () => {
  it.each([
    [220, ['red', 'red', 'brown', 'gold']],
    [10000, ['brown', 'black', 'orange', 'gold']],
    [4700, ['yellow', 'violet', 'red', 'gold']],
    [100, ['brown', 'black', 'brown', 'gold']],
    [330, ['orange', 'orange', 'brown', 'gold']],
    [470, ['yellow', 'violet', 'brown', 'gold']],
    [1000, ['brown', 'black', 'red', 'gold']],
    [2200, ['red', 'red', 'red', 'gold']],
    [100000, ['brown', 'black', 'yellow', 'gold']],
    [1_000_000, ['brown', 'black', 'green', 'gold']],
    [10, ['brown', 'black', 'black', 'gold']],
    [47, ['yellow', 'violet', 'black', 'gold']],
    [4.7, ['yellow', 'violet', 'gold', 'gold']],
    [1, ['brown', 'black', 'gold', 'gold']],
    [0.47, ['yellow', 'violet', 'silver', 'gold']],
  ])('%d Ω → %j', (ohms, bands) => {
    expect(resistorBands(ohms)).toEqual(bands);
  });

  it('rounds to two significant digits', () => {
    expect(resistorBands(4699)).toEqual(['yellow', 'violet', 'red', 'gold']);
    expect(resistorBands(996)).toEqual(['brown', 'black', 'red', 'gold']); // → 1.0 kΩ
  });

  it('handles zero and invalid input', () => {
    expect(resistorBands(0)).toEqual(['black']);
    expect(resistorBands(-5)).toEqual(['black']);
    expect(resistorBands(Number.NaN)).toEqual(['black']);
  });

  it('clamps huge values to the white multiplier', () => {
    expect(resistorBands(1e13)).toEqual(['white', 'white', 'white', 'gold']);
  });

  it('describes bands in Spanish', () => {
    expect(describeBands(220)).toBe('rojo, rojo, café, dorado');
  });
});
