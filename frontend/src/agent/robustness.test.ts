// @vitest-environment jsdom
/**
 * Bug-hunt regressions for agent tools on REAL projects (no mocks): add_part
 * rotation, simulate input validation, tool_result size budget.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSimSummary, ProjectSummary, ToolName } from '@/contracts';
import { buildExample } from '@/examples';
import { createStarterProject } from '@/store/newProject';
import { useProject } from '@/store/project';
import { MAX_RESULT_CHARS, resultContent, toolResultBlock } from './history';
import { executeTool, type ToolExecContext } from './tools';

const ctx: ToolExecContext = { toolUseId: 'toolu_r', group: 'agent-robust', askUser: async () => ({ choiceId: 'a' }) };
const run = (name: ToolName, input: unknown) => executeTool(name, input, ctx) as Promise<Record<string, unknown>>;

beforeEach(() => {
  useProject.getState().replaceProject(createStarterProject('uno'));
});

describe('add_part', () => {
  it('honours the requested rotation', async () => {
    const r = await run('add_part', { type: 'resistor', label: 'R1', rotation: 90 });
    expect(r).toMatchObject({ id: 'r1' });
    expect(useProject.getState().project.parts.find((p) => p.id === 'r1')?.rotation).toBe(90);

    const led = await run('add_part', { type: 'led', placement: 'free', rotation: 180 });
    expect(led).toHaveProperty('id');
    expect(useProject.getState().project.parts.find((p) => p.id === led.id)?.rotation).toBe(180);
  });
});

describe('simulate inputs', () => {
  beforeEach(() => {
    useProject.getState().replaceProject(buildExample('button-led-uno'));
  });

  it('rejects a prop the part does not have instead of silently ignoring it', async () => {
    const res = await run('simulate', { duration_ms: 1500, inputs: [{ atMs: 500, part: 'btn1', prop: 'presionado', value: true }] });
    expect(res).toEqual({ error: expect.stringMatching(/pressed/) });
  });

  it('coerces "false" / 0 for boolean props (a truthy string must not press the button)', async () => {
    const sim = (await run('simulate', {
      duration_ms: 2000,
      inputs: [
        { atMs: 500, part: 'btn1', prop: 'pressed', value: 'true' },
        { atMs: 1000, part: 'btn1', prop: 'pressed', value: 'false' },
        { atMs: 1500, part: 'btn1', prop: 'pressed', value: 1 },
      ],
    })) as unknown as AgentSimSummary;
    expect(sim.error).toBeUndefined();
    const led = sim.changes.filter((c) => c.part === 'led1').map((c) => [c.t, c.state.brightness]);
    expect(led).toEqual([
      [0, 0],
      [500, expect.any(Number)],
      [1000, 0],
      [1500, expect.any(Number)],
    ]);
    expect(led[1][1]).toBeGreaterThan(0.3);
  });

  it('rejects out-of-range values for numeric runtime props', async () => {
    useProject.getState().replaceProject(buildExample('servo-pot-uno'));
    const res = await run('simulate', { duration_ms: 1000, inputs: [{ atMs: 100, part: 'pot1', prop: 'position', value: 250 }] });
    expect(res).toEqual({ error: expect.stringMatching(/position/) });
  });
});

describe('tool_result size budget', () => {
  it('a long serial-printing simulation stays valid JSON ≤ 12 KB and keeps per_part / issues', async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    const prog = await run('set_program', {
      program: {
        variables: [{ name: 'n', type: 'number', init: 0 }],
        setup: [],
        loop: [
          { k: 'change', var: 'n', delta: { k: 'num', v: 1 } },
          { k: 'serialPrint', value: { k: 'str', v: 'Lectura del sensor de luz número: ' }, newline: false },
          { k: 'serialPrint', value: { k: 'var', name: 'n' }, newline: true },
          { k: 'led', part: 'led1', on: { k: 'bool', v: true } },
          { k: 'delay', ms: { k: 'num', v: 60 } },
          { k: 'led', part: 'led1', on: { k: 'bool', v: false } },
          { k: 'delay', ms: { k: 'num', v: 60 } },
        ],
      },
    });
    expect(prog).toMatchObject({ ok: true });
    const sim = await run('simulate', { duration_ms: 20000 });
    expect(JSON.stringify(sim).length).toBeGreaterThan(MAX_RESULT_CHARS); // the raw summary is too big

    const block = toolResultBlock('t1', sim);
    const content = String(block.content);
    expect(content.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const parsed = JSON.parse(content) as AgentSimSummary & Record<string, unknown>;
    expect(parsed.per_part.led1).toMatchObject({ min: 0 });
    expect(parsed.issues).toEqual([]);
    expect(parsed.truncated).toBe(true);
    expect(parsed.changes.length).toBeGreaterThan(20);
    expect(parsed.serial.length).toBeGreaterThan(20);
    expect(block.is_error).toBeUndefined();
  });

  it('small payloads are untouched and non-object payloads fall back to plain truncation', () => {
    expect(resultContent({ ok: true })).toBe('{"ok":true}');
    const big = 'x'.repeat(MAX_RESULT_CHARS + 50);
    const s = resultContent(big);
    expect(s.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(s).toMatch(/resultado truncado/);
  });

  it('a long string field (compile log, code) is shortened keeping the JSON valid', () => {
    const payload = { ok: false, diagnostics: [], log_tail: 'error: '.repeat(3000) };
    const c = resultContent(payload);
    expect(c.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    const p = JSON.parse(c) as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(String(p.log_tail).length).toBeLessThan(MAX_RESULT_CHARS);
  });

  it('get_project of every example fits comfortably (compact summary)', async () => {
    for (const id of ['blink-uno', 'traffic-light-uno', 'rgb-esp32c6', 'motor-transistor-uno']) {
      useProject.getState().replaceProject(buildExample(id));
      const s = (await run('get_project', {})) as unknown as ProjectSummary;
      // ~4.3 K chars for the ESP32 RGB example (issues excluded: their Spanish texts vary).
      const len = JSON.stringify({ ...s, issues: [] }).length;
      expect(len, id).toBeLessThan(6000);
      // breadboard holes are never listed as pins; unconnected board pins are omitted
      expect(s.parts.find((p) => p.type === 'breadboard-half')?.pins).toEqual([]);
      const board = s.parts.find((p) => p.type === 'arduino-uno' || p.type === 'esp32c6-devkit');
      expect(board?.pins.every((p) => p.connectedTo.length > 0)).toBe(true);
    }
  });
});

describe('append-only history', () => {
  it('tools never mutate their tool_use input (it is the object stored in the history)', async () => {
    useProject.getState().replaceProject(buildExample('button-led-uno'));
    const cases: Array<[ToolName, Record<string, unknown>]> = [
      ['set_program', { program: { variables: [{ name: 'c', type: 'number' }], setup: [{ k: 'serialPrint', value: { k: 'str', v: 'hola' }, newline: true }], loop: [{ k: 'if', branches: [{ cond: { k: 'buttonPressed', part: 'btn1' }, body: [{ k: 'led', part: 'led1', on: { k: 'bool', v: true } }] }], else: [{ k: 'led', part: 'led1', on: { k: 'bool', v: false } }] }, { k: 'call', name: 'f' }], functions: [{ name: 'f', body: [{ k: 'delay', ms: { k: 'num', v: 1 } }] }] } }],
      ['simulate', { duration_ms: 1000, inputs: [{ atMs: 700, part: 'btn1', prop: 'pressed', value: 'true' }, { atMs: 200, part: 'btn1', prop: 'pressed', value: false }] }],
      ['add_part', { type: 'led', props: { color: 'rojo' } }],
      ['update_part', { id: 'led1', props: { color: 'verde' } }],
      ['ask_user', { question: 'q', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }],
      ['highlight', { targets: ['led1'], message: 'x' }],
    ];
    for (const [name, input] of cases) {
      const before = JSON.stringify(input);
      const res = await run(name, input);
      expect(res, name).not.toHaveProperty('error');
      expect(JSON.stringify(input), name).toBe(before);
    }
  });
});
