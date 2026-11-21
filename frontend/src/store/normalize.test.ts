import { describe, expect, it } from 'vitest';
import { normalizeProject } from './normalize';
import { applyOp } from './applyOp';
import { createStarterProject } from './newProject';

describe('normalizeProject', () => {
  it('rejects non-projects', () => {
    expect(normalizeProject(null)).toBeNull();
    expect(normalizeProject({ version: 2, parts: [] })).toBeNull();
    expect(normalizeProject({ version: 1 })).toBeNull();
  });
  it('repairs missing props, wires, bad rotation and duplicate ids', () => {
    const p = normalizeProject({
      version: 1,
      name: 'x',
      parts: [{ id: 'led1', type: 'led', x: 1.6, y: 'a', rotation: 45 }, { id: 'led1', type: 'led' }, null],
    })!;
    expect(p.parts).toHaveLength(1);
    expect(p.parts[0]).toMatchObject({ props: {}, rotation: 0, x: 2, y: 0, label: 'led1' });
    expect(p.wires).toEqual([]);
    expect(p.program.workspace).toBeNull();
  });
  it('project.load normalizes and setProps works afterwards', () => {
    const start = createStarterProject('uno');
    const r = applyOp(start, { op: 'project.load', project: { version: 1, name: 'y', parts: [{ id: 'led1', type: 'led' }] } as never });
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    const r2 = applyOp(r.model, { op: 'part.setProps', id: 'led1', props: { color: 'blue' } });
    expect('error' in r2).toBe(false);
  });
});
