// @vitest-environment jsdom
/**
 * Blockly ↔ store sync of the real injected editor (jsdom + SVG stubs):
 * external loads never echo program.set, user edits are debounced into one
 * undo step, no-op saves are skipped, Blockly's undo goes to the project
 * history, the toolbox follows the parts, the running block lights up.
 */
import * as Blockly from 'blockly';
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

  it('debounces edits of one field into one program.set merged under a per-field key', async () => {
    calls.length = 0;
    const num = editor.ws.getBlocksByType('math_number', false)[0];
    num.setFieldValue('700', 'NUM');
    num.setFieldValue('800', 'NUM');
    await sleep(100);
    expect(programSets()).toEqual([]);
    await sleep(400);
    expect(programSets()).toHaveLength(1);
    expect(programSets()[0].meta).toMatchObject({ label: 'Editar programa', mergeKey: `blockly-field:${num.id}:NUM` });
    expect(useProject.getState().project.program.workspace).toBe((programSets()[0].ops[0] as { workspace: unknown }).workspace);
  });

  it('a structural edit is its own undo step (no mergeKey)', async () => {
    calls.length = 0;
    const loose = Blockly.serialization.blocks.append({ type: 'cv_delay', x: 500, y: 500 }, editor.ws);
    await sleep(450);
    expect(programSets()).toHaveLength(1);
    expect(programSets()[0].meta?.mergeKey).toBeUndefined();
    loose.dispose();
    await sleep(450);
  });

  it('skips a save that would not change the program', async () => {
    calls.length = 0;
    const hat = editor.ws.getBlocksByType('cv_setup', false)[0];
    hat.moveBy(30, 0);
    hat.moveBy(-30, 0);
    await sleep(450);
    expect(programSets()).toEqual([]);
  });

  it('undoing a loose block keeps redo available (no phantom history entry)', async () => {
    Blockly.serialization.blocks.append({ type: 'cv_delay', x: 520, y: 520 }, editor.ws);
    await sleep(450);
    const past = useProject.getState().past.length;
    calls.length = 0;
    useProject.getState().undo();
    await sleep(800);
    expect(programSets()).toEqual([]);
    expect(useProject.getState().past.length).toBe(past - 1);
    expect(useProject.getState().future.length).toBe(1);
    useProject.getState().redo();
    await sleep(450);
    expect(editor.ws.getBlocksByType('cv_delay', false).some((b) => !b.getParent())).toBe(true);
  });

  it('waits for the drop: no save while a drag is in progress', async () => {
    calls.length = 0;
    const ws = editor.ws as unknown as { isDragging: () => boolean };
    const original = ws.isDragging;
    let dragging = true;
    ws.isDragging = () => dragging;
    try {
      // A drag fires real events when it starts (unplug / create from the toolbox).
      const block = Blockly.serialization.blocks.append({ type: 'cv_delay', x: 540, y: 540 }, editor.ws);
      await sleep(800);
      expect(programSets()).toEqual([]);
      dragging = false;
      block.moveBy(10, 10); // the drop
      await sleep(450);
      expect(programSets()).toHaveLength(1);
      block.dispose();
      await sleep(450);
    } finally {
      ws.isDragging = original;
    }
  });

  it('the hats offer no «Desactivar bloque» (a disabled loop silently stops everything)', () => {
    const item = Blockly.ContextMenuRegistry.registry.getItem('blockDisable') as unknown as { preconditionFn: (s: unknown, e: Event) => string };
    const loop = editor.ws.getBlocksByType('cv_loop', false)[0];
    const delay = editor.ws.getBlocksByType('cv_delay', false)[0];
    expect(item.preconditionFn({ block: loop }, new Event('x'))).toBe('hidden');
    expect(item.preconditionFn({ block: delay }, new Event('x'))).not.toBe('hidden');
  });

  it('a pending edit is saved before an outside change instead of being dropped', async () => {
    calls.length = 0;
    const num = editor.ws.getBlocksByType('math_number', false)[0];
    num.setFieldValue('321', 'NUM');
    await sleep(30); // Blockly delivers change events on a later tick
    expect(calls).toEqual([]);
    // Within the 300 ms debounce, another change arrives (agent, rename, undo…).
    useProject.getState().dispatch({ op: 'project.rename', name: 'Otro nombre' }, { label: 'Renombrar' });
    expect(calls.map((c) => c.ops[0].op)).toEqual(['project.rename', 'program.set']);
    const saved = useProject.getState().past.slice(-2).map((e) => e.label);
    expect(saved).toEqual(['Editar programa', 'Renombrar']);
    expect(JSON.stringify(useProject.getState().project.program.workspace)).toContain('321');
  });

  it("Blockly's undo shortcut and context item walk the project history", async () => {
    const shortcut = Blockly.ShortcutRegistry.registry.getRegistry()[Blockly.ShortcutItems.names.UNDO];
    const before = useProject.getState().past.length;
    expect(before).toBeGreaterThan(0);
    shortcut.callback!(editor.ws, new KeyboardEvent('keydown'), shortcut, {} as Blockly.ContextMenuRegistry.Scope);
    expect(useProject.getState().past.length).toBe(before - 1);
    const redoItem = Blockly.ContextMenuRegistry.registry.getItem('redoWorkspace') as unknown as {
      preconditionFn: (s: unknown, e: Event) => string;
      callback: (s: unknown, e: Event) => void;
    };
    const scope = { workspace: editor.ws } as Blockly.ContextMenuRegistry.Scope;
    expect(redoItem.preconditionFn(scope, new Event('x'))).toBe('enabled');
    redoItem.callback(scope, new Event('x'));
    expect(useProject.getState().past.length).toBe(before);
    await sleep(450);
  });

  it('highlights the running block and ignores unknown ids', () => {
    const id = editor.ws.getBlocksByType('cv_delay', false)[0].id;
    editor.highlight(id);
    expect(() => editor.highlight('no-existe')).not.toThrow();
    expect(() => editor.highlight(null)).not.toThrow();
  });
});
