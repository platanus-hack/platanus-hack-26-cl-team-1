/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompileResult } from '@/contracts';
import { useProject } from '@/store/project';
import { CompilePanel } from './CompilePanel';
import { projectSketch } from './project';
import { useCompile, useFlash } from './store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const JOB = '0b4d9b8e-8f0e-4e57-9d43-1f4b2c7a9e10';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<CompilePanel />));
  return host;
}

describe('<CompilePanel/> failed compile', () => {
  beforeEach(() => useFlash.setState({ phase: 'idle', fraction: 0, message: '', error: null, jobId: null }));
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    useCompile.setState({ result: null, code: null, busy: false, startedAt: null });
  });

  it('explains the failure when the only sketch diagnostics are warnings (error was in a library / the linker)', () => {
    const result: CompileResult = {
      jobId: JOB,
      status: 'error',
      board: 'uno',
      fqbn: 'arduino:avr:uno',
      diagnostics: [{ line: 3, severity: 'warning', message: "unused variable 'x' [-Wunused-variable]" }],
      log: "Servo.cpp:12:1: error: 'foo' does not name a type\nError during build: exit status 1",
    };
    const sketch = projectSketch(useProject.getState().project);
    if (!('code' in sketch)) throw new Error(sketch.error);
    useCompile.setState({ result: { ...result, board: sketch.board }, code: sketch.code, busy: false, startedAt: 1 });
    const el = render();
    const text = el.textContent ?? '';
    expect(text).toContain('Con errores');
    expect(text).toContain('1 advertencia');
    // Before: no banner at all — the student only saw a warning under a red "Con errores" chip.
    expect(text).toContain('No se pudo compilar');
    expect(text).toContain("'foo' does not name a type");
  });
});

describe('<CompilePanel/> while compiling', () => {
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
    vi.unstubAllGlobals();
    useCompile.setState({ result: null, code: null, busy: false, startedAt: null });
  });

  it('switching to the circuit view (panel unmounts) does not cancel the compile', async () => {
    let serverDone = false;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ jobId: JOB, status: 'queued' }), { status: 202 });
      const status = serverDone ? 'success' : 'running';
      const extra = serverDone ? { artifactUrl: `/api/compile/${JOB}/artifact`, artifactName: 'sketch.ino.hex' } : {};
      return new Response(JSON.stringify({ jobId: JOB, status, board: 'uno', fqbn: 'arduino:avr:uno', diagnostics: [], log: '', ...extra }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const el = render();
    const button = Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes('Compilar'));
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
    });
    await vi.waitFor(() => expect(useCompile.getState().result?.status).toBe('running'), { timeout: 3000 });

    act(() => root!.unmount()); // the student opens the "Circuito" tab
    root = null;
    serverDone = true;
    await vi.waitFor(() => expect(useCompile.getState().busy).toBe(false), { timeout: 4000 });
    expect(useCompile.getState().result?.log).not.toBe('Compilación cancelada.');
    expect(useCompile.getState().result?.status).toBe('success');
  });
});
