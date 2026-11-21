import { describe, expect, it } from 'vitest';
import type { ApiMessage, PartDef } from '@/contracts';
import { findPartDef } from '@/catalog';
import { closeDangling, danglingToolUses, MAX_RESULT_CHARS, resultContent, STOPPED_TEXT, studentText, toolResultBlock } from './history';
import { normalizeProps } from './props';

const assistant: ApiMessage = {
  role: 'assistant',
  content: [
    { type: 'thinking', thinking: '', signature: 's' },
    { type: 'text', text: 'Voy' },
    { type: 'tool_use', id: 't1', name: 'add_part', input: { type: 'led' } },
    { type: 'tool_use', id: 't2', name: 'ask_user', input: { question: '?', options: [] } },
  ],
};

describe('history helpers', () => {
  it('finds tool_use blocks left unanswered by the last assistant message', () => {
    expect(danglingToolUses([{ role: 'user', content: 'hola' }, assistant]).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(danglingToolUses([{ role: 'user', content: 'hola' }])).toEqual([]);
  });

  it('closes dangling tool_use: keeps partial results, answers ask_user, errors the rest', () => {
    const partial = toolResultBlock('t1', { id: 'led1', label: 'LED 1' });
    const out = closeDangling(danglingToolUses([assistant]), { t1: partial }, { t2: { choiceId: null, text: 'el rojo' } });
    expect(out[0]).toBe(partial);
    expect(out[1]).toEqual({ type: 'tool_result', tool_use_id: 't2', content: JSON.stringify({ choice_id: null, text: 'el rojo' }) });
    const stopped = closeDangling(danglingToolUses([assistant]), {});
    expect(stopped.every((b) => b.is_error === true && String(b.content).includes(STOPPED_TEXT))).toBe(true);
  });

  it('builds tool_result blocks with is_error and a 12 KB cap', () => {
    expect(toolResultBlock('x', { error: 'mal' })).toEqual({ type: 'tool_result', tool_use_id: 'x', content: '{"error":"mal"}', is_error: true });
    expect(toolResultBlock('x', { ok: true })).not.toHaveProperty('is_error');
    const big = resultContent({ code: 'x'.repeat(50_000) });
    expect(big.length).toBeLessThan(MAX_RESULT_CHARS + 200);
    expect(big).toMatch(/resultado truncado/);
  });

  it('extracts the student text, skipping <contexto_app>', () => {
    const m: ApiMessage = { role: 'user', content: [{ type: 'text', text: 'Hola' }, { type: 'text', text: '<contexto_app>{}</contexto_app>' }] };
    expect(studentText(m)).toBe('Hola');
  });
});

describe('normalizeProps', () => {
  const led = findPartDef('led') as PartDef;
  const resistor = findPartDef('resistor') as PartDef;
  const pot = findPartDef('potentiometer') as PartDef;

  it('coerces values and Spanish labels', () => {
    expect(normalizeProps(resistor, { resistance: '220' })).toEqual({ props: { resistance: 220 } });
    expect(normalizeProps(led, { color: 'Rojo' })).toEqual({ props: { color: 'red' } });
    expect(normalizeProps(pot, { position: 30 })).toEqual({ props: { position: 30 } });
  });

  it('rejects unknown keys and invalid values', () => {
    expect(normalizeProps(led, { brillo: 3 })).toMatchObject({ error: expect.stringMatching(/no tiene la propiedad «brillo»/) });
    expect(normalizeProps(resistor, { resistance: 123 })).toMatchObject({ error: expect.stringMatching(/Opciones: 100, 220/) });
    expect(normalizeProps(pot, { position: 150 })).toMatchObject({ error: expect.stringMatching(/entre 0 y 100/) });
  });
});
