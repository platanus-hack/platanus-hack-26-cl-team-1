/**
 * Program issues for the editor UI: errors carry the block they are about and
 * no IR paths; a disabled «repetir para siempre» does not run; codegen marks the
 * auto-added setup lines.
 */
import { describe, expect, it } from 'vitest';
import type { ProjectModel } from '@/contracts';
import { buildExample } from '@/examples';
import { generateCode } from '@/program/codegen';
import { programContext } from '@/program/context';
import { getProgramErrors, getProgramIR, getProgramIssues, workspaceToIR } from '.';
import { B } from './kinds';

type BlockJson = { type: string; id: string; disabledReasons?: string[]; [k: string]: unknown };

const topBlocks = (p: ProjectModel) => (p.program.workspace as { blocks: { blocks: BlockJson[] } }).blocks.blocks;

/** Same project with a fresh program object (the memo is keyed on it). */
function withProgram(p: ProjectModel, edit: (blocks: BlockJson[]) => void): ProjectModel {
  const workspace = structuredClone(p.program.workspace) as { blocks: { blocks: BlockJson[] } };
  edit(workspace.blocks.blocks);
  return { ...p, program: { ...p.program, workspace } };
}

describe('disabled hats', () => {
  it('a disabled «repetir para siempre» contributes nothing and says why, on the hat', () => {
    const base = buildExample('blink-uno');
    const project = withProgram(base, (blocks) => {
      const loop = blocks.find((b) => b.type === B.loop)!;
      loop.disabledReasons = ['MANUALLY_DISABLED'];
    });
    const { ir, issues } = workspaceToIR(project.program.workspace, programContext(project));
    expect(ir.loop).toEqual([]);
    const loopId = topBlocks(project).find((b) => b.type === B.loop)!.id;
    expect(issues).toContainEqual({ message: expect.stringContaining('desactivado'), blockId: loopId });
    // The enabled program still runs its loop.
    expect(workspaceToIR(base.program.workspace, programContext(base)).ir.loop.length).toBeGreaterThan(0);
  });
});

describe('getProgramIssues', () => {
  it('links a validation error to its block and drops the IR path the agent sees', () => {
    const base = buildExample('blink-uno');
    const led = base.parts.find((p) => p.type === 'led')!;
    // The LED is gone from the circuit but the blocks still use it.
    const project: ProjectModel = { ...base, parts: base.parts.filter((p) => p.id !== led.id) };
    const errors = getProgramErrors(project);
    expect(errors.some((e) => /^loop\[\d+\]/.test(e))).toBe(true); // agent keeps the path
    const issues = getProgramIssues(project);
    const missing = issues.filter((i) => i.message.includes(led.id));
    expect(missing.length).toBeGreaterThan(0);
    for (const i of missing) {
      expect(i.message).not.toMatch(/^loop\[/);
      expect(i.message.charAt(0)).toBe(i.message.charAt(0).toUpperCase());
      expect(i.blockId).toBeTruthy();
    }
  });

  it('points the loose-blocks error at the first loose block', () => {
    const base = buildExample('blink-uno');
    const project = withProgram(base, (blocks) => {
      blocks.push({ type: 'cv_delay', id: 'loose1', x: 400, y: 400, inputs: { MS: { shadow: { type: 'math_number', id: 'loose1n', fields: { NUM: 100 } } } } });
    });
    const issue = getProgramIssues(project).find((i) => i.message.includes('suelto'));
    expect(issue).toEqual({ message: expect.any(String), blockId: 'loose1' });
  });
});

describe('implicit setup lines', () => {
  it('are reported and still mapped to a block', () => {
    const project = buildExample('blink-uno');
    const res = generateCode(getProgramIR(project), programContext(project));
    const lines = res.code.split('\n');
    expect(res.implicitLines?.length).toBeGreaterThan(0);
    for (const ln of res.implicitLines!) {
      expect(lines[ln - 1]).toMatch(/pinMode|Serial\.begin|\.attach/);
    }
    const pinModeLine = res.implicitLines!.find((ln) => lines[ln - 1].includes('pinMode'))!;
    expect(res.lineMap[pinModeLine]).toBeTruthy();
  });
});
