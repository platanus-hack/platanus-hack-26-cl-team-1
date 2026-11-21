/**
 * workspaceToIR: Blockly JSON → Block IR. The JSON is loaded into a headless
 * Blockly.Workspace (events disabled, disposed afterwards) and the setup/loop
 * hats and function definitions are walked. Every IR node gets id = block id.
 * Stray top-level blocks are ignored and reported in `errors` (Spanish).
 * `issues` carries the same errors with the block they are about (for the editor UI).
 * A disabled «al iniciar» / «repetir para siempre» contributes nothing (it is greyed out).
 */
import * as Blockly from 'blockly';
import type { BinOp, Expr, FunctionDecl, ProgramIR, Stmt, VarDecl } from '@/contracts';
import { emptyProgram } from '@/contracts';
import type { ProgramContext } from '../context';
import { ARITH_OPS, B, BI, COMPARE_OPS, LOGIC_OPS, SINGLE_OPS, type PartExprKind } from './kinds';
import { registerBlocks } from './register';
import { checkerPlugin } from './checker';
import { withContext } from './live';
import { getVarMeta } from './varMeta';
import { isWorkspaceState } from './types';

type Block = Blockly.Block;

/** An error about the program, with the block it refers to when there is one. */
export interface ProgramIssue {
  message: string;
  blockId?: string;
}

const PART_EXPR_TYPES: Record<string, PartExprKind> = {
  [B.buttonPressed]: 'buttonPressed',
  [B.buttonClicked]: 'buttonClicked',
  [B.switchOn]: 'switchOn',
  [B.potPercent]: 'potPercent',
  [B.lightPercent]: 'lightPercent',
  [B.analogRaw]: 'analogRaw',
};

const BOOL_BINOPS = new Set<BinOp>(['==', '!=', '<', '<=', '>', '>=', '&&', '||']);
const BOOL_KINDS = new Set<string>(['bool', 'not', 'buttonPressed', 'buttonClicked', 'switchOn']);

/** Headless workspace that understands our blocks (lenient type checks). */
export function createHeadlessWorkspace(): Blockly.Workspace {
  registerBlocks();
  return new Blockly.Workspace(new Blockly.Options({ plugins: checkerPlugin } as Blockly.BlocklyOptions));
}

