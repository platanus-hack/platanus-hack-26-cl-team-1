/** Shared compile / flash state (the agent's compile tool and CompilePanel see the same result). */
import { create } from 'zustand';
import type { CompileResult } from '@/contracts';

/**
 * Last compile, shared by CompilePanel and the agent's `compile` tool
 * (compileSketch publishes every status update here).
 */
export interface CompileStore {
  result: CompileResult | null;
  /** Code that produced `result` (to know if it is stale). */
  code: string | null;
  busy: boolean;
  /** Date.now() when the current/last compile started (elapsed timer). */
  startedAt: number | null;
}
export const useCompile = create<CompileStore>(() => ({ result: null, code: null, busy: false, startedAt: null }));

export interface FlashState {
  phase: 'idle' | 'flashing' | 'done' | 'error';
  fraction: number;
  message: string;
  error: { message: string; hint?: string; code: string } | null;
  /** jobId of the binary being / last flashed. */
  jobId: string | null;
}
export const useFlash = create<FlashState>(() => ({ phase: 'idle', fraction: 0, message: '', error: null, jobId: null }));
