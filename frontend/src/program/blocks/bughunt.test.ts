// @vitest-environment jsdom
/** Regression tests for block-editor defects (each one failed before its fix). */
import { describe, expect, it } from 'vitest';
import type { ProgramIR } from '@/contracts';
import { irToWorkspace, validateIR, workspaceToIR } from './index';
import { binding, makeCtx, part } from './testutil';
import { computeBlockWarnings, partWarning } from './warnings';

const ir = (p: Partial<ProgramIR>): ProgramIR => ({ version: 1, board: 'uno', variables: [], setup: [], loop: [], functions: [], ...p });

describe('block warnings (Spanish grammar)', () => {
  it('uses the feminine form for the photoresistor («Esta fotorresistencia … conectada»)', () => {
    const ctx = makeCtx({ parts: [part('ldr1', 'ldr', 'LDR 1'), part('led1', 'led', 'LED 1')], bindings: [] });
    expect(partWarning(ctx, 'ldr1')).toBe('Esta fotorresistencia (LDR) no está conectada a ningún pin de la placa');
    expect(partWarning(ctx, 'led1')).toBe('Este LED no está conectado a ningún pin de la placa');
    const w = computeBlockWarnings([{ id: 'b', type: 'cv_light_percent', getFieldValue: () => 'ldr1' }], ctx);
    expect(w.get('b')).not.toMatch(/^Este fotorresistencia/);
  });
});

describe('validateIR messages', () => {
  it('names the real kind of a non-signal pin (RESET is not a power pin)', () => {
    const ctx = makeCtx({ parts: [], bindings: [] });
    const r = validateIR(ir({ loop: [{ k: 'digitalWrite', pin: 'RESET', value: { k: 'num', v: 1 } }, { k: 'digitalWrite', pin: 'GND1', value: { k: 'num', v: 1 } }, { k: 'digitalWrite', pin: '5V', value: { k: 'num', v: 1 } }] }), ctx);
    expect(r.errors[0]).toMatch(/«RESET» no es un pin de señal \(es el pin de reinicio\)/);
    expect(r.errors[1]).toMatch(/«GND1» no es un pin de señal \(es tierra\)/);
    expect(r.errors[2]).toMatch(/«5V» no es un pin de señal \(es de alimentación\)/);
  });

  it('flags two functions whose names differ only in upper/lower case (Blockly renames one of them)', () => {
    const ctx = makeCtx({ parts: [part('led1', 'led', 'LED 1')], bindings: [binding('led1', 'anode', 'D13')] });
    const program = ir({
      functions: [{ name: 'Parpadear', body: [] }, { name: 'parpadear', body: [{ k: 'delay', ms: { k: 'num', v: 1 } }] }],
      loop: [{ k: 'call', name: 'parpadear' }],
    });
    // Blockly treats procedure names case-insensitively: the second definition becomes
    // «parpadear2» and the call silently points to a function that no longer exists.
    const back = workspaceToIR(irToWorkspace(program, ctx).workspace, ctx).ir;
    expect(back.functions.map((f) => f.name)).toEqual(['Parpadear', 'parpadear2']);
    expect(validateIR(program, ctx).errors).toContainEqual(expect.stringMatching(/functions\[1\]: hay dos funciones llamadas «Parpadear» y «parpadear»/));
  });
});
