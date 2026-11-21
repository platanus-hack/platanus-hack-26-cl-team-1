/**
 * Expression codegen. Every emitted expression carries its C static type so we
 * can (1) keep the NUMERIC MODEL (doubles, real division) even when the C
 * operands are integers and (2) pick the right print helper.
 */
import type { BinOp, Expr } from '@/contracts';
import { cString } from './helpers';
import { cleanText, resolveGenericPin, resolvePart } from './shared';
import { constKey, unboundPart, warn, type GenState } from './state';
import { hasSideEffects, type PartExpr } from './walk';

export type CType = 'double' | 'bool' | 'int' | 'long' | 'ulong' | 'str';

export interface CExpr {
  code: string;
  /** C precedence of the outermost operator (higher binds tighter). */
  prec: number;
  type: CType;
  /** Literal value when the expression is a plain literal. */
  lit?: number | boolean;
}

export const P = { atom: 100, unary: 90, mul: 80, add: 70, rel: 60, eq: 50, and: 40, or: 30 } as const;

export const isIntegral = (t: CType) => t === 'int' || t === 'long' || t === 'ulong' || t === 'bool';
export const numLitValue = (e: CExpr): number | undefined => (typeof e.lit === 'number' ? e.lit : undefined);

/** Number literal → C literal (ints stay ints; large values become doubles). */
export function numLit(v: number): CExpr {
  if (!Number.isFinite(v)) return { code: '0', prec: P.atom, type: 'int', lit: 0 };
  let code = String(v === 0 ? 0 : v);
  let type: CType = 'double';
  if (Number.isInteger(v)) {
    if (Math.abs(v) <= 32767) type = 'int';
    else if (Math.abs(v) <= 2147483647) type = 'long';
    else if (!/e/i.test(code)) code = `${code}.0`;
  }
  return { code, prec: v < 0 ? P.unary : P.atom, type, lit: v };
}

/** Same literal written as a double ('4' → '4.0') to force real arithmetic. */
function asDoubleLit(e: CExpr): CExpr {
  if (e.type === 'double' || typeof e.lit !== 'number') return e;
  return { ...e, code: `${e.code}.0`, type: 'double' };
}

export const wrapIf = (e: CExpr, cond: boolean) => (cond ? `(${e.code})` : e.code);

function operand(e: CExpr, prec: number, right: boolean): string {
  return wrapIf(e, e.prec < prec || (right && e.prec === prec) || (right && e.code.startsWith('-')));
}

/** `!x` / `!(a < b)`. */
export function notCode(e: CExpr): string {
  return `!${wrapIf(e, e.prec < P.unary)}`;
}

/** Condition operand of a ternary: compound expressions get parentheses for readability. */
export const ternaryCond = (e: CExpr) => wrapIf(e, e.prec < P.unary);

/** Argument of a function call. */
export const arg = (e: CExpr) => e.code;

const BOOL_FALLBACK: CExpr = { code: 'false', prec: P.atom, type: 'bool', lit: false };
const ZERO: CExpr = { code: '0', prec: P.atom, type: 'int', lit: 0 };

