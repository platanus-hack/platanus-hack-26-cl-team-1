import { describe, expect, it } from 'vitest';
import { programChecks } from './index';
import { ir, led, makeCtx, num } from './testkit';

const codes = (issues: ReturnType<typeof programChecks>) => issues.map((i) => i.id).sort();

describe('programChecks', () => {
  it('no board → no program issues', () => {
    expect(programChecks(ir({ loop: [led('led1', true)] }), makeCtx(null, [], []))).toEqual([]);
  });

  it('block-unbound for an unwired part and for a deleted part', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }, { id: 'btn1', type: 'button', label: 'Botón 1' }], [
      { part: 'led1', boardPin: null },
      { part: 'btn1', boardPin: null },
    ]);
    const issues = programChecks(
      ir({ loop: [led('led1', true), led('ghost', true), { k: 'if', branches: [{ cond: { k: 'buttonPressed', part: 'btn1' }, body: [] }] }] }),
      ctx,
    );
    expect(codes(issues)).toEqual(['block-unbound:btn1', 'block-unbound:ghost', 'block-unbound:led1']);
    const led1 = issues.find((i) => i.id === 'block-unbound:led1')!;
    expect(led1).toMatchObject({ code: 'block-unbound', severity: 'warning', parts: ['led1'] });
    expect(led1.message).toContain('controlar');
    expect(issues.find((i) => i.id === 'block-unbound:btn1')!.message).toContain('leer');
    expect(led1.fix).toMatch(/resistencia/);
  });

  it('pin-not-analog for a potentiometer on a digital pin and analogRead(D7)', () => {
    const ctx = makeCtx('uno', [{ id: 'pot1', type: 'potentiometer', label: 'Pot 1' }], [{ part: 'pot1', boardPin: 'D7', mode: 'ANALOG' }]);
    const issues = programChecks(
      ir({ loop: [{ k: 'set', var: 'x', value: { k: 'potPercent', part: 'pot1' } }, { k: 'set', var: 'y', value: { k: 'analogRead', pin: 'D7' } }] }),
      ctx,
    );
    expect(codes(issues)).toEqual(['pin-not-analog:pot1', 'pin-not-analog:uno1.D7']);
    expect(issues[0].severity).toBe('error');
    expect(issues.find((i) => i.id === 'pin-not-analog:pot1')!.fix).toContain('A0');
  });

  it('pin-not-pwm for brightness / motor / analogWrite on non-PWM pins', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: 'D7' }]);
    const issues = programChecks(
      ir({ loop: [{ k: 'ledBrightness', part: 'led1', percent: num(50) }, { k: 'analogWrite', pin: 'D4', value: num(10) }, { k: 'analogWrite', pin: 'D5', value: num(10) }] }),
      ctx,
    );
    expect(codes(issues)).toEqual(['pin-not-pwm:led1', 'pin-not-pwm:uno1.D4']);
    expect(issues[0].fix).toContain('3, 5, 6, 9, 10, 11');
  });

  it('block-unsupported-board for onboardRgb on the Uno and unknown pins', () => {
    const issues = programChecks(ir({ loop: [{ k: 'onboardRgb', r: num(1), g: num(2), b: num(3) }, { k: 'digitalWrite', pin: 'GPIO4', value: num(1) }] }), makeCtx('uno', [], []));
    expect(codes(issues)).toEqual(['block-unsupported-board:onboardRgb', 'block-unsupported-board:pin.GPIO4']);
    expect(programChecks(ir({ loop: [{ k: 'onboardRgb', r: num(1), g: num(2), b: num(3) }] }), makeCtx('esp32c6', [], []))).toEqual([]);
  });

  it('timer-conflict: servo disables PWM on D9/D10, tone on D3/D11, one tone at a time', () => {
    const ctx = makeCtx('uno', [
      { id: 's1', type: 'servo-sg90', label: 'Servo 1' },
      { id: 'led1', type: 'led', label: 'LED 1' },
      { id: 'bz1', type: 'buzzer', label: 'Zumbador 1' },
      { id: 'bz2', type: 'buzzer', label: 'Zumbador 2' },
    ], [
      { part: 's1', boardPin: 'D6', pin: 'signal' },
      { part: 'led1', boardPin: 'D10' },
      { part: 'bz1', boardPin: 'D8' },
      { part: 'bz2', boardPin: 'D7' },
    ]);
    const issues = programChecks(
      ir({
        loop: [
          { k: 'servo', part: 's1', angle: num(90) },
          { k: 'ledBrightness', part: 'led1', percent: num(30) },
          { k: 'buzzerTone', part: 'bz1', freq: num(440) },
          { k: 'buzzerTone', part: 'bz2', freq: num(880) },
          { k: 'analogWrite', pin: 'D11', value: num(100) },
        ],
      }),
      ctx,
    );
    expect(codes(issues)).toEqual(['timer-conflict:bz1,bz2', 'timer-conflict:led1,s1', 'timer-conflict:uno1,bz1,bz2']);
    const servo = issues.find((i) => i.id === 'timer-conflict:led1,s1')!;
    expect(servo.message).toContain('pines 9 y 10');
    expect(servo.fix).not.toMatch(/\b10\b/);
  });

  it('ids are stable across runs', () => {
    const ctx = makeCtx('uno', [{ id: 'led1', type: 'led', label: 'LED 1' }], [{ part: 'led1', boardPin: null }]);
    const p = ir({ loop: [led('led1', true)] });
    expect(programChecks(p, ctx)).toEqual(programChecks(p, ctx));
  });
});
