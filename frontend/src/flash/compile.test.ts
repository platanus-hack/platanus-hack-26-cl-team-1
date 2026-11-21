import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientDeps } from './client';
import { compileSketch } from './compile';
import { useCompile } from './store';

const JOB = '0b4d9b8e-8f0e-4e57-9d43-1f4b2c7a9e10';

function deps(final: Record<string, unknown>, onPoll?: () => void): ClientDeps {
  let t = 1000;
  let polls = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
    fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ jobId: JOB, status: 'queued' }), { status: 202 });
      onPoll?.();
      polls++;
      const body = polls === 1 ? { jobId: JOB, status: 'running', board: 'uno', fqbn: 'arduino:avr:uno', diagnostics: [], log: '' } : final;
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch,
  };
}

describe('compileSketch → useCompile', () => {
  beforeEach(() => useCompile.setState({ result: null, code: null, busy: false, startedAt: null }));

  it('publishes every status and the final result with the code and mapped block ids', async () => {
    const snapshots: Array<{ status?: string; busy: boolean }> = [];
    const unsub = useCompile.subscribe((s) => snapshots.push({ status: s.result?.status, busy: s.busy }));
    const final = {
      jobId: JOB, status: 'error', board: 'uno', fqbn: 'arduino:avr:uno', log: 'boom',
      diagnostics: [{ line: 7, column: 3, severity: 'error', message: "'x' was not declared in this scope" }],
    };
    const r = await compileSketch('uno', 'code-v1', { lineMap: { 6: 'block-42' } }, deps(final));
    unsub();
    expect(snapshots.map((s) => `${s.status}:${s.busy}`)).toEqual(['queued:true', 'queued:true', 'running:true', 'error:false']);
    expect(r.diagnostics[0].blockId).toBe('block-42');
    const s = useCompile.getState();
    expect(s.code).toBe('code-v1');
    expect(s.busy).toBe(false);
    expect(s.startedAt).toBe(1000);
    expect(s.result?.diagnostics[0].blockId).toBe('block-42');
    expect(s.result?.durationMs).toBeGreaterThan(0);
  });

  it('only the latest compile owns the store', async () => {
    const success = { jobId: JOB, status: 'success', board: 'uno', fqbn: 'arduino:avr:uno', diagnostics: [], log: '' };
    let second: Promise<unknown> | null = null;
    const first = compileSketch('uno', 'old', {}, deps(success, () => {
      if (!second) second = compileSketch('uno', 'new', {}, deps(success));
    }));
    await first;
    await second;
    expect(useCompile.getState().code).toBe('new');
  });
});
