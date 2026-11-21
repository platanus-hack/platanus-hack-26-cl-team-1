/** Tiny Block IR constructors used by the example programs. */
import type { BoardId, Expr, ProgramIR, Stmt, VarDecl } from '@/contracts';

export const num = (v: number): Expr => ({ k: 'num', v });
export const bool = (v: boolean): Expr => ({ k: 'bool', v });
export const ref = (name: string): Expr => ({ k: 'var', name });
export const sub = (a: Expr, b: Expr): Expr => ({ k: 'bin', op: '-', a, b });

export const delay = (ms: number): Stmt => ({ k: 'delay', ms: num(ms) });
export const led = (part: string, on: boolean): Stmt => ({ k: 'led', part, on: bool(on) });
export const rgb = (part: string, r: Expr, g: Expr, b: Expr): Stmt => ({ k: 'rgb', part, r, g, b });
export const motor = (part: string, speed: number): Stmt => ({ k: 'motor', part, speed: num(speed) });

export function forRange(v: string, from: number, to: number, by: number, body: Stmt[]): Stmt {
  return { k: 'for', var: v, from: num(from), to: num(to), by: num(by), body };
}

export function program(board: BoardId | null, parts: { setup?: Stmt[]; loop: Stmt[]; variables?: VarDecl[] }): ProgramIR {
  return { version: 1, board, variables: parts.variables ?? [], setup: parts.setup ?? [], loop: parts.loop, functions: [] };
}
