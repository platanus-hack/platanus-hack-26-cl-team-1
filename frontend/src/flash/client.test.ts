import { describe, expect, it } from 'vitest';
import type { CompileResult } from '@/contracts';
import {
  defaultArtifactFilename,
  filenameFromDisposition,
  mapDiagnostics,
  MSG_CANCELLED,
  MSG_UNREACHABLE,
  normalizeResult,
  POLL_INTERVAL_MS,
  requestCompile,
  type ClientDeps,
} from './client';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fakeDeps(handler: Handler): ClientDeps & { calls: string[]; sleeps: number[] } {
  let t = 0;
  const calls: string[] = [];
  const sleeps: number[] = [];
  return {
    calls,
    sleeps,
    now: () => t,
    sleep: async (ms, signal) => {
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      sleeps.push(ms);
      t += ms;
    },
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return handler(url, init);
    }) as typeof fetch,
  };
}

const JOB = '0b4d9b8e-8f0e-4e57-9d43-1f4b2c7a9e10';
const success = { jobId: JOB, status: 'success', board: 'uno', fqbn: 'arduino:avr:uno', diagnostics: [], log: 'ok', sizes: { flashBytes: 924, flashMax: 32256, ramBytes: 9, ramMax: 2048 }, artifactUrl: `/api/compile/${JOB}/artifact`, artifactName: 'sketch.ino.hex', durationMs: 1200 };

describe('requestCompile', () => {
  it('posts, polls every 800 ms and reports status changes', async () => {
    const states = ['queued', 'running', 'running', 'success'];
    let i = 0;
    const deps = fakeDeps((url, init) => {
      if (init?.method === 'POST') {
        expect(JSON.parse(String(init.body))).toEqual({ board: 'uno', code: 'void setup(){}' });
        return json({ jobId: JOB, status: 'queued' }, 202);
      }
      const s = states[i++];
      return json(s === 'success' ? success : { jobId: JOB, status: s, board: 'uno', fqbn: 'arduino:avr:uno', diagnostics: [], log: '' });
    });
    const seen: string[] = [];
    const r = await requestCompile('uno', 'void setup(){}', { onStatus: (x) => seen.push(x.status) }, deps);
    expect(r.status).toBe('success');
    expect(r.sizes).toEqual(success.sizes);
    expect(r.artifactName).toBe('sketch.ino.hex');
    expect(seen).toEqual(['queued', 'running']);
    expect(deps.sleeps.every((ms) => ms === POLL_INTERVAL_MS)).toBe(true);
    expect(deps.calls[0]).toBe('POST /api/compile');
    expect(deps.calls[1]).toBe(`GET /api/compile/${JOB}`);
  });

  it('turns a network failure into a Spanish error result', async () => {
    const deps = fakeDeps(() => {
      throw new TypeError('Failed to fetch');
    });
    const r = await requestCompile('esp32c6', 'x', {}, deps);
    expect(r).toMatchObject({ status: 'error', board: 'esp32c6', log: MSG_UNREACHABLE });
    expect(r.log).toMatch(/^No se pudo contactar al servidor de compilación/);
  });

  it('tolerates a few failed polls, then gives up', async () => {
    let polls = 0;
    const deps = fakeDeps((_url, init) => {
      if (init?.method === 'POST') return json({ jobId: JOB, status: 'queued' }, 202);
      polls++;
      if (polls <= 2) throw new TypeError('Failed to fetch');
      return json(success);
    });
    expect((await requestCompile('uno', 'x', {}, deps)).status).toBe('success');

    const dead = fakeDeps((_url, init) => {
      if (init?.method === 'POST') return json({ jobId: JOB, status: 'queued' }, 202);
      throw new TypeError('Failed to fetch');
    });
    expect((await requestCompile('uno', 'x', {}, dead)).log).toBe(MSG_UNREACHABLE);
  });

  it('surfaces the server detail on 4xx', async () => {
    const deps = fakeDeps(() => json({ detail: 'El programa es demasiado grande (200000 bytes; máximo 102400).' }, 413));
    const r = await requestCompile('uno', 'x', {}, deps);
    expect(r.status).toBe('error');
    expect(r.log).toMatch(/demasiado grande/);
  });

  it('treats a gateway error (API stopped behind the Vite proxy / nginx) as "server unreachable"', async () => {
    for (const status of [502, 503, 504]) {
      const deps = fakeDeps(() => new Response(status === 502 ? '' : '<html><body>Bad Gateway</body></html>', { status }));
      expect((await requestCompile('uno', 'x', {}, deps)).log).toBe(MSG_UNREACHABLE);
    }
    // While polling: a few tolerated, then the same friendly message (not "error (502)").
    const polling = fakeDeps((_url, init) => (init?.method === 'POST' ? json({ jobId: JOB, status: 'queued' }, 202) : new Response('', { status: 502 })));
    expect(await requestCompile('uno', 'x', {}, polling)).toMatchObject({ status: 'error', log: MSG_UNREACHABLE, jobId: JOB });
    // A real application error keeps the server's detail.
    const app = fakeDeps(() => json({ detail: 'Identificador de compilación inválido.' }, 400));
    expect((await requestCompile('uno', 'x', {}, app)).log).toBe('Identificador de compilación inválido.');
  });

  it('reports an expired job (404)', async () => {
    const deps = fakeDeps((_url, init) => (init?.method === 'POST' ? json({ jobId: JOB, status: 'queued' }, 202) : new Response('', { status: 404 })));
    expect((await requestCompile('uno', 'x', {}, deps)).log).toMatch(/expiró/);
  });

  it('can be aborted', async () => {
    const ctrl = new AbortController();
    const deps = fakeDeps((_url, init) => {
      if (init?.method === 'POST') return json({ jobId: JOB, status: 'queued' }, 202);
      ctrl.abort();
      return json({ jobId: JOB, status: 'running', board: 'uno', fqbn: '', diagnostics: [], log: '' });
    });
    const r = await requestCompile('uno', 'x', { signal: ctrl.signal }, deps);
    expect(r).toMatchObject({ status: 'error', log: MSG_CANCELLED, jobId: JOB });
  });
});

