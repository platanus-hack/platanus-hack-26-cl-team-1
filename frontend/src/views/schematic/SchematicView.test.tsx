// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { buildExample } from '@/examples';
import { useProject } from '@/store/project';
import type { SchematicGraph } from './graph';

const elk = vi.hoisted(() => ({ fail: false }));
vi.mock('./layout', async (importOriginal) => {
  const real = await importOriginal<typeof import('./layout')>();
  return {
    ...real,
    layoutSchematic: (g: SchematicGraph) => (elk.fail ? Promise.reject(new Error('ELK falló')) : real.layoutSchematic(g)),
  };
});

const { SchematicView } = await import('./SchematicView');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  elk.fail = false;
});

/** Let the ELK promise (real or rejected) settle and React re-render. */
const settle = () => act(async () => new Promise((r) => setTimeout(r, 300)));

describe('<SchematicView/>', () => {
  it('clears the layout error once a later circuit is laid out from the cache', async () => {
    const blink = buildExample('blink-uno');
    useProject.getState().replaceProject(blink);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<SchematicView />));
    await settle(); // blink layout computed and cached
    expect(host.querySelector('.sch-error')).toBeNull();
    expect(host.querySelectorAll('.sch-node').length).toBeGreaterThan(0);

    elk.fail = true;
    await act(async () => {
      useProject.getState().dispatch({ op: 'project.load', project: buildExample('traffic-light-uno') });
    });
    await settle();
    expect(host.querySelector('.sch-error')?.textContent).toMatch(/No pude ordenar el esquema/);

    // Back to the blink circuit: its layout is cached, so the view is fine again.
    await act(async () => useProject.getState().undo());
    await settle();
    expect(host.querySelector('.sch-error')).toBeNull();
  });

  it('shows the empty state (not an error) for a project without parts', async () => {
    const p = buildExample('blink-uno');
    useProject.getState().replaceProject({ ...p, parts: [], wires: [] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(<SchematicView />));
    await settle();
    expect(host.querySelector('.sch-empty')).not.toBeNull();
    expect(host.querySelector('.sch-error')).toBeNull();
  });
});
