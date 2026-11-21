// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { ProgramIR } from '@/contracts';
import * as Blockly from 'blockly';
import { createHeadlessWorkspace, irToWorkspace, loadSilently, workspaceToIR } from './index';
import { binding, collectIds, makeCtx, part, stripIds } from './testutil';
import type { WorkspaceState } from './types';

const ctx = makeCtx({
  parts: [
    part('led1', 'led', 'LED 1'),
    part('rgb1', 'led-rgb', 'LED RGB 1'),
    part('btn1', 'button', 'Botón 1'),
    part('pot1', 'potentiometer', 'Potenciómetro 1'),
    part('bz1', 'buzzer', 'Zumbador 1'),
    part('servo1', 'servo-sg90', 'Servo 1'),
    part('sw1', 'switch-slide', 'Interruptor 1'),
    part('ldr1', 'ldr', 'LDR 1'),
    part('m1', 'motor-dc', 'Motor 1'),
  ],
  bindings: [binding('led1', 'anode', 'D9')],
});

const num = (v: number) => ({ k: 'num' as const, v });

const RICH: ProgramIR = {
  version: 1,
  board: 'uno',
  variables: [
    { name: 'contador', type: 'number', init: 3 },
    { name: 'encendido', type: 'boolean' },
    { name: 'i', type: 'number' },
    { name: 'nivel', type: 'number' },
  ],
  setup: [
    { k: 'pinMode', pin: 'D7', mode: 'INPUT_PULLUP' },
    { k: 'serialPrint', value: { k: 'str', v: 'Hola' }, newline: true },
    { k: 'set', var: 'encendido', value: { k: 'bool', v: false } },
    { k: 'onboardLed', on: { k: 'bool', v: true } },
  ],
  loop: [
    {
      k: 'if',
      branches: [
        { cond: { k: 'buttonPressed', part: 'btn1' }, body: [{ k: 'led', part: 'led1', on: { k: 'bool', v: true } }] },
        {
          cond: { k: 'bin', op: '>', a: { k: 'potPercent', part: 'pot1' }, b: num(50) },
          body: [{ k: 'ledBrightness', part: 'led1', percent: { k: 'potPercent', part: 'pot1' } }],
        },
      ],
      else: [{ k: 'led', part: 'led1', on: { k: 'var', name: 'encendido' } }],
    },
    { k: 'if', branches: [{ cond: { k: 'buttonClicked', part: 'btn1' }, body: [{ k: 'set', var: 'encendido', value: { k: 'not', a: { k: 'var', name: 'encendido' } } }] }] },
    {
      k: 'repeat',
      times: num(3),
      body: [
        { k: 'buzzerTone', part: 'bz1', freq: num(440), ms: num(200) },
        { k: 'buzzerTone', part: 'bz1', freq: num(1000) },
        { k: 'delay', ms: { k: 'bin', op: '*', a: num(2), b: num(100) } },
        { k: 'buzzerOff', part: 'bz1' },
      ],
    },
    {
      k: 'for',
      var: 'i',
      from: num(0),
      to: num(180),
      by: num(10),
      body: [
        { k: 'servo', part: 'servo1', angle: { k: 'var', name: 'i' } },
        { k: 'if', branches: [{ cond: { k: 'bin', op: '>=', a: { k: 'var', name: 'i' }, b: num(170) } , body: [{ k: 'break' }] }] },
        { k: 'continue' },
      ],
    },
    { k: 'while', cond: { k: 'switchOn', part: 'sw1' }, body: [{ k: 'motor', part: 'm1', speed: num(75) }], until: true },
    { k: 'while', cond: { k: 'bin', op: '<', a: { k: 'millis' }, b: num(5000) }, body: [] },
    { k: 'waitUntil', cond: { k: 'bin', op: '&&', a: { k: 'bool', v: true }, b: { k: 'bin', op: '!=', a: { k: 'digitalRead', pin: 'D7' }, b: num(0) } } },
    { k: 'rgb', part: 'rgb1', r: num(255), g: num(0), b: num(0) },
    { k: 'rgb', part: 'rgb1', r: { k: 'random', min: num(0), max: num(255) }, g: num(12), b: num(34) },
    { k: 'digitalWrite', pin: 'D13', value: num(1) },
    { k: 'digitalWrite', pin: 'D12', value: { k: 'var', name: 'encendido' } },
    { k: 'analogWrite', pin: 'D10', value: { k: 'map', value: { k: 'analogRead', pin: 'A0' }, fromLow: num(0), fromHigh: num(1023), toLow: num(0), toHigh: num(255) } },
    { k: 'tone', pin: 'D8', freq: num(262), ms: num(100) },
    { k: 'tone', pin: 'D8', freq: num(330) },
    { k: 'noTone', pin: 'D8' },
    { k: 'change', var: 'contador', delta: num(1) },
    {
      k: 'set',
      var: 'nivel',
      value: {
        k: 'constrain',
        value: { k: 'bin', op: '%', a: { k: 'lightPercent', part: 'ldr1' }, b: { k: 'neg', a: { k: 'math', fn: 'round', a: { k: 'analogRaw', part: 'ldr1' } } } },
        low: num(0),
        high: num(100),
      },
    },
    { k: 'serialPrint', value: { k: 'var', name: 'nivel' }, newline: false },
    { k: 'serialPrint', value: num(42), newline: true },
    { k: 'call', name: 'parpadear' },
    { k: 'set', var: 'nivel', value: { k: 'bin', op: '/', a: { k: 'math', fn: 'sqrt', a: num(16) }, b: { k: 'math', fn: 'pow10', a: num(2) } } },
  ],
  functions: [
    {
      name: 'parpadear',
      body: [
        { k: 'onboardRgb', r: num(0), g: num(0), b: num(255) },
        { k: 'delay', ms: num(250) },
        { k: 'onboardLed', on: { k: 'bin', op: '||', a: { k: 'bool', v: false }, b: { k: 'bool', v: true } } },
      ],
    },
    { name: 'vacía', body: [] },
  ],
};

