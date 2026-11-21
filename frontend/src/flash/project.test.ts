import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '@/store/newProject';
import type { ClientDeps } from './client';
import { compileSketch } from './compile';
import { compileProject, NO_BOARD_MESSAGE } from './project';
import { useCompile } from './store';

const JOB = '0b4d9b8e-8f0e-4e57-9d43-1f4b2c7a9e10';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('compileProject', () => {
  beforeEach(() => useCompile.setState({ result: null, code: null, busy: false, startedAt: null }));

  it('a project-level error supersedes a compile that is still polling', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let t = 0;
    const deps: ClientDeps = {
      now: () => t,
      sleep: async (ms) => {
        await gate;
        t += ms;
      },
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === 'POST'
          ? json({ jobId: JOB, status: 'queued' }, 202)
          : json({ jobId: JOB, status: 'success', board: 'uno', fqbn: 'arduino:avr:uno', diagnostics: [], log: '', artifactUrl: '/x', artifactName: 'sketch.ino.hex' })) as typeof fetch,
    };
    const old = compileSketch('uno', 'old-code', {}, deps);
    await new Promise((r) => setTimeout(r, 0)); // the old compile is now waiting between polls

    const r = await compileProject(createEmptyProject()); // no board → immediate error
    expect(r.log).toBe(NO_BOARD_MESSAGE);
    expect(useCompile.getState().result?.log).toBe(NO_BOARD_MESSAGE);

    release();
    await old;
    // The superseded compile must not overwrite the newer error (nor flip busy back on).
    const s = useCompile.getState();
    expect(s.result?.log).toBe(NO_BOARD_MESSAGE);
    expect(s.result?.status).toBe('error');
    expect(s.busy).toBe(false);
    expect(s.code).toBeNull();
  });
});
