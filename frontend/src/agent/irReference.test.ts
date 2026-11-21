// @vitest-environment jsdom
/**
 * shared/ir-reference.md is pasted into the system prompt: the model copies its
 * examples, so they must pass the same validation set_program applies.
 */
import { describe, expect, it } from 'vitest';
import { buildExample } from '@/examples';
import { useProject } from '@/store/project';
import refText from '../../../shared/ir-reference.md?raw';
import { executeTool } from './tools';

const ctx = { toolUseId: 't', group: 'g', askUser: async () => ({ choiceId: 'a' }) };

function jsonBlocks(md: string): unknown[] {
  return [...md.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => JSON.parse(m[1]));
}

describe('ir-reference.md', () => {
  it('every example program is accepted by set_program on a matching project', async () => {
    const blocks = jsonBlocks(refText);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const [general, ...examples] = blocks as Array<Record<string, unknown>>;
    expect(general).toHaveProperty('setup');
    const projects = ['blink-uno', 'button-led-uno', 'servo-pot-uno'];
    for (const [i, program] of examples.entries()) {
      useProject.getState().replaceProject(buildExample(projects[i]));
      const res = await executeTool('set_program', { program }, ctx);
      expect(res, `ejemplo ${i + 1} en ${projects[i]}`).toMatchObject({ ok: true });
    }
  });

  it('documents the facts the validator / codegen enforce', () => {
    expect(refText).toMatch(/grados/); // sin/cos take degrees (contracts/ir.ts MathFn)
    expect(refText).not.toMatch(/`GPIO0`\.\.`GPIO23`(?![^\n]*GPIO14)/); // the C6 devkit has no GPIO14
  });
});
