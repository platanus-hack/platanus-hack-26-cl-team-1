/**
 * Test helpers: build a ProgramContext and IR nodes without the store/circuit.
 * Used by codegen and interpreter tests only.
 */
import type { Binding, BoardId, Expr, PartInstance, ProgramIR, Stmt } from '@/contracts';
import { getBoardProfile } from '@/catalog';
import type { ProgramContext } from '../context';

export interface PartSpec {
  id: string;
  type: string;
  label: string;
}

export type BindingSpec = Partial<Binding> & { part: string; boardPin: string | null };

export function makeCtx(board: BoardId | null, parts: PartSpec[], bindings: BindingSpec[], name = 'Prueba'): ProgramContext {
  const profile = board ? getBoardProfile(board) : null;
  const boardPart: PartInstance[] = board
    ? [{ id: board === 'uno' ? 'uno1' : 'esp1', type: board === 'uno' ? 'arduino-uno' : 'esp32c6-devkit', label: profile!.name, x: 0, y: 0, rotation: 0, props: {} }]
    : [];
  const now = new Date(0).toISOString();
  return {
    project: {
      version: 1,
      id: 'p1',
      name,
      parts: [...boardPart, ...parts.map((p) => ({ ...p, x: 0, y: 0, rotation: 0 as const, props: {} }))],
      wires: [],
      program: { workspace: null },
      meta: { createdAt: now, updatedAt: now },
    },
    board: profile,
    boardPartId: boardPart[0]?.id ?? null,
    bindings: bindings.map((b) => ({
      pin: 'anode',
      codeName: b.boardPin && profile ? (profile.pins.find((p) => p.id === b.boardPin)?.codeName ?? null) : null,
      activeLow: false,
      mode: 'OUTPUT',
      driver: 'direct',
      via: [],
      ...b,
    })),
  };
}

export const ir = (p: Partial<ProgramIR>): ProgramIR => ({ version: 1, board: null, variables: [], setup: [], loop: [], functions: [], ...p });

/* Tiny IR builders to keep tests readable. */
export const num = (v: number): Expr => ({ k: 'num', v });
export const bool = (v: boolean): Expr => ({ k: 'bool', v });
export const str = (v: string): Expr => ({ k: 'str', v });
export const v = (name: string): Expr => ({ k: 'var', name });
export const bin = (op: Extract<Expr, { k: 'bin' }>['op'], a: Expr, b: Expr): Expr => ({ k: 'bin', op, a, b });
export const delay = (ms: number | Expr, id?: string): Stmt => ({ k: 'delay', ms: typeof ms === 'number' ? num(ms) : ms, id });
export const led = (part: string, on: boolean | Expr, id?: string): Stmt => ({ k: 'led', part, on: typeof on === 'boolean' ? bool(on) : on, id });
export const set = (name: string, value: Expr, id?: string): Stmt => ({ k: 'set', var: name, value, id });
export const print = (value: Expr, newline = true, id?: string): Stmt => ({ k: 'serialPrint', value, newline, id });
