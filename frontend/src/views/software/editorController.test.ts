// @vitest-environment jsdom
/**
 * Blockly ↔ store sync of the real injected editor (jsdom + SVG stubs):
 * external loads never echo program.set, user edits are debounced into one
 * merged undo step, the toolbox follows the parts, the running block lights up.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DispatchMeta, Op } from '@/contracts';
import { buildExample } from '@/examples';
import { planAddPart } from '@/placement';
import { useProject } from '@/store/project';
import type { EditorController as EditorControllerT } from './editorController';

type Call = { ops: Op[]; meta?: DispatchMeta };
const calls: Call[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let editor: EditorControllerT;
let restore: () => void = () => {};

function stubSvg() {
  const matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, inverse: () => matrix, multiply: () => matrix, translate: () => matrix, scale: () => matrix };
  const svg = window.SVGElement.prototype as unknown as Record<string, unknown>;
  svg.getBBox ??= () => ({ x: 0, y: 0, width: 10, height: 10 });
  svg.getComputedTextLength ??= () => 10;
  svg.getScreenCTM ??= () => matrix;
  const root = window.SVGSVGElement.prototype as unknown as Record<string, unknown>;
  root.createSVGMatrix ??= () => matrix;
  root.createSVGPoint ??= () => ({ x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) });
  (window.HTMLCanvasElement.prototype as unknown as Record<string, unknown>).getContext = () => null;
}

beforeAll(async () => {
  stubSvg();
  useProject.getState().replaceProject(buildExample('blink-uno'));
  const original = useProject.getState().dispatch;
  useProject.setState({
    dispatch: (ops, meta) => {
      calls.push({ ops: Array.isArray(ops) ? ops : [ops], meta });
      return original(ops, meta);
    },
  });
  restore = () => useProject.setState({ dispatch: original });
  const { EditorController } = await import('./editorController');
  const host = document.createElement('div');
  document.body.appendChild(host);
  editor = new EditorController(host, { onSelect: () => {} });
  await sleep(400);
});

afterAll(() => {
  editor?.dispose();
  restore();
});

const programSets = () => calls.filter((c) => c.ops.some((o) => o.op === 'program.set'));

describe('EditorController', () => {
  it('mounting on an existing program dispatches nothing', () => {
    expect(editor.ws.getAllBlocks(false).length).toBeGreaterThan(2);
    expect(calls).toEqual([]);
  });

  it('reloads on an external program.set / undo without echoing it back', async () => {
    const other = buildExample('traffic-light-uno').program.workspace;
    useProject.getState().dispatch({ op: 'program.set', workspace: other }, { label: 'Agente' });
    await sleep(500);
    expect(programSets()).toHaveLength(1); // only the external one
    const count = editor.ws.getAllBlocks(false).length;
    useProject.getState().undo();
    await sleep(500);
    expect(editor.ws.getAllBlocks(false).length).toBeLessThan(count);
    expect(programSets()).toHaveLength(1);
  });

  it('a hardware change refreshes the toolbox and warnings without a program.set', async () => {
    calls.length = 0;
    const r = planAddPart(useProject.getState().project, 'button');
    useProject.getState().dispatch(r.ops);
    const wire = useProject.getState().project.wires.find((w) => w.from === 'uno1.D13' || w.to === 'uno1.D13')!;
    useProject.getState().dispatch({ op: 'wire.remove', id: wire.id });
    await sleep(500);
    expect(programSets()).toEqual([]);
    const names = editor.ws.getToolbox()!.getToolboxItems().map((i) => (i as unknown as { getName?: () => string }).getName?.());
    expect(names).toContain('Entradas');
    const led = editor.ws.getBlocksByType('cv_led', false)[0] as unknown as { getIcon: (t: string) => unknown };
    expect(led.getIcon('warning')).toBeTruthy(); // LED no longer bound to a pin
  });

  it('debounces user edits into one program.set merged under the "blockly" key', async () => {
    calls.length = 0;
    const num = editor.ws.getBlocksByType('math_number', false)[0];
    num.setFieldValue('700', 'NUM');
    num.setFieldValue('800', 'NUM');
    await sleep(100);
    expect(programSets()).toEqual([]);
    await sleep(400);
    expect(programSets()).toHaveLength(1);
    expect(programSets()[0].meta).toMatchObject({ label: 'Editar programa', mergeKey: 'blockly' });
    expect(useProject.getState().project.program.workspace).toBe((programSets()[0].ops[0] as { workspace: unknown }).workspace);
  });

  it('highlights the running block and ignores unknown ids', () => {
    const id = editor.ws.getBlocksByType('cv_delay', false)[0].id;
    editor.highlight(id);
    expect(() => editor.highlight('no-existe')).not.toThrow();
    expect(() => editor.highlight(null)).not.toThrow();
  });
});
