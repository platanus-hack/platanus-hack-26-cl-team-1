import { describe, expect, it } from 'vitest';
import examples from '../../../shared/examples.json';
import { TOOL_DEFS, TOOL_NAMES, validateSchema, validateToolInput } from './schema';

describe('tool contract', () => {
  it('ToolInputs keys == agent-tools.json names', () => {
    expect(Object.keys(TOOL_NAMES).sort()).toEqual(TOOL_DEFS.map((t) => t.name).sort());
  });

  it('load_example enum == shared/examples.json ids', () => {
    const def = TOOL_DEFS.find((t) => t.name === 'load_example')!;
    const enumIds = def.input_schema.properties!.example_id.enum as string[];
    expect([...enumIds].sort()).toEqual((examples as Array<{ id: string }>).map((e) => e.id).sort());
  });
});

describe('validateToolInput', () => {
  it('accepts valid inputs', () => {
    expect(validateToolInput('get_project', {})).toBeNull();
    expect(validateToolInput('add_part', { type: 'led', props: { color: 'red' }, placement: 'auto' })).toBeNull();
    expect(validateToolInput('connect', { from: 'uno1.D13', to: 'r1.a', color: 'yellow' })).toBeNull();
    expect(validateToolInput('simulate', { duration_ms: 3000, inputs: [{ atMs: 500, part: 'btn1', prop: 'pressed', value: true }] })).toBeNull();
    expect(validateToolInput('new_project', { board: null })).toBeNull();
    expect(validateToolInput('set_program', { program: { setup: [], loop: [{ k: 'delay', ms: { k: 'num', v: 1 } }] } })).toBeNull();
  });

  it('reports missing / wrong / unknown fields in Spanish', () => {
    expect(validateToolInput('add_part', {})).toMatch(/falta el campo «type»/);
    expect(validateToolInput('connect', { from: 'a.b', to: 3 })).toMatch(/«to» debe ser texto/);
    expect(validateToolInput('connect', { from: 'a.b', to: 'c.d', color: 'pink' })).toMatch(/«color» debe ser uno de/);
    expect(validateToolInput('remove_part', { id: 'led1', extra: true })).toMatch(/campo desconocido «extra»/);
    expect(validateToolInput('move_part', { id: 'led1', x: 1.5, y: 2 })).toMatch(/«x» debe ser un número entero/);
    expect(validateToolInput('simulate', { duration_ms: 50 })).toMatch(/≥ 100/);
    expect(validateToolInput('simulate', { duration_ms: 500, inputs: [{ atMs: 1, part: 'b' }] })).toMatch(/inputs\[0\]\.prop/);
    expect(validateToolInput('ask_user', { question: '¿?', options: [{ id: 'a', label: 'A' }] })).toMatch(/al menos 2/);
    expect(validateToolInput('update_part', { id: 'r1', rotation: 45 })).toMatch(/rotation/);
    expect(validateToolInput('get_project', 'hola')).toMatch(/debe ser un objeto/);
    expect(validateToolInput('nope', {})).toMatch(/desconocida/);
  });

  it('supports union types', () => {
    expect(validateSchema(true, { type: ['boolean', 'number', 'string'] })).toEqual([]);
    expect(validateSchema(null, { type: ['boolean', 'number'] })).toHaveLength(1);
  });
});