export function emitExpr(g: GenState, e: Expr): CExpr {
  if (!e || typeof e !== 'object') return ZERO;
  switch (e.k) {
    case 'num':
      return numLit(Number(e.v));
    case 'bool':
      return { code: e.v ? 'true' : 'false', prec: P.atom, type: 'bool', lit: !!e.v };
    case 'str':
      return { code: cString(String(e.v)), prec: P.atom, type: 'str' };
    case 'var': {
      const v = g.vars.get(e.name);
      if (!v) return ZERO;
      return { code: v.c, prec: P.atom, type: v.type === 'boolean' ? 'bool' : 'double' };
    }
    case 'bin':
      return emitBin(g, e.op, emitExpr(g, e.a), emitExpr(g, e.b));
    case 'not':
      return { code: notCode(emitExpr(g, e.a)), prec: P.unary, type: 'bool' };
    case 'neg': {
      const a = emitExpr(g, e.a);
      if (typeof a.lit === 'number') return numLit(-a.lit);
      if (a.type === 'ulong') return { code: `-(double) ${wrapIf(a, a.prec < P.unary)}`, prec: P.unary, type: 'double' };
      const inner = wrapIf(a, a.prec < P.unary || a.code.startsWith('-'));
      return { code: `-${inner}`, prec: P.unary, type: a.type === 'bool' ? 'int' : a.type };
    }
    case 'math':
      return emitMath(g, e.fn, emitExpr(g, e.a));
    case 'random': {
      const lo = emitExpr(g, e.min);
      const hi = emitExpr(g, e.max);
      const hiLit = numLitValue(hi);
      const top = hiLit !== undefined ? numLit(hiLit + 1).code : `${operand(hi, P.add, false)} + 1`;
      return { code: `random(${arg(lo)}, ${top})`, prec: P.atom, type: 'long' };
    }
    case 'map': {
      g.helpers.add('map');
      const args = [e.value, e.fromLow, e.fromHigh, e.toLow, e.toHigh].map((x) => arg(emitExpr(g, x)));
      return { code: `cv_map(${args.join(', ')})`, prec: P.atom, type: 'double' };
    }
    case 'constrain': {
      const parts = [e.value, e.low, e.high].map((x) => emitExpr(g, x));
      return constrainExpr(g, parts, [e.value, e.low, e.high].some(hasSideEffects));
    }
    case 'millis':
      return { code: 'millis()', prec: P.atom, type: 'ulong' };
    case 'digitalRead':
    case 'analogRead': {
      const pin = resolveGenericPin(g.board, e.pin);
      if (!pin) {
        warn(g, `El pin «${e.pin}» no existe en esta placa: la lectura devuelve 0.`, { blockId: e.id ?? g.blockId });
        g.pending.push(`// ⚠ El pin ${cleanText(String(e.pin))} no existe en esta placa (se usa 0)`);
        return ZERO;
      }
      return { code: `${e.k}(${pin.codeName})`, prec: P.atom, type: 'int' };
    }
    case 'buttonPressed':
    case 'buttonClicked':
    case 'switchOn':
    case 'potPercent':
    case 'lightPercent':
    case 'analogRaw':
      return emitPartSensor(g, e);
    default:
      warn(g, `Bloque de valor desconocido: «${(e as { k?: string }).k ?? '?'}».`, { blockId: g.blockId });
      return ZERO;
  }
}

/**
 * constrain(value, low, high). Arduino's constrain is a macro that evaluates
 * `value` up to three times (three random draws can land outside the range, a
 * click is consumed by the first call) and mixes signed/unsigned comparisons
 * with millis(); those cases use the cv_constrain() double helper instead.
 */
export function constrainExpr(g: GenState, parts: CExpr[], sideEffects: boolean): CExpr {
  if (sideEffects || parts.some((p) => p.type === 'ulong')) {
    g.helpers.add('constrain');
    return { code: `cv_constrain(${parts.map(arg).join(', ')})`, prec: P.atom, type: 'double' };
  }
  const type: CType = parts.some((p) => p.type === 'double') ? 'double' : 'long';
  return { code: `constrain(${parts.map(arg).join(', ')})`, prec: P.atom, type };
}