describe('normalizeResult', () => {
  it('drops malformed fields and keeps valid ones', () => {
    const r = normalizeResult({ status: 'weird', diagnostics: [{ line: 3, message: 'x', severity: 'warning' }, { line: 'a' }, null], sizes: { flashBytes: 'n' } }, 'uno', 'id');
    expect(r.status).toBe('error');
    expect(r.jobId).toBe('id');
    expect(r.diagnostics).toEqual([{ line: 3, column: undefined, severity: 'warning', message: 'x' }]);
    expect(r.sizes).toBeUndefined();
    expect(normalizeResult(null, 'esp32c6', 'j').board).toBe('esp32c6');
  });
});

describe('mapDiagnostics', () => {
  const lineMap = { 10: 'blkA', 14: 'blkB' };
  it('maps exact lines and falls back to the nearest mapped line above', () => {
    const out = mapDiagnostics(
      [
        { line: 10, severity: 'error', message: 'a' },
        { line: 12, severity: 'error', message: 'b' },
        { line: 3, severity: 'error', message: 'c' },
        { line: 30, severity: 'warning', message: 'd' },
      ],
      lineMap,
    );
    expect(out.map((d) => d.blockId)).toEqual(['blkA', 'blkA', undefined, undefined]);
  });
  it('is a no-op without a lineMap', () => {
    const d: CompileResult['diagnostics'] = [{ line: 1, severity: 'error', message: 'x' }];
    expect(mapDiagnostics(d, undefined)).toBe(d);
  });
});

describe('download names', () => {
  it('reads Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="circuito-vivo-uno.hex"')).toBe('circuito-vivo-uno.hex');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''circuito%20vivo.bin")).toBe('circuito vivo.bin');
    expect(filenameFromDisposition(null)).toBeNull();
  });
  it('falls back to a board-based name', () => {
    expect(defaultArtifactFilename({ ...success, status: 'success', board: 'uno' } as CompileResult)).toBe('circuito-vivo-uno.hex');
    expect(defaultArtifactFilename({ ...success, status: 'success', board: 'esp32c6', artifactName: 'sketch.ino.merged.bin' } as CompileResult)).toBe('circuito-vivo-esp32c6.bin');
  });
});
