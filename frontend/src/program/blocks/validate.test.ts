import { describe, expect, it } from 'vitest';
import type { ProgramIR } from '@/contracts';
import { emptyProgram } from '@/contracts';
import { validateIR } from './validate';
import { computeBlockWarnings } from './warnings';
import { binding, makeCtx, part } from './testutil';

const ctx = makeCtx({
  parts: [part('led1', 'led', 'LED 1'), part('btn1', 'button', 'Botón 1')],
  bindings: [binding('led1', 'anode', 'D9'), binding('btn1', 'a1', null, { mode: 'INPUT_PULLUP' })],
});

const prog = (p: Partial<ProgramIR>): ProgramIR => ({ ...emptyProgram('uno'), ...p });

describe('validateIR', () => {
  it('accepts a valid program', () => {
    const r = validateIR(
      prog({
        variables: [{ name: 'n', type: 'number' }],
        setup: [{ k: 'pinMode', pin: 'D7', mode: 'OUTPUT' }],
        loop: [
          { k: 'led', part: 'led1', on: { k: 'bool', v: true } },
          { k: 'analogWrite', pin: 'D9', value: { k: 'var', name: 'n' } },
          { k: 'serialPrint', value: { k: 'str', v: 'hola' }, newline: true },
        ],
      }),
      ctx,
    );
    expect(r.errors).toEqual([]);
  });

  it('reports unknown kinds, missing fields and misplaced text with node paths', () => {
    const r = validateIR(
      prog({
        loop: [
          { k: 'teleport' } as never,
          { k: 'delay' } as never,
          { k: 'repeat', times: { k: 'num', v: 2 }, body: [{ k: 'led', part: 'led1', on: { k: 'str', v: 'sí' } }] },
          { k: 'set', var: 'x', value: { k: 'bin', op: '^', a: { k: 'num', v: 1 }, b: { k: 'num', v: 2 } } } as never,
        ],
      }),
      ctx,
    );
    expect(r.errors).toEqual([
      'loop[0] (teleport): tipo de instrucción desconocido «teleport».',
      'loop[1] (delay): falta «ms».',
      'loop[2].body[0].on (str): el texto solo se puede usar en «imprimir».',
      'loop[3].value (bin): operador «^» desconocido.',
    ]);
    expect(r.warnings.some((w) => w.includes('«x» no está declarada'))).toBe(true);
  });

  it('checks parts: existence, allowed node kinds and wiring', () => {
    const r = validateIR(
      prog({
        loop: [
          { k: 'led', part: 'led9', on: { k: 'bool', v: true } },
          { k: 'servo', part: 'led1', angle: { k: 'num', v: 90 } },
          { k: 'if', branches: [{ cond: { k: 'buttonPressed', part: 'btn1' }, body: [] }] },
        ],
      }),
      ctx,
    );
    expect(r.errors).toEqual(['loop[0] (led): no existe el componente «led9».', 'loop[1] (servo): «LED 1» (LED) no admite «servo».']);
    expect(r.warnings).toEqual(['loop[2].branches[0].cond (buttonPressed): «Botón 1» no está conectado a ningún pin de la placa.']);
  });

  it('checks pins against the board capabilities', () => {
    const r = validateIR(
      prog({
        loop: [
          { k: 'analogRead', pin: 'D2' } as never,
          { k: 'set', var: 'v', value: { k: 'analogRead', pin: 'D2' } },
          { k: 'analogWrite', pin: 'D2', value: { k: 'num', v: 10 } },
          { k: 'digitalWrite', pin: 'GPIO4', value: { k: 'num', v: 1 } },
          { k: 'digitalWrite', pin: '5V', value: { k: 'num', v: 1 } },
          { k: 'digitalWrite', pin: 'SDA', value: { k: 'num', v: 1 } },
        ],
        variables: [{ name: 'v', type: 'number' }],
      }),
      ctx,
    );
    expect(r.errors).toEqual([
      'loop[0] (analogRead): «analogRead» es un valor, no una instrucción.',
      'loop[1].value (analogRead): el pin «D2» no puede leer valores analógicos.',
      'loop[3] (digitalWrite): el pin «GPIO4» no existe en Arduino Uno R3.',
      'loop[4] (digitalWrite): «5V» no es un pin de señal (es de alimentación).',
    ]);
    expect(r.warnings).toEqual([
      'loop[2] (analogWrite): el pin «D2» no tiene PWM: solo quedará apagado (< 128) o encendido.',
      'loop[5] (digitalWrite): «SDA» es otro nombre de «A4»; usa «A4».',
    ]);
  });

  it('checks functions, calls and loop-only statements', () => {
    const r = validateIR(
      prog({
        setup: [{ k: 'break' }, { k: 'call', name: 'nada' }],
        functions: [
          { name: 'f', body: [{ k: 'repeat', times: { k: 'num', v: 2 }, body: [{ k: 'continue' }] }] },
          { name: 'f', body: [] },
        ],
      }),
      ctx,
    );
    expect(r.errors).toEqual([
      'functions[1]: hay dos funciones llamadas «f».',
      'setup[0] (break): solo se puede usar dentro de un bucle.',
      'setup[1] (call): la función «nada» no existe.',
    ]);
  });

  it('needs a board for pin nodes', () => {
    const r = validateIR(prog({ loop: [{ k: 'digitalWrite', pin: 'D13', value: { k: 'num', v: 1 } }] }), makeCtx({ board: null }));
    expect(r.errors[0]).toMatch(/no hay placa/);
  });
});

describe('computeBlockWarnings', () => {
  it('warns on unbound or missing parts and missing pins', () => {
    const blocks = [
      { id: 'a', type: 'cv_led', getFieldValue: () => 'led1' },
      { id: 'b', type: 'cv_button_pressed', getFieldValue: () => 'btn1' },
      { id: 'c', type: 'cv_led', getFieldValue: () => 'led7' },
      { id: 'd', type: 'cv_digital_write', getFieldValue: () => 'GPIO4' },
      { id: 'e', type: 'cv_delay', getFieldValue: () => null },
    ];
    const ledUnbound = makeCtx({ parts: [part('led1', 'led', 'LED 1'), part('btn1', 'button', 'Botón 1')], bindings: [binding('led1', 'anode', null)] });
    const w = computeBlockWarnings(blocks, ledUnbound);
    expect(w.get('a')).toBe('Este LED no está conectado a ningún pin de la placa');
    expect(w.get('b')).toMatch(/^Este [a-záéíóúñ]+ no está conectado a ningún pin de la placa$/);
    expect(w.get('c')).toMatch(/ya no está en el circuito/);
    expect(w.get('d')).toMatch(/no existe en Arduino Uno R3/);
    expect(w.get('e')).toBeNull();
  });
});
