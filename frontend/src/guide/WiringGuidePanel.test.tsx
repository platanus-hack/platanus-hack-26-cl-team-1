// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { buildExample } from '@/examples';
import { createStarterProject } from '@/store/newProject';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { WiringGuidePanel } from './WiringGuidePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView ??= () => {}; // not implemented by jsdom

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<WiringGuidePanel />));
  return host;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const button = (el: HTMLElement, text: RegExp) => [...el.querySelectorAll('button')].find((b) => text.test(b.textContent ?? ''))!;

describe('<WiringGuidePanel/>', () => {
  it('starts over (step 1, nothing checked) when another project is loaded', async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    const el = await mount();
    for (let i = 0; i < 3; i++) await act(async () => button(el, /Siguiente/).click());
    expect(el.textContent).toMatch(/3 de \d+ pasos hechos/);
    expect(el.textContent).toMatch(/Paso 4 de/);

    // Same part/wire ids (uno1, bb1, r1, led1, w1…) exist in the next example.
    await act(async () => {
      useProject.getState().dispatch({ op: 'project.load', project: buildExample('traffic-light-uno') });
    });
    expect(el.querySelectorAll('.guide-item.done')).toHaveLength(0);
    expect(el.textContent).toMatch(/Paso 1 de/);
  });

  it('keeps the progress while the same project is edited', async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    const el = await mount();
    for (let i = 0; i < 2; i++) await act(async () => button(el, /Siguiente/).click());
    await act(async () => {
      useProject.getState().dispatch({ op: 'project.rename', name: 'Mi parpadeo' });
    });
    expect(el.querySelectorAll('.guide-item.done')).toHaveLength(2);
    expect(el.textContent).toMatch(/Paso 3 de/);
  });

  it('names the wire colour in Spanish in the swatch tooltip', async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    const el = await mount();
    // Jump to the first wire step (power wires are black/red).
    const item = [...el.querySelectorAll('.guide-item-main')].find((b) => /Cable amarillo/.test(b.textContent ?? '')) as HTMLButtonElement;
    await act(async () => item.click());
    const swatch = el.querySelector('.guide-wire-swatch') as HTMLElement;
    expect(swatch.getAttribute('title')).toBe('Cable amarillo');
  });

  it('does not leave its canvas caption behind when the new project has nothing to build', async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    const el = await mount();
    for (let i = 0; i < 6; i++) await act(async () => button(el, /Siguiente/).click());
    const shown = useUI.getState().highlight;
    expect(shown?.message).toBeTruthy();
    await act(async () => {
      useProject.getState().dispatch({ op: 'project.load', project: createStarterProject('uno') });
    });
    expect(el.textContent).toMatch(/Aún no hay nada que armar/);
    expect(useUI.getState().highlight?.message ?? null).not.toBe(shown!.message);
  });

  it('leaves highlights set by others alone when it unmounts', async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    await mount();
    useUI.getState().setHighlight(['led1'], 'Mira este LED', 'agent');
    await act(async () => root?.unmount());
    root = null;
    expect(useUI.getState().highlight?.message).toBe('Mira este LED');
  });

  it("tags its step highlight with source 'guide' (the canvas keeps those: no 8 s auto-clear, no clear on click)", async () => {
    useProject.getState().replaceProject(buildExample('blink-uno'));
    const el = await mount();
    await act(async () => button(el, /Siguiente/).click());
    expect(useUI.getState().highlight).toMatchObject({ source: 'guide' });
  });
});
