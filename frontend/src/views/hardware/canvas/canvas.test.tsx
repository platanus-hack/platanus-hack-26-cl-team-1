// @vitest-environment jsdom
/**
 * Canvas integration tests (real renderers, real stores, jsdom).
 * Pointer events are dispatched on the SVG like the browser would.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ProjectModel } from '@/contracts';
import { buildExample } from '@/examples';
import { coveredHoles } from '@/placement';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { getPinIndex } from '../logic/pinIndex';
import { worldToScreen } from '../logic/viewport';
import { part, project, unoAndBreadboard } from '../logic/fixtures';
import { Canvas } from './Canvas';

const g = globalThis as unknown as Record<string, unknown>;
g.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeAll(() => {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  useUI.setState({ tool: 'select', selection: { parts: [], wires: [] }, highlight: null });
  useHW.setState({ vp: { scale: 16, tx: 40, ty: 40 }, draft: null, dragging: false, marquee: null, ghost: null });
  useSim.setState({ runtime: {}, result: null });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.useRealTimers();
});

async function mount(p: ProjectModel) {
  useProject.getState().replaceProject(p);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<Canvas />));
  return host;
}

function svg(): SVGSVGElement {
  return host!.querySelector('svg.hw-svg') as SVGSVGElement;
}

/** Dispatch a pointer event (MouseEvent carries clientX/Y/button; React keys on the type). */
async function pointer(type: string, target: Element, clientX: number, clientY: number) {
  document.elementFromPoint = () => target;
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }));
  });
}

const screenOf = (x: number, y: number) => worldToScreen(useHW.getState().vp, x, y);

describe('interactive actuators', () => {
  it('dragging the LDR disc changes the light level (like a knob)', async () => {
    const p = project([...unoAndBreadboard(), part('ldr1', 'ldr', 70, 10)]);
    await mount(p);
    const act1 = host!.querySelector('[data-part-id="ldr1"] [data-actuator="light"]')!;
    expect(act1).toBeTruthy();
    const s = screenOf(71, 11);
    await pointer('pointerdown', act1, s.x, s.y);
    await pointer('pointermove', act1, s.x, s.y - 50);
    await pointer('pointerup', act1, s.x, s.y - 50);
    const light = useSim.getState().runtime.ldr1?.light;
    expect(light).toBe(90); // 60 % default + 50 px * 0.6
    // the part itself did not move
    const ldr = useProject.getState().project.parts.find((x) => x.id === 'ldr1')!;
    expect([ldr.x, ldr.y]).toEqual([70, 10]);
  });

  it('a pot knob drag still works and a press actuator is released on pointerup', async () => {
    const p = project([...unoAndBreadboard(), part('pot1', 'potentiometer', 70, 10), part('btn1', 'button', 80, 10)]);
    await mount(p);
    const knob = host!.querySelector('[data-part-id="pot1"] [data-actuator="position"]')!;
    const s = screenOf(72, 11);
    await pointer('pointerdown', knob, s.x, s.y);
    await pointer('pointermove', knob, s.x, s.y + 50);
    await pointer('pointerup', knob, s.x, s.y + 50);
    expect(useSim.getState().runtime.pot1?.position).toBe(20);

    const cap = host!.querySelector('[data-part-id="btn1"] [data-actuator="pressed"]')!;
    const b = screenOf(81, 11);
    await pointer('pointerdown', cap, b.x, b.y);
    expect(useSim.getState().runtime.btn1?.pressed).toBe(true);
    await pointer('pointerup', cap, b.x, b.y);
    expect(useSim.getState().runtime.btn1?.pressed).toBe(false);
  });
});

describe('wire drawing', () => {
  it('never starts or ends a wire on a hole covered by another part body', async () => {
    const p = buildExample('rgb-esp32c6');
    await mount(p);
    const covered = [...coveredHoles(p)];
    expect(covered.length).toBeGreaterThan(0);
    const idx = getPinIndex(p);
    const hole = idx.byRef.get(covered[0])!;
    const s = screenOf(hole.x, hole.y);
    useUI.setState({ tool: 'wire' });
    // The pointer is over a jumper that crosses the board (wires are drawn above parts).
    const wireEl = host!.querySelector('[data-wire-id] .hw-wire-hit')!;
    await pointer('pointerdown', wireEl, s.x, s.y);
    expect(useHW.getState().draft?.from ?? null).not.toBe(covered[0]);
    expect(useHW.getState().draft).toBeNull();
  });

  it('clicking the start pin again cancels the draft without creating a wire', async () => {
    const p = project(unoAndBreadboard());
    await mount(p);
    const idx = getPinIndex(p);
    const a = idx.byRef.get('bb1.a10')!;
    const s = screenOf(a.x, a.y);
    const bb = host!.querySelector('[data-part-id="bb1"]')!;
    await pointer('pointerdown', bb, s.x, s.y);
    await pointer('pointerup', bb, s.x, s.y);
    expect(useHW.getState().draft?.from).toBe('bb1.a10');
    await pointer('pointerdown', bb, s.x, s.y);
    expect(useHW.getState().draft).toBeNull();
    expect(useProject.getState().project.wires).toHaveLength(0);
  });
});

describe('agent highlight', () => {
  it('a highlight set while the canvas was hidden is still auto-cleared after 8 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    useProject.getState().replaceProject(project(unoAndBreadboard()));
    useUI.getState().setHighlight(['uno1'], 'Esta es la placa');
    await mount(useProject.getState().project);
    expect(useUI.getState().highlight).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(useUI.getState().highlight).toBeNull();
  });

  it('a highlight set while mounted is auto-cleared after 8 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await mount(project(unoAndBreadboard()));
    await act(async () => useUI.getState().setHighlight(['bb1'], 'Protoboard'));
    await act(async () => {
      vi.advanceTimersByTime(8100);
    });
    expect(useUI.getState().highlight).toBeNull();
  });

  it('the wiring guide step highlight (source "guide") is persistent: no 8 s timeout, survives canvas clicks', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await mount(project(unoAndBreadboard()));
    await act(async () => useUI.getState().setHighlight(['bb1.e10', 'bb1.e11'], 'Coloca el LED', 'guide'));
    await act(async () => {
      vi.advanceTimersByTime(20000);
    });
    expect(useUI.getState().highlight?.source).toBe('guide');
    const s = screenOf(-5, -5);
    await pointer('pointerdown', svg(), s.x, s.y);
    await pointer('pointerup', svg(), s.x, s.y);
    expect(useUI.getState().highlight?.source).toBe('guide');
    // an agent highlight is still dismissed by a click on the canvas
    await act(async () => useUI.getState().setHighlight(['uno1'], 'Mira la placa', 'agent'));
    await pointer('pointerdown', svg(), s.x, s.y);
    await pointer('pointerup', svg(), s.x, s.y);
    expect(useUI.getState().highlight).toBeNull();
  });
});
