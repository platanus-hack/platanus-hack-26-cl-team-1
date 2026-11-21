// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSimSummary, ProjectSummary, ToolName } from '@/contracts';
import { createStarterProject } from '@/store/newProject';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { TOOL_DEFS } from './schema';
import { executeTool, IMPLEMENTED_TOOLS, type ToolExecContext } from './tools';

const GROUP = 'agent-test-turn';
const ctx = (over: Partial<ToolExecContext> = {}): ToolExecContext => ({
  toolUseId: 'toolu_x',
  group: GROUP,
  askUser: async () => ({ choiceId: 'a' }),
  ...over,
});
const run = (name: ToolName, input: unknown, c = ctx()) => executeTool(name, input, c) as Promise<Record<string, unknown>>;

beforeEach(() => {
  useProject.getState().replaceProject(createStarterProject('uno'));
});

describe('executeTool (real modules)', () => {
  it('implements every tool in agent-tools.json', () => {
    expect([...IMPLEMENTED_TOOLS].sort()).toEqual(TOOL_DEFS.map((t) => t.name).sort());
  });

  it('validates inputs and returns Spanish errors instead of throwing', async () => {
    expect(await run('add_part', {})).toEqual({ error: expect.stringMatching(/falta el campo «type»/) });
    expect(await run('add_part', { type: 'flux-capacitor' })).toEqual({ error: expect.stringMatching(/No existe el tipo/) });
    expect(await run('add_part', { type: 'led', props: { color: 'fucsia' } })).toEqual({ error: expect.stringMatching(/Opciones/) });
    expect(await run('remove_part', { id: 'nada' })).toEqual({ error: expect.stringMatching(/No existe el componente «nada»/) });
    expect(await run('connect', { from: 'uno1.D99', to: 'bb1.a1' })).toEqual({ error: expect.stringMatching(/no tiene el pin «D99»/) });
    expect(await run('disconnect', {})).toEqual({ error: expect.stringMatching(/wire_id/) });
    expect(await run('load_example', { example_id: 'nope' })).toHaveProperty('error');
  });

  it('builds a blink circuit as one undo group, writes the program and simulates it', async () => {
    const r = await run('add_part', { type: 'resistor', label: 'R1', props: { resistance: 220 } });
    expect(r).toMatchObject({ id: 'r1', label: 'R1' });
    const led = await run('add_part', { type: 'led', label: 'LED rojo', props: { color: 'rojo' } });
    expect(led).toMatchObject({ id: 'led1' });
    expect(useProject.getState().project.parts.find((p) => p.id === 'led1')?.props.color).toBe('red');

    for (const [from, to, color] of [
      ['uno1.GND1', 'bb1.T-1', 'black'],
      ['uno1.D13', 'r1.a', 'yellow'],
      ['r1.b', 'led1.anode', 'orange'],
      ['led1.cathode', 'bb1.T-14', 'black'],
    ]) {
      const w = await run('connect', { from, to, color });
      expect(w, `${from} → ${to}`).toHaveProperty('wire_id');
    }

    const summary = (await run('get_project', {})) as unknown as ProjectSummary;
    expect(summary.board).toBe('uno');
    expect(summary.parts.find((p) => p.id === 'bb1')?.pins).toEqual([]);
    expect(summary.bindings.find((b) => b.part === 'led1')).toMatchObject({ boardPin: 'D13' });

    const checks = await run('run_checks', {});
    expect(Array.isArray(checks.issues)).toBe(true);

    const prog = await run('set_program', {
      program: {
        setup: [],
        loop: [
          { k: 'led', part: 'led1', on: { k: 'bool', v: true } },
          { k: 'delay', ms: { k: 'num', v: 500 } },
          { k: 'led', part: 'led1', on: { k: 'bool', v: false } },
          { k: 'delay', ms: { k: 'num', v: 500 } },
        ],
      },
    });
    expect(prog).toMatchObject({ ok: true });
    expect(String(prog.code)).toContain('void loop()');
    expect(useProject.getState().project.program.workspace).not.toBeNull();

    const code = await run('get_code', {});
    expect(code).toMatchObject({ board: 'uno' });

    const sim = (await run('simulate', { duration_ms: 2200 })) as unknown as AgentSimSummary;
    expect(sim.error).toBeUndefined();
    const ledChanges = sim.changes.filter((c) => c.part === 'led1');
    expect(ledChanges.length).toBeGreaterThanOrEqual(3);
    expect(sim.per_part.led1).toMatchObject({ min: 0 });
    expect(sim.per_part.led1.max).toBeGreaterThan(0.5);

    // Every change of the turn is ONE history entry → one undo restores the starter project.
    const past = useProject.getState().past;
    expect(past.filter((e) => e.group === GROUP)).toHaveLength(1);
    expect(past[past.length - 1]).toMatchObject({ source: 'agent', group: GROUP });
    expect(useProject.getState().undoGroup(GROUP)).toBe(true);
    expect(useProject.getState().project.parts.map((p) => p.id)).toEqual(['uno1', 'bb1']);
  });

  it('rejects an invalid program without touching the project', async () => {
    const before = useProject.getState().project;
    const res = await run('set_program', { program: { setup: [], loop: [{ k: 'led', part: 'led9', on: { k: 'bool', v: true } }] } });
    expect(res).toHaveProperty('error');
    expect(useProject.getState().project).toBe(before);
  });

  it('asks the user, highlights, switches view, loads examples and starts over', async () => {
    const ans = await run('ask_user', { question: '¿Qué placa?', options: [{ id: 'a', label: 'Uno' }, { id: 'b', label: 'ESP32' }] });
    expect(ans).toEqual({ choice_id: 'a' });
    expect(await run('ask_user', { question: '?', options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] })).toHaveProperty('error');

    expect(await run('highlight', { targets: ['uno1', 'zzz'], message: 'Mira aquí' })).toEqual({ ok: true });
    expect(useUI.getState().highlight?.targets).toEqual(['uno1']);
    expect(await run('highlight', { targets: ['zzz'] })).toHaveProperty('error');

    expect(await run('switch_view', { view: 'schematic' })).toEqual({ ok: true });
    expect(useUI.getState().currentView()).toBe('schematic');

    const ex = await run('load_example', { example_id: 'blink-uno' });
    expect(ex).toMatchObject({ ok: true, name: 'Parpadeo (Arduino)' });
    expect(useProject.getState().project.meta.exampleId).toBe('blink-uno');

    expect(await run('new_project', { board: 'esp32c6' })).toEqual({ ok: true });
    expect(useProject.getState().project.parts.some((p) => p.type === 'esp32c6-devkit')).toBe(true);
    expect(await run('new_project', { board: null })).toEqual({ ok: true });
    expect(useProject.getState().project.parts.map((p) => p.type)).toEqual(['breadboard-half']);
  });
});