describe('irToWorkspace ↔ workspaceToIR', () => {
  it('round-trips a rich program (modulo ids)', () => {
    const { workspace, errors } = irToWorkspace(RICH, ctx);
    expect(errors).toEqual([]);
    const back = workspaceToIR(workspace, ctx);
    expect(back.errors).toEqual([]);
    expect(stripIds(back.ir)).toEqual(stripIds(RICH));
  });

  it('keeps node ids stable and gives every node a unique id', () => {
    const withIds: ProgramIR = {
      ...RICH,
      setup: [{ k: 'delay', id: 'mi-delay', ms: { k: 'num', id: 'mi-num', v: 5 } }],
      functions: [{ id: 'fn-1', name: 'f', body: [] }],
    };
    const { workspace } = irToWorkspace(withIds, ctx);
    const first = workspaceToIR(workspace, ctx).ir;
    expect(first.setup[0]).toEqual({ k: 'delay', id: 'mi-delay', ms: { k: 'num', id: 'mi-num', v: 5 } });
    expect(first.functions[0].id).toBe('fn-1');
    const ids = collectIds(first);
    expect(new Set(ids).size).toBe(ids.length);
    // Every node carries an id (deterministic when the IR had none).
    const loopIf = first.loop[0];
    expect(loopIf.id).toMatch(/^p:loop\.0$/);
    // A second round trip is the identity, ids included.
    const again = workspaceToIR(irToWorkspace(first, ctx).workspace, ctx).ir;
    expect(again).toEqual(first);
  });

  it('survives an editor save/load cycle (Blockly serialization + variable metadata)', () => {
    const { workspace } = irToWorkspace(RICH, ctx);
    const ws = createHeadlessWorkspace();
    try {
      expect(loadSilently(ws, workspace, ctx)).toBeNull();
      const saved = Blockly.serialization.workspaces.save(ws);
      expect(saved.cvVariables).toBeTruthy();
      const back = workspaceToIR(JSON.parse(JSON.stringify(saved)), ctx);
      expect(back.errors).toEqual([]);
      expect(back.ir).toEqual(workspaceToIR(workspace, ctx).ir);
    } finally {
      ws.dispose();
    }
  });

  it('auto-declares referenced variables and normalizes missing lists', () => {
    const { workspace, errors } = irToWorkspace({ setup: [], loop: [{ k: 'set', var: 'x', value: { k: 'bool', v: true } }] });
    expect(errors).toEqual([]);
    const ws = workspace as WorkspaceState;
    expect(ws.variables).toEqual([{ name: 'x', id: 'v:x' }]);
    const { ir } = workspaceToIR(workspace, ctx);
    expect(ir.variables).toEqual([{ name: 'x', type: 'boolean' }]);
    expect(ir.functions).toEqual([]);
    expect(ir.board).toBe('uno');
  });

  it('infers number when a variable is set to a number anywhere', () => {
    const { workspace } = irToWorkspace({
      setup: [{ k: 'set', var: 'a', value: { k: 'bool', v: true } }],
      loop: [{ k: 'set', var: 'a', value: num(3) }, { k: 'set', var: 'b', value: { k: 'var', name: 'a' } }],
    });
    const { ir } = workspaceToIR(workspace, ctx);
    expect(ir.variables).toEqual([
      { name: 'a', type: 'number' },
      { name: 'b', type: 'number' },
    ]);
  });

  it('reports invalid nodes instead of throwing', () => {
    const bad = {
      setup: [{ k: 'teleport' }, { nope: 1 }, { k: 'delay' }],
      loop: [{ k: 'led', part: 'led1', on: { k: 'str', v: 'x' } }, { k: 'if', branches: [] }],
      functions: [{ body: [] }],
    } as unknown as ProgramIR;
    const { workspace, errors } = irToWorkspace(bad, ctx);
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(errors.join('\n')).toContain('teleport');
    const back = workspaceToIR(workspace, ctx);
    expect(back.ir.setup.map((s) => s.k)).toEqual(['delay']);
    expect(back.ir.loop.map((s) => s.k)).toEqual(['led']);
  });

  it('places the two hats and keeps them as the program roots', () => {
    const { workspace } = irToWorkspace({ setup: [], loop: [] });
    const blocks = (workspace as WorkspaceState).blocks!.blocks;
    expect(blocks.map((b) => b.type)).toEqual(['cv_setup', 'cv_loop']);
    expect(blocks[1].y!).toBeGreaterThan(blocks[0].y!);
  });
});

