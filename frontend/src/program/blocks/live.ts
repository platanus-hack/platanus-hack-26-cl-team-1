/**
 * Where dynamic dropdowns (parts, pins) get their hardware context from:
 * the live project by default, or an explicit context while a converter runs
 * (workspaceToIR loads blocks with the ctx it was given, never the store).
 */
import { getProject } from '@/store/project';
import { programContext, type ProgramContext } from '../context';

let override: ProgramContext | null = null;

export function liveContext(): ProgramContext | null {
  if (override) return override;
  try {
    return programContext(getProject());
  } catch {
    return null;
  }
}

/** Run `fn` with dropdown generators reading `ctx` instead of the live project. */
export function withContext<T>(ctx: ProgramContext | null | undefined, fn: () => T): T {
  if (!ctx) return fn();
  const prev = override;
  override = ctx;
  try {
    return fn();
  } finally {
    override = prev;
  }
}
