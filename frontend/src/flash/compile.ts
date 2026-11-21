/** compileSketch: POST + poll, publishing every status update in useCompile. */
import type { BoardId, CompileResult } from '@/contracts';
import { mapDiagnostics, requestCompile, type ClientDeps, defaultDeps } from './client';
import { useCompile } from './store';

export interface CompileOptions {
  onStatus?: (r: CompileResult) => void;
  signal?: AbortSignal;
  /** codegen lineMap (1-based line → block id): diagnostics get `blockId` before being published. */
  lineMap?: Record<number, string>;
}

let compileSeq = 0;

/**
 * Publish a result produced without contacting the server (no board, codegen failure). It also
 * supersedes any compile still polling, so that one cannot overwrite this newer state later.
 */
export function publishLocalResult(r: CompileResult): void {
  compileSeq++;
  useCompile.setState({ result: r, code: null, busy: false, startedAt: null });
}

/** POST /api/compile then poll /api/compile/{id} until success|error. Never throws. */
export async function compileSketch(board: BoardId, code: string, opts: CompileOptions = {}, deps: ClientDeps = defaultDeps()): Promise<CompileResult> {
  const seq = ++compileSeq;
  const startedAt = deps.now();
  const publish = (r: CompileResult, busy: boolean): CompileResult => {
    const mapped = { ...r, diagnostics: mapDiagnostics(r.diagnostics, opts.lineMap) };
    // Only the most recent compile owns the shared store (agent + user may overlap).
    if (seq === compileSeq) useCompile.setState({ result: mapped, code, busy, startedAt });
    opts.onStatus?.(mapped);
    return mapped;
  };
  publish({ jobId: '', status: 'queued', board, fqbn: '', diagnostics: [], log: '' }, true);
  const final = await requestCompile(board, code, { signal: opts.signal, onStatus: (r) => publish(r, true) }, deps);
  return publish(final.durationMs === undefined ? { ...final, durationMs: deps.now() - startedAt } : final, false);
}
