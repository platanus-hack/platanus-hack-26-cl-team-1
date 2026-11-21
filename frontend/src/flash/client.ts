/** HTTP client for the compile API: POST /api/compile, then poll GET /api/compile/{id}. */
import type { BoardId, CompileDiagnostic, CompileResult } from '@/contracts';

export const POLL_INTERVAL_MS = 800;
/** Give up polling after this long (the server reports a stale job itself well before). */
export const CLIENT_DEADLINE_MS = 8 * 60_000;
/** Consecutive failed polls tolerated (wifi hiccup, server reload) before giving up. */
const MAX_POLL_FAILURES = 4;

export const MSG_UNREACHABLE =
  'No se pudo contactar al servidor de compilación. Revisa tu conexión a internet o que el servidor esté encendido, y vuelve a intentarlo.';
export const MSG_CANCELLED = 'Compilación cancelada.';

export interface ClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
}

export const defaultDeps = (): ClientDeps => ({
  fetch: (input, init) => fetch(input, init),
  sleep: abortableSleep,
  now: () => Date.now(),
});

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';

/** A CompileResult describing a failure that happened on the client side. */
export function errorResult(board: BoardId, log: string, jobId = ''): CompileResult {
  return { jobId, status: 'error', board, fqbn: '', diagnostics: [], log };
}

const STATUSES = new Set<CompileResult['status']>(['queued', 'running', 'success', 'error']);

/** Defensive parse of the server's JSON (never trust shape). */
export function normalizeResult(raw: unknown, board: BoardId, jobId: string): CompileResult {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const status = STATUSES.has(r.status as CompileResult['status']) ? (r.status as CompileResult['status']) : 'error';
  const diagnostics: CompileDiagnostic[] = Array.isArray(r.diagnostics)
    ? r.diagnostics.flatMap((d): CompileDiagnostic[] => {
        if (!d || typeof d !== 'object') return [];
        const o = d as Record<string, unknown>;
        if (typeof o.line !== 'number' || typeof o.message !== 'string') return [];
        return [{
          line: o.line,
          column: typeof o.column === 'number' ? o.column : undefined,
          severity: o.severity === 'warning' ? 'warning' : 'error',
          message: o.message,
        }];
      })
    : [];
  const out: CompileResult = {
    jobId: typeof r.jobId === 'string' ? r.jobId : jobId,
    status,
    board: r.board === 'uno' || r.board === 'esp32c6' ? r.board : board,
    fqbn: typeof r.fqbn === 'string' ? r.fqbn : '',
    diagnostics,
    log: typeof r.log === 'string' ? r.log : '',
  };
  const s = r.sizes as Record<string, unknown> | undefined;
  if (s && typeof s.flashBytes === 'number') {
    out.sizes = {
      flashBytes: s.flashBytes,
      flashMax: typeof s.flashMax === 'number' ? s.flashMax : 0,
      ramBytes: typeof s.ramBytes === 'number' ? s.ramBytes : undefined,
      ramMax: typeof s.ramMax === 'number' ? s.ramMax : undefined,
    };
  }
  if (typeof r.artifactUrl === 'string') out.artifactUrl = r.artifactUrl;
  if (typeof r.artifactName === 'string') out.artifactName = r.artifactName;
  if (typeof r.durationMs === 'number') out.durationMs = r.durationMs;
  return out;
}

/**
 * Map compiler line numbers to block ids through codegen's lineMap. A line without its own
 * block (declarations, closing braces) falls back to the nearest mapped line above it.
 */
export function mapDiagnostics(diags: CompileDiagnostic[], lineMap: Record<number, string> | undefined): CompileDiagnostic[] {
  if (!lineMap) return diags;
  return diags.map((d) => {
    if (d.blockId) return d;
    for (let l = d.line; l >= Math.max(1, d.line - 4); l--) {
      const id = lineMap[l];
      if (id) return { ...d, blockId: id };
    }
    return d;
  });
}

/** 502/503/504 come from the Vite dev proxy or nginx when the API process is not running. */
const isGatewayError = (status: number) => status === 502 || status === 503 || status === 504;

async function detail(res: Response): Promise<string> {
  if (isGatewayError(res.status)) return MSG_UNREACHABLE;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail)) return 'La solicitud de compilación no es válida.';
  } catch {
    /* not JSON */
  }
  return `El servidor respondió con un error (${res.status}).`;
}

export interface PollOptions {
  signal?: AbortSignal;
  onStatus?: (r: CompileResult) => void;
  base?: string;
}

/** POST + poll until success | error. Never throws (errors become CompileResult with status 'error'). */
export async function requestCompile(board: BoardId, code: string, opts: PollOptions = {}, deps: ClientDeps = defaultDeps()): Promise<CompileResult> {
  const { signal, onStatus, base = '' } = opts;
  const started = deps.now();
  let jobId = '';
  try {
    const res = await deps.fetch(`${base}/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board, code }),
      signal,
    });
    if (!res.ok) return errorResult(board, await detail(res));
    const body = (await res.json()) as { jobId?: unknown; status?: unknown };
    if (typeof body.jobId !== 'string' || !body.jobId) return errorResult(board, 'El servidor de compilación devolvió una respuesta inesperada.');
    jobId = body.jobId;
    let current = normalizeResult({ ...body, board }, board, jobId);
    if (current.status === 'success' || current.status === 'error') return current; // future: inline result
    onStatus?.(current);

    let failures = 0;
    for (;;) {
      await deps.sleep(POLL_INTERVAL_MS, signal);
      if (deps.now() - started > CLIENT_DEADLINE_MS) {
        return errorResult(board, 'El servidor de compilación no terminó a tiempo. Vuelve a intentarlo en un momento.', jobId);
      }
      let poll: Response;
      try {
        poll = await deps.fetch(`${base}/api/compile/${encodeURIComponent(jobId)}`, { signal, cache: 'no-store' });
      } catch (err) {
        if (isAbort(err)) throw err;
        if (++failures > MAX_POLL_FAILURES) return errorResult(board, MSG_UNREACHABLE, jobId);
        continue;
      }
      if (poll.status === 404) return errorResult(board, 'La compilación ya no existe en el servidor (expiró). Vuelve a compilar.', jobId);
      if (!poll.ok) {
        if (poll.status >= 500 && ++failures <= MAX_POLL_FAILURES) continue;
        return errorResult(board, await detail(poll), jobId);
      }
      failures = 0;
      const next = normalizeResult(await poll.json(), board, jobId);
      if (next.status === 'success' || next.status === 'error') return next;
      if (next.status !== current.status || next.log !== current.log) onStatus?.(next);
      current = next;
    }
  } catch (err) {
    if (isAbort(err)) return errorResult(board, MSG_CANCELLED, jobId);
    return errorResult(board, MSG_UNREACHABLE, jobId);
  }
}

/** File name from a Content-Disposition header (RFC 6266 filename / filename*). */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

/** Default download name when the server did not send one. */
export function defaultArtifactFilename(result: CompileResult): string {
  const ext = result.artifactName?.endsWith('.hex') || result.board === 'uno' ? 'hex' : 'bin';
  return `circuito-vivo-${result.board}.${ext}`;
}
