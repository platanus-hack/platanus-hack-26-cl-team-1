/**
 * Generic Block IR traversal helpers (used by codegen, checks and interpreter).
 */
import type { Expr, FunctionDecl, Id, ProgramIR, Stmt } from '@/contracts';

/** Part-level statements / expressions (resolved through Bindings). */
export type PartStmt = Extract<Stmt, { part: Id }>;
export type PartExpr = Extract<Expr, { part: Id }>;
export type PartNode = PartStmt | PartExpr;
export type PinNode = Extract<Stmt | Expr, { pin: string }>;

/** Direct child expressions of a statement (bodies excluded). */
export function stmtExprs(s: Stmt): Expr[] {
  switch (s.k) {
    case 'digitalWrite':
    case 'analogWrite':
      return [s.value];
    case 'tone':
      return s.ms ? [s.freq, s.ms] : [s.freq];
    case 'delay':
      return [s.ms];
    case 'waitUntil':
      return [s.cond];
    case 'if':
      return s.branches.map((b) => b.cond);
    case 'repeat':
      return [s.times];
    case 'while':
      return [s.cond];
    case 'for':
      return [s.from, s.to, s.by];
    case 'set':
      return [s.value];
    case 'change':
      return [s.delta];
    case 'serialPrint':
      return [s.value];
    case 'led':
      return [s.on];
    case 'ledBrightness':
      return [s.percent];
    case 'rgb':
    case 'onboardRgb':
      return [s.r, s.g, s.b];
    case 'buzzerTone':
      return s.ms ? [s.freq, s.ms] : [s.freq];
    case 'servo':
      return [s.angle];
    case 'motor':
      return [s.speed];
    case 'onboardLed':
      return [s.on];
    default:
      return [];
  }
}

/** Nested statement lists of a statement. */
export function stmtBodies(s: Stmt): Stmt[][] {
  switch (s.k) {
    case 'if':
      return [...s.branches.map((b) => b.body ?? []), ...(s.else ? [s.else] : [])];
    case 'repeat':
    case 'while':
    case 'for':
      return [s.body ?? []];
    default:
      return [];
  }
}

/** Direct child expressions of an expression. */
export function exprChildren(e: Expr): Expr[] {
  switch (e.k) {
    case 'bin':
      return [e.a, e.b];
    case 'not':
    case 'neg':
    case 'math':
      return [e.a];
    case 'random':
      return [e.min, e.max];
    case 'map':
      return [e.value, e.fromLow, e.fromHigh, e.toLow, e.toHigh];
    case 'constrain':
      return [e.value, e.low, e.high];
    default:
      return [];
  }
}

export interface Visitor {
  stmt?(s: Stmt): void;
  expr?(e: Expr, owner: Stmt): void;
}

function visitExpr(e: Expr | undefined, owner: Stmt, v: Visitor): void {
  if (!e || typeof e !== 'object') return;
  v.expr?.(e, owner);
  for (const c of exprChildren(e)) visitExpr(c, owner, v);
}

export function visitStmts(stmts: readonly Stmt[] | undefined, v: Visitor): void {
  if (!Array.isArray(stmts)) return;
  for (const s of stmts) {
    if (!s || typeof s !== 'object') continue;
    v.stmt?.(s);
    for (const e of stmtExprs(s)) visitExpr(e, s, v);
    for (const body of stmtBodies(s)) visitStmts(body, v);
  }
}

/** Every top-level statement list of a program (setup, loop, function bodies). */
export function programBlocks(ir: ProgramIR): Stmt[][] {
  const fns: FunctionDecl[] = Array.isArray(ir.functions) ? ir.functions : [];
  return [ir.setup ?? [], ir.loop ?? [], ...fns.map((f) => f.body ?? [])];
}

export function visitProgram(ir: ProgramIR, v: Visitor): void {
  for (const block of programBlocks(ir)) visitStmts(block, v);
}

export const isPartNode = (n: Stmt | Expr): n is PartNode =>
  typeof (n as { part?: unknown }).part === 'string';

export const isPinNode = (n: Stmt | Expr): n is PinNode =>
  typeof (n as { pin?: unknown }).pin === 'string';

/** True when the program has no statement at all (nothing to run). */
export const isEmptyProgram = (ir: ProgramIR) => (ir.setup ?? []).length === 0 && (ir.loop ?? []).length === 0;

/**
 * True when evaluating `e` twice is observable: random draws a new number and
 * buttonClicked consumes the click. Such values must not be passed to Arduino
 * macros that repeat their arguments (constrain, AVR round).
 */
export function hasSideEffects(e: Expr | undefined): boolean {
  if (!e || typeof e !== 'object') return false;
  if (e.k === 'random' || e.k === 'buttonClicked') return true;
  return exprChildren(e).some(hasSideEffects);
}