describe('workspaceToIR', () => {
  it('returns an empty program for a null workspace', () => {
    const { ir, errors } = workspaceToIR(null, ctx);
    expect(ir).toEqual({ version: 1, board: 'uno', variables: [], setup: [], loop: [], functions: [] });
    expect(errors).toEqual([]);
  });

  it('ignores stray top-level blocks and reports them', () => {
    const ws: WorkspaceState = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'cv_setup', id: 's', x: 0, y: 0 },
          { type: 'cv_loop', id: 'l', x: 0, y: 200, inputs: { DO: { block: { type: 'cv_delay', id: 'd', inputs: { MS: { shadow: { type: 'math_number', id: 'n', fields: { NUM: 10 } } } } } } } },
          { type: 'cv_delay', id: 'stray', x: 400, y: 0, inputs: { MS: { shadow: { type: 'math_number', id: 'n2', fields: { NUM: 1 } } } } },
        ],
      },
    };
    const { ir, errors } = workspaceToIR(ws, ctx);
    expect(ir.loop).toEqual([{ k: 'delay', id: 'd', ms: { k: 'num', id: 'n', v: 10 } }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/suelto/);
  });

  it('keeps references to parts that do not exist (no rewrite on load)', () => {
    const { workspace } = irToWorkspace({ setup: [], loop: [{ k: 'led', part: 'led9', on: { k: 'bool', v: true } }, { k: 'digitalWrite', pin: 'GPIO4', value: num(0) }] });
    const { ir } = workspaceToIR(workspace, ctx);
    expect(ir.loop[0]).toMatchObject({ k: 'led', part: 'led9' });
    expect(ir.loop[1]).toMatchObject({ k: 'digitalWrite', pin: 'GPIO4' });
  });
});
