import { describe, expect, it } from 'vitest';
import { solveCircuit } from '@/circuit';
import { getNetlist } from '@/store/derived';
import { createStarterProject } from '@/store/newProject';
import { MSG, spanishList } from './messages';

describe('short-circuit toast text', () => {
  it('does not repeat "¡Cortocircuito!" when the solver message already starts with it', () => {
    const p0 = createStarterProject('uno');
    const p = { ...p0, wires: [{ id: 'w1', from: 'uno1.5V', to: 'uno1.GND1', color: 'red' as const }] };
    const r = solveCircuit(p, getNetlist(p), { drives: {}, runtime: {}, burned: [], servoAngles: {}, onboardRgb: null });
    expect(r.shorts.length).toBeGreaterThan(0);
    for (const s of r.shorts) {
      const text = MSG.short(s);
      expect(text.startsWith('¡Cortocircuito!')).toBe(true);
      expect(text.match(/¡Cortocircuito!/g)).toHaveLength(1);
    }
  });

  it('prefixes a bare solver message and falls back to the generic text', () => {
    expect(MSG.short({ parts: ['bat1'], nets: [], currentA: 9, message: 'Los polos de la batería están unidos.' })).toBe(
      '¡Cortocircuito! Los polos de la batería están unidos.',
    );
    expect(MSG.short({ parts: [], nets: [], currentA: 9, message: '' })).toMatch(/^¡Cortocircuito! La corriente va directo/);
  });
});

describe('burn toasts', () => {
  it('lists several parts in correct Spanish', () => {
    expect(spanishList(['LED 1'])).toBe('LED 1');
    expect(spanishList(['LED 1', 'LED 2'])).toBe('LED 1 y LED 2');
    expect(spanishList(['A', 'B', 'C'])).toBe('A, B y C');
    expect(spanishList(['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A, B, C, D y 2 más');
    expect(MSG.burnedMany(['LED 1', 'LED 2'])).toBe('¡Se quemaron LED 1 y LED 2! Pasó demasiada corriente… agrega una resistencia de 220 Ω a cada uno');
  });
});
