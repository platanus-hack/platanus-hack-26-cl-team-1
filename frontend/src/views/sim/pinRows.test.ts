import { describe, expect, it } from 'vitest';
import type { Binding, BoardProfile, CircuitResult, PartDef } from '@/contracts';
import { actuatorKey, buildPinRows, runtimeValue } from './pinRows';

const board = {
  pins: [
    { id: 'D2', label: '2' },
    { id: 'D9', label: '9' },
    { id: 'D13', label: '13' },
    { id: 'A0', label: 'A0' },
  ],
} as unknown as BoardProfile;

const bind = (part: string, boardPin: string | null, mode: Binding['mode']): Binding => ({
  part, pin: 'x', boardPin, codeName: boardPin, activeLow: false, mode, via: [],
});

const result = (boardPins: CircuitResult['boardPins']) => ({ boardPins }) as unknown as CircuitResult;

describe('buildPinRows', () => {
  it('lists bound and output pins in board order with Spanish modes', () => {
    const rows = buildPinRows(
      board,
      [bind('btn1', 'D2', 'INPUT_PULLUP'), bind('pot1', 'A0', 'ANALOG'), bind('led9', null, 'OUTPUT')],
      { D13: { mode: 'output', level: 1 }, D9: { mode: 'output', level: 1, duty: 0.5 }, D2: { mode: 'input_pullup', level: 0 } },
      result({
        D2: { volts: 5, currentA: 0, digital: 1 },
        D13: { volts: 4.9, currentA: 0.012, digital: 1 },
        A0: { volts: 2.5, currentA: 0, digital: 1, adc: 512 },
      }),
      new Map([['btn1', 'Botón 1'], ['pot1', 'Potenciómetro 1']]),
    );
    expect(rows.map((r) => [r.pin, r.label, r.modeLabel, r.valueText])).toEqual([
      ['D2', '2', 'PULL-UP', 'ALTO'],
      ['D9', '9', 'PWM', '50 %'],
      ['D13', '13', 'SALIDA', 'ALTO'],
      ['A0', 'A0', 'ANALÓGICA', '512'],
    ]);
    expect(rows[0].parts).toEqual(['Botón 1']);
    expect(rows[2].currentA).toBeCloseTo(0.012);
    expect(rows[1].volts).toBeNull();
  });

  it('shows tones and undriven bound pins as inputs', () => {
    const rows = buildPinRows(board, [bind('led1', 'D13', 'OUTPUT')], { D9: { mode: 'output', level: 1, duty: 0.5, toneHz: 440 } }, null, new Map());
    expect(rows.map((r) => [r.pin, r.modeLabel, r.valueText])).toEqual([
      ['D9', 'TONO', '440 Hz'],
      ['D13', 'ENTRADA', '—'],
    ]);
  });

  it('handles no board and no bindings', () => {
    expect(buildPinRows(null, [], {}, null, new Map())).toEqual([]);
  });
});

describe('actuator helpers', () => {
  const button = { electrical: { model: 'switch', kind: 'push', stateProp: 'pressed', onOhms: 0.1 }, props: [{ key: 'pressed', default: false }] } as unknown as PartDef;
  const pot = { electrical: { model: 'potentiometer', resistanceProp: 'resistance', positionProp: 'position' }, props: [{ key: 'position', default: 50 }] } as unknown as PartDef;

  it('finds the runtime prop of each interactive model', () => {
    expect(actuatorKey(button)).toBe('pressed');
    expect(actuatorKey(pot)).toBe('position');
  });

  it('resolves override → instance prop → default', () => {
    expect(runtimeValue({ position: 80 }, { position: 20 }, pot, 'position')).toBe(80);
    expect(runtimeValue(undefined, { position: 20 }, pot, 'position')).toBe(20);
    expect(runtimeValue({}, {}, pot, 'position')).toBe(50);
  });
});