function emitBin(g: GenState, op: BinOp, a: CExpr, b: CExpr): CExpr {
  switch (op) {
    case '+':
    case '-':
    case '*': {
      const prec = op === '*' ? P.mul : P.add;
      const al = numLitValue(a);
      const bl = numLitValue(b);
      if (isIntegral(a.type) && isIntegral(b.type)) {
        const folded = al !== undefined && bl !== undefined ? (op === '+' ? al + bl : op === '-' ? al - bl : al * bl) : NaN;
        if (Math.abs(folded) <= 32767) {
          return { code: `${operand(a, prec, false)} ${op} ${operand(b, prec, true)}`, prec, type: 'int' };
        }
        // Integer operands would use C integer arithmetic (overflow / unsigned wrap): force doubles.
        if (bl !== undefined) b = asDoubleLit(b);
        else if (al !== undefined) a = asDoubleLit(a);
        else a = { code: `(double) ${wrapIf(a, a.prec < P.unary)}`, prec: P.unary, type: 'double' };
      }
      return { code: `${operand(a, prec, false)} ${op} ${operand(b, prec, true)}`, prec, type: 'double' };
    }
    case '/': {
      const bl = numLitValue(b);
      if (bl !== undefined && bl !== 0) {
        if (isIntegral(a.type)) b = asDoubleLit(b);
        return { code: `${operand(a, P.mul, false)} / ${operand(b, P.mul, true)}`, prec: P.mul, type: 'double' };
      }
      g.helpers.add('div');
      return { code: `cv_div(${arg(a)}, ${arg(b)})`, prec: P.atom, type: 'double' };
    }
    case '%': {
      const bl = numLitValue(b);
      if (bl !== undefined && bl !== 0) return { code: `fmod(${arg(a)}, ${arg(b)})`, prec: P.atom, type: 'double' };
      g.helpers.add('mod');
      return { code: `cv_mod(${arg(a)}, ${arg(b)})`, prec: P.atom, type: 'double' };
    }
    case '==':
    case '!=':
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const prec = op === '==' || op === '!=' ? P.eq : P.rel;
      const side = (x: CExpr) => wrapIf(x, x.prec <= P.rel);
      return { code: `${side(a)} ${op} ${side(b)}`, prec, type: 'bool' };
    }
    case '&&':
    case '||': {
      const prec = op === '&&' ? P.and : P.or;
      const side = (x: CExpr, right: boolean) => wrapIf(x, x.prec < prec || (right && x.prec === prec) || (op === '||' && x.prec === P.and));
      return { code: `${side(a, false)} ${op} ${side(b, true)}`, prec, type: 'bool' };
    }
    default:
      return ZERO;
  }
}

function emitMath(g: GenState, fn: string, a: CExpr): CExpr {
  switch (fn) {
    case 'abs':
      return { code: `fabs(${arg(a)})`, prec: P.atom, type: 'double' };
    case 'sqrt':
    case 'floor':
    case 'ceil':
      return { code: `${fn}(${arg(a)})`, prec: P.atom, type: 'double' };
    case 'round':
      // AVR's round() is a macro returning long; ESP32 uses the libm double version.
      return { code: `round(${arg(a)})`, prec: P.atom, type: g.board?.id === 'uno' ? 'long' : 'double' };
    case 'sin':
    case 'cos':
      return { code: `${fn}(${operand(a, P.mul, false)} * DEG_TO_RAD)`, prec: P.atom, type: 'double' };
    case 'pow10':
      return { code: `pow(10, ${arg(a)})`, prec: P.atom, type: 'double' };
    default:
      warn(g, `Función matemática desconocida: «${fn}».`, { blockId: g.blockId });
      return a;
  }
}

function emitPartSensor(g: GenState, e: PartExpr): CExpr {
  const isBool = e.k === 'buttonPressed' || e.k === 'buttonClicked' || e.k === 'switchOn';
  const r = resolvePart(g.ctx, g.board, e.part);
  if (!r) {
    const comment = unboundPart(g, e.part, e.id ?? g.blockId);
    g.pending.push(`${comment} (se usa ${isBool ? 'false' : '0'})`);
    return isBool ? BOOL_FALLBACK : ZERO;
  }
  const pin = g.partConsts.get(constKey(e.part)) ?? r.codeName;
  switch (e.k) {
    case 'buttonPressed':
    case 'switchOn':
      return { code: `digitalRead(${pin}) == ${r.binding.activeLow ? 'LOW' : 'HIGH'}`, prec: P.eq, type: 'bool' };
    case 'buttonClicked': {
      const fn = g.clickedHelpers.get(e.part);
      return fn ? { code: `${fn}()`, prec: P.atom, type: 'bool' } : BOOL_FALLBACK;
    }
    case 'potPercent':
    case 'lightPercent': {
      g.helpers.add('percent');
      const code = `cv_percent(analogRead(${pin}))`;
      return r.binding.invert ? { code: `100 - ${code}`, prec: P.add, type: 'double' } : { code, prec: P.atom, type: 'double' };
    }
    case 'analogRaw':
      return { code: `analogRead(${pin})`, prec: P.atom, type: 'int' };
    default:
      return ZERO;
  }
}
