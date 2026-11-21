// @vitest-environment jsdom
/**
 * Performance guard for the classroom demo: a sim tick (new CircuitResult in
 * the sim store) must NOT re-render the whole canvas — only the parts whose
 * own state changed. Measured on the ESP32-C6 rainbow example with real
 * solves (PWM duty of the RGB LED changing every tick, like the program does).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CircuitInputs, PinDrive } from '@/contracts';
import type { PartRenderProps } from '@/parts/types';

const counts = vi.hoisted(() => ({ parts: new Map<string, number>(), canvas: 0 }));

vi.mock('@/parts/registry', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/parts/registry')>();
  const { createElement } = await import('react');
  const wrapped = new Map<string, ComponentType<PartRenderProps>>();
  return {
    ...real,
    getRenderer: (type: string) => {
      let W = wrapped.get(type);
      if (!W) {
        const R = real.getRenderer(type);
        W = (props: PartRenderProps) => {
          counts.parts.set(props.part.id, (counts.parts.get(props.part.id) ?? 0) + 1);
          return createElement(R, props);
        };
        wrapped.set(type, W);
      }
      return W;
    },
  };
});

// SharedDefs is a direct, non-memoized child of <Canvas/>: it renders exactly when the canvas does.
vi.mock('@/parts/defs', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/parts/defs')>();
  return {
    ...real,
    SharedDefs: () => {
      counts.canvas++;
      return null;
    },
  };
});

const { solveCircuit } = await import('@/circuit');
const { buildExample } = await import('@/examples');
const { getNetlist, getBindings } = await import('@/store/derived');
const { useProject } = await import('@/store/project');
const { useSim } = await import('@/store/sim');
const { Canvas } = await import('./Canvas');

const g = globalThis as unknown as Record<string, unknown>;
g.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;

beforeAll(async () => {
  g.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  useProject.getState().replaceProject(buildExample('rgb-esp32c6'));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Canvas />));
});

afterAll(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('canvas render cost per sim tick (ESP32-C6 rainbow example)', () => {
  it('re-renders only the parts whose state changed, never the canvas or the breadboard', async () => {
    const project = useProject.getState().project;
    const netlist = getNetlist(project);
    const rgbPins = getBindings(project)
      .filter((b) => b.boardPin && project.parts.find((p) => p.id === b.part)?.type === 'led-rgb')
      .map((b) => b.boardPin!);
    expect(rgbPins.length).toBe(3);
    const solve = (i: number) => {
      const drives: Record<string, PinDrive> = {};
      rgbPins.forEach((pin, k) => {
        const v = (i * 5 + k * 85) % 256;
        drives[pin] = { mode: 'output', level: v > 0 ? 1 : 0, duty: v / 255 };
      });
      const inputs: CircuitInputs = { drives, runtime: {}, burned: [], servoAngles: {}, onboardRgb: null };
      return solveCircuit(project, netlist, inputs);
    };
    await act(async () => useSim.setState({ result: solve(0) }));
    counts.parts.clear();
    counts.canvas = 0;

    const TICKS = 30;
    for (let i = 1; i <= TICKS; i++) await act(async () => useSim.setState({ result: solve(i) }));

    const bb = project.parts.find((p) => p.type === 'breadboard-half')!.id;
    const led = project.parts.find((p) => p.type === 'led-rgb')!.id;
    const board = project.parts.find((p) => p.type === 'esp32c6-devkit')!.id;
    expect(counts.canvas).toBe(0);
    expect(counts.parts.get(bb) ?? 0).toBe(0);
    // the board's onboard indicators did not change (new objects with equal values)
    expect(counts.parts.get(board) ?? 0).toBe(0);
    expect(counts.parts.get(led)).toBe(TICKS);
    const total = [...counts.parts.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeLessThan(TICKS * project.parts.length);
  });
});