/** Load a serialized workspace without firing events. Returns a Spanish error on failure. */
export function loadSilently(ws: Blockly.Workspace, state: unknown, ctx?: ProgramContext | null): string | null {
  if (!isWorkspaceState(state)) return null;
  let error: string | null = null;
  withContext(ctx, () => {
    Blockly.Events.disable();
    try {
      Blockly.serialization.workspaces.load(state as Parameters<typeof Blockly.serialization.workspaces.load>[0], ws, { recordUndo: false });
    } catch (e) {
      error = `No se pudo cargar parte del programa: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      Blockly.Events.enable();
    }
  });
  return error;
}

class Walker {
  readonly errors: string[] = [];
  /** `errors` with the block each one is about. */
  readonly issues: ProgramIssue[] = [];

  error(message: string, blockId?: string): void {
    this.errors.push(message);
    this.issues.push(blockId ? { message, blockId } : { message });
  }

  /** var name → values assigned with "dar a … el valor" (for type inference). */
  readonly assigned = new Map<string, Expr[]>();
  /** vars used as numbers by construction (for counters, "sumar"). */
  readonly numeric = new Set<string>();

  private field(b: Block, name: string): string {
    const v = b.getFieldValue(name) as unknown;
    return v === null || v === undefined ? '' : String(v);
  }

  private varName(b: Block, name = 'VAR'): string {
    const f = b.getField(name);
    if (f instanceof Blockly.FieldVariable) return f.getVariable()?.getName() ?? '';
    return this.field(b, name);
  }

  private label(b: Block): string {
    try {
      return b.toString(40);
    } catch {
      return b.type;
    }
  }

  private expr(parent: Block, input: string, fallback: Expr): Expr {
    const child = parent.getInputTargetBlock(input);
    if (!child) {
      this.error(`Falta un valor en «${this.label(parent)}» (se usa ${describeFallback(fallback)}).`, parent.id);
      return fallback;
    }
    return this.toExpr(child);
  }

  private num(parent: Block, input: string): Expr {
    return this.expr(parent, input, { k: 'num', v: 0 });
  }

  private cond(parent: Block, input: string): Expr {
    return this.expr(parent, input, { k: 'bool', v: false });
  }

  stmts(first: Block | null): Stmt[] {
    const out: Stmt[] = [];
    for (let b = first; b; b = b.getNextBlock()) {
      if (!b.isEnabled()) continue;
      const s = this.toStmt(b);
      if (s) out.push(s);
    }
    return out;
  }

  private body(b: Block, input: string): Stmt[] {
    return this.stmts(b.getInputTargetBlock(input));
  }

  toStmt(b: Block): Stmt | null {
    const id = b.id;
    const part = () => this.field(b, 'PART');
    const pin = () => this.field(b, 'PIN');
    switch (b.type) {
      case B.delay:
        return { k: 'delay', id, ms: this.num(b, 'MS') };
      case B.waitUntil:
        return { k: 'waitUntil', id, cond: this.cond(b, 'COND') };
      case BI.if: {
        const branches: Array<{ cond: Expr; body: Stmt[] }> = [];
        for (let i = 0; b.getInput(`IF${i}`); i++) branches.push({ cond: this.cond(b, `IF${i}`), body: this.body(b, `DO${i}`) });
        const s: Stmt = { k: 'if', id, branches };
        if (b.getInput('ELSE')) s.else = this.body(b, 'ELSE');
        return s;
      }
      case BI.repeat:
        return { k: 'repeat', id, times: this.num(b, 'TIMES'), body: this.body(b, 'DO') };
      case BI.whileUntil: {
        const s: Stmt = { k: 'while', id, cond: this.cond(b, 'BOOL'), body: this.body(b, 'DO') };
        if (this.field(b, 'MODE') === 'UNTIL') s.until = true;
        return s;
      }
      case BI.for: {
        const v = this.varName(b);
        this.numeric.add(v);
        return { k: 'for', id, var: v, from: this.num(b, 'FROM'), to: this.num(b, 'TO'), by: this.num(b, 'BY'), body: this.body(b, 'DO') };
      }
      case BI.flow:
        return this.field(b, 'FLOW') === 'CONTINUE' ? { k: 'continue', id } : { k: 'break', id };
      case BI.procCall: {
        const getter = (b as unknown as { getProcedureCall?: () => string }).getProcedureCall;
        const name = typeof getter === 'function' ? getter.call(b) : this.field(b, 'NAME');
        return { k: 'call', id, name };
      }
      case BI.varSet: {
        const v = this.varName(b);
        const value = this.expr(b, 'VALUE', { k: 'num', v: 0 });
        const list = this.assigned.get(v) ?? [];
        list.push(value);
        this.assigned.set(v, list);
        return { k: 'set', id, var: v, value };
      }
      case BI.change: {
        const v = this.varName(b);
        this.numeric.add(v);
        return { k: 'change', id, var: v, delta: this.num(b, 'DELTA') };
      }
      case B.serialPrint:
        return { k: 'serialPrint', id, value: this.expr(b, 'VALUE', { k: 'str', v: '' }), newline: this.field(b, 'NEWLINE') !== 'FALSE' };
      case B.pinMode: {
        const mode = this.field(b, 'MODE');
        return { k: 'pinMode', id, pin: pin(), mode: mode === 'INPUT' || mode === 'INPUT_PULLUP' ? mode : 'OUTPUT' };
      }
      case B.digitalWrite:
        return { k: 'digitalWrite', id, pin: pin(), value: this.num(b, 'VALUE') };
      case B.analogWrite:
        return { k: 'analogWrite', id, pin: pin(), value: this.num(b, 'VALUE') };
      case B.tone:
        return { k: 'tone', id, pin: pin(), freq: this.num(b, 'FREQ') };
      case B.toneMs:
        return { k: 'tone', id, pin: pin(), freq: this.num(b, 'FREQ'), ms: this.num(b, 'MS') };
      case B.noTone:
        return { k: 'noTone', id, pin: pin() };
      case B.led:
        return { k: 'led', id, part: part(), on: this.cond(b, 'ON') };
      case B.ledBrightness:
        return { k: 'ledBrightness', id, part: part(), percent: this.num(b, 'PERCENT') };
      case B.rgb:
        return { k: 'rgb', id, part: part(), r: this.num(b, 'R'), g: this.num(b, 'G'), b: this.num(b, 'B') };
      case B.buzzerToneMs:
        return { k: 'buzzerTone', id, part: part(), freq: this.num(b, 'FREQ'), ms: this.num(b, 'MS') };
      case B.buzzerTone:
        return { k: 'buzzerTone', id, part: part(), freq: this.num(b, 'FREQ') };
      case B.buzzerOff:
        return { k: 'buzzerOff', id, part: part() };
      case B.servo:
        return { k: 'servo', id, part: part(), angle: this.num(b, 'ANGLE') };
      case B.motor:
        return { k: 'motor', id, part: part(), speed: this.num(b, 'SPEED') };
      case B.onboardLed:
        return { k: 'onboardLed', id, on: this.cond(b, 'ON') };
      case B.onboardRgb:
        return { k: 'onboardRgb', id, r: this.num(b, 'R'), g: this.num(b, 'G'), b: this.num(b, 'B') };
      default:
        this.error(`El bloque «${this.label(b)}» no se puede usar como instrucción y se ignora.`, b.id);
        return null;
    }
  }

  toExpr(b: Block): Expr {
    const id = b.id;
    const bin = (op: BinOp, ia: string, ib: string): Expr => ({ k: 'bin', id, op, a: this.num(b, ia), b: this.num(b, ib) });
    switch (b.type) {
      case BI.number: {
        const v = Number(this.field(b, 'NUM'));
        return { k: 'num', id, v: Number.isFinite(v) ? v : 0 };
      }
      case BI.boolean:
        return { k: 'bool', id, v: this.field(b, 'BOOL') === 'TRUE' };
      case B.onOff:
        return { k: 'bool', id, v: this.field(b, 'STATE') !== 'FALSE' };
      case B.pinLevel:
        return { k: 'num', id, v: this.field(b, 'LEVEL') === '0' ? 0 : 1 };
      case B.note: {
        const v = Number(this.field(b, 'NOTE'));
        return { k: 'num', id, v: Number.isFinite(v) ? v : 440 };
      }
      case BI.text:
        return { k: 'str', id, v: this.field(b, 'TEXT') };
      case BI.varGet:
        return { k: 'var', id, name: this.varName(b) };
      case BI.arithmetic:
        return bin(ARITH_OPS[this.field(b, 'OP')] ?? '+', 'A', 'B');
      case BI.modulo:
        return bin('%', 'DIVIDEND', 'DIVISOR');
      case BI.compare:
        return bin(COMPARE_OPS[this.field(b, 'OP')] ?? '==', 'A', 'B');
      case BI.operation:
        return { k: 'bin', id, op: LOGIC_OPS[this.field(b, 'OP')] ?? '&&', a: this.cond(b, 'A'), b: this.cond(b, 'B') };
      case BI.negate:
        return { k: 'not', id, a: this.cond(b, 'BOOL') };
      case BI.single: {
        const fn = SINGLE_OPS[this.field(b, 'OP')];
        const a = this.num(b, 'NUM');
        if (!fn) {
          this.error(`Operación desconocida en «${this.label(b)}» (se usa valor absoluto).`, b.id);
          return { k: 'math', id, fn: 'abs', a };
        }
        return fn === 'neg' ? { k: 'neg', id, a } : { k: 'math', id, fn, a };
      }
      case BI.randomInt:
        return { k: 'random', id, min: this.num(b, 'FROM'), max: this.num(b, 'TO') };
      case B.map:
        return {
          k: 'map',
          id,
          value: this.num(b, 'VALUE'),
          fromLow: this.num(b, 'FROM_LOW'),
          fromHigh: this.num(b, 'FROM_HIGH'),
          toLow: this.num(b, 'TO_LOW'),
          toHigh: this.num(b, 'TO_HIGH'),
        };
      case B.constrain:
        return { k: 'constrain', id, value: this.num(b, 'VALUE'), low: this.num(b, 'LOW'), high: this.num(b, 'HIGH') };
      case B.millis:
        return { k: 'millis', id };
      case B.digitalRead:
        return { k: 'digitalRead', id, pin: this.field(b, 'PIN') };
      case B.analogRead:
        return { k: 'analogRead', id, pin: this.field(b, 'PIN') };
      default: {
        const kind = PART_EXPR_TYPES[b.type];
        if (kind) return { k: kind, id, part: this.field(b, 'PART') };
        this.error(`El bloque «${this.label(b)}» no se puede usar como valor (se usa 0).`, b.id);
        return { k: 'num', id, v: 0 };
      }
    }
  }

  functionDecl(b: Block): FunctionDecl {
    const params = (b as unknown as { getVars?: () => string[] }).getVars?.call(b) ?? [];
    if (params.length) this.error(`La función «${this.field(b, 'NAME')}» tiene parámetros: no están soportados y se ignoran.`, b.id);
    return { id: b.id, name: this.field(b, 'NAME'), body: this.body(b, 'STACK') };
  }

  /** Variable declarations with type inference (boolean only if every assignment is boolean). */
  variables(ws: Blockly.Workspace): VarDecl[] {
    const meta = getVarMeta(ws);
    const models = ws.getVariableMap().getAllVariables();
    const types = new Map<string, VarDecl['type']>();
    for (const m of models) {
      const name = m.getName();
      const sets = this.assigned.get(name);
      const declared = meta[m.getId()]?.type;
      // An explicit 'number' declaration always wins (C doubles hold booleans too).
      if (this.numeric.has(name) || declared === 'number') types.set(name, 'number');
      else if (sets && sets.length) types.set(name, 'boolean');
      else types.set(name, declared ?? 'number');
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [name, sets] of this.assigned) {
        if (types.get(name) !== 'boolean') continue;
        if (!sets.every((e) => isBoolExpr(e, types))) {
          types.set(name, 'number');
          changed = true;
        }
      }
    }
    return models.map((m) => {
      const name = m.getName();
      const type = types.get(name) ?? 'number';
      const decl: VarDecl = { name, type };
      const init = meta[m.getId()]?.init;
      if (init !== undefined && typeof init === (type === 'boolean' ? 'boolean' : 'number')) decl.init = init;
      return decl;
    });
  }
}

function isBoolExpr(e: Expr, types: Map<string, VarDecl['type']>): boolean {
  if (BOOL_KINDS.has(e.k)) return true;
  if (e.k === 'bin') return BOOL_BINOPS.has(e.op);
  if (e.k === 'var') return types.get(e.name) === 'boolean';
  return false;
}

function describeFallback(e: Expr): string {
  if (e.k === 'num') return String(e.v);
  if (e.k === 'bool') return e.v ? 'verdadero' : 'falso';
  if (e.k === 'str') return 'texto vacío';
  return 'un valor por defecto';
}

/** Convert an already-loaded workspace (headless or rendered) to IR. */
export function irFromBlocklyWorkspace(ws: Blockly.Workspace, board: ProgramIR['board']): { ir: ProgramIR; errors: string[]; issues: ProgramIssue[] } {
  const w = new Walker();
  const ir = emptyProgram(board);
  let setupSeen = false;
  let loopSeen = false;
  const stray: string[] = [];
  let firstStray: string | undefined;
  for (const top of ws.getTopBlocks(true)) {
    if (top.type === B.setup || top.type === B.loop) {
      const isSetup = top.type === B.setup;
      const name = isSetup ? '«al iniciar»' : '«repetir para siempre»';
      if (isSetup ? setupSeen : loopSeen) w.error(`Hay más de un bloque ${name}: se unen en orden.`, top.id);
      if (isSetup) setupSeen = true;
      else loopSeen = true;
      // Greyed out with "Desactivar bloque": like a disabled function, its blocks do not run.
      if (!top.isEnabled()) {
        w.error(`${name} está desactivado: sus bloques no se ejecutan. Actívalo con clic derecho → «Activar bloque».`, top.id);
        continue;
      }
      (isSetup ? ir.setup : ir.loop).push(...w.stmts(top.getInputTargetBlock('DO')));
    } else if (top.type === BI.procDef) {
      if (top.isEnabled()) ir.functions.push(w.functionDecl(top));
    } else if (!top.isShadow()) {
      let text: string;
      try {
        text = top.toString(40);
      } catch {
        text = top.type;
      }
      stray.push(text);
      firstStray ??= top.id;
    }
  }
  if (stray.length) {
    const list = stray.slice(0, 3).map((s) => `«${s}»`).join(', ');
    const more = stray.length > 3 ? ` y ${stray.length - 3} más` : '';
    w.error(
      `${stray.length === 1 ? 'Hay 1 grupo de bloques suelto' : `Hay ${stray.length} grupos de bloques sueltos`} fuera de «al iniciar» y «repetir para siempre» (${list}${more}): no se ejecuta${stray.length === 1 ? '' : 'n'}.`,
      firstStray,
    );
  }
  const names = new Map<string, number>();
  const firstFn = new Map<string, string | undefined>();
  for (const f of ir.functions) {
    names.set(f.name, (names.get(f.name) ?? 0) + 1);
    if (!firstFn.has(f.name)) firstFn.set(f.name, f.id);
  }
  for (const [name, n] of names) if (n > 1) w.error(`Hay ${n} funciones llamadas «${name}».`, firstFn.get(name));
  ir.variables = w.variables(ws);
  return { ir, errors: w.errors, issues: w.issues };
}

export function workspaceToIR(workspace: unknown | null, ctx: ProgramContext | null): { ir: ProgramIR; errors: string[]; issues: ProgramIssue[] } {
  const board = ctx?.board?.id ?? null;
  if (!isWorkspaceState(workspace)) return { ir: emptyProgram(board), errors: [], issues: [] };
  let ws: Blockly.Workspace | null = null;
  try {
    ws = createHeadlessWorkspace();
    const loadError = loadSilently(ws, workspace, ctx);
    const result = withContext(ctx, () => irFromBlocklyWorkspace(ws!, board));
    if (loadError) {
      result.errors.unshift(loadError);
      result.issues.unshift({ message: loadError });
    }
    return result;
  } catch (e) {
    const message = `No se pudo leer el programa: ${e instanceof Error ? e.message : String(e)}`;
    return { ir: emptyProgram(board), errors: [message], issues: [{ message }] };
  } finally {
    ws?.dispose();
  }
}
