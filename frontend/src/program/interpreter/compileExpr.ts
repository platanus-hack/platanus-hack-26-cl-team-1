/** Expression → closure compiler. Semantics mirror the generated C (see codegen/shared). */
import type { Expr } from '@/contracts';
import type { ProgramContext } from '../context';
import {
  constrain,
  cRound,
  cvDiv,
  cvMap,
  cvMod,
  DEG_TO_RAD,
  randomInRange,
  resolveGenericPin,
  resolvePart,
  sensorPercent,
  toNum,
  truthy,
  type Value,
} from '../codegen/shared';
import type { PartExpr } from '../codegen/walk';
import { InterpError, type Runtime } from './runtime';

export type Ev = () => Value;

export interface Slot {
  type: 'number' | 'boolean';
  v: number | boolean;
}

export interface CompileEnv {
  rt: Runtime;
  ctx: ProgramContext;
  slots: Map<string, Slot>;
}

const ZERO: Ev = () => 0;
const FALSE: Ev = () => false;

export function compileExpr(env: CompileEnv, e: Expr): Ev {
  if (!e || typeof e !== 'object') return ZERO;
  const { rt } = env;
  switch (e.k) {
    case 'num': {
      const v = Number(e.v);
      const n = Number.isFinite(v) ? v : 0;
      return () => n;
    }
    case 'bool': {
      const b = !!e.v;
      return () => b;
    }
    case 'str': {
      const s = String(e.v);
      return () => s;
    }
    case 'var': {
      const slot = env.slots.get(e.name);
      if (!slot) {
        const name = e.name;
        return () => {
          throw new InterpError(`La variable «${name}» no existe.`);
        };
      }
      return () => slot.v;
    }
    case 'bin':
      return compileBin(env, e.op, compileExpr(env, e.a), compileExpr(env, e.b));
    case 'not': {
      const a = compileExpr(env, e.a);
      return () => !truthy(a());
    }
    case 'neg': {
      const a = compileExpr(env, e.a);
      return () => -toNum(a());
    }
    case 'math': {
      const a = compileExpr(env, e.a);
      const f = MATH[e.fn];
      if (!f) return a;
      return () => f(toNum(a()));
    }
    case 'random': {
      const lo = compileExpr(env, e.min);
      const hi = compileExpr(env, e.max);
      return () => randomInRange(toNum(lo()), toNum(hi()), rt.rand);
    }
    case 'map': {
      const [v, a, b, c, d] = [e.value, e.fromLow, e.fromHigh, e.toLow, e.toHigh].map((x) => compileExpr(env, x));
      return () => cvMap(toNum(v()), toNum(a()), toNum(b()), toNum(c()), toNum(d()));
    }
    case 'constrain': {
      const [v, lo, hi] = [e.value, e.low, e.high].map((x) => compileExpr(env, x));
      return () => constrain(toNum(v()), toNum(lo()), toNum(hi()));
    }
    case 'millis':
      return () => rt.millis();
    case 'digitalRead': {
      const pin = resolveGenericPin(rt.board, e.pin);
      if (!pin) return ZERO;
      return () => rt.readDigital(pin.boardPin);
    }
    case 'analogRead': {
      const pin = resolveGenericPin(rt.board, e.pin);
      if (!pin) return ZERO;
      return () => rt.readAnalog(pin.boardPin);
    }
    case 'buttonPressed':
    case 'buttonClicked':
    case 'switchOn':
    case 'potPercent':
    case 'lightPercent':
    case 'analogRaw':
      return compileSensor(env, e);
    default:
      return ZERO;
  }
}

const MATH: Record<string, (x: number) => number> = {
  abs: Math.abs,
  sqrt: Math.sqrt,
  round: cRound,
  floor: Math.floor,
  ceil: Math.ceil,
  sin: (x) => Math.sin(x * DEG_TO_RAD),
  cos: (x) => Math.cos(x * DEG_TO_RAD),
  pow10: (x) => Math.pow(10, x),
};

function compileBin(env: CompileEnv, op: string, a: Ev, b: Ev): Ev {
  switch (op) {
    case '+':
      return () => toNum(a()) + toNum(b());
    case '-':
      return () => toNum(a()) - toNum(b());
    case '*':
      return () => toNum(a()) * toNum(b());
    case '/':
      return () => cvDiv(toNum(a()), toNum(b()));
    case '%':
      return () => cvMod(toNum(a()), toNum(b()));
    case '==':
      return () => toNum(a()) === toNum(b());
    case '!=':
      return () => toNum(a()) !== toNum(b());
    case '<':
      return () => toNum(a()) < toNum(b());
    case '<=':
      return () => toNum(a()) <= toNum(b());
    case '>':
      return () => toNum(a()) > toNum(b());
    case '>=':
      return () => toNum(a()) >= toNum(b());
    case '&&':
      return () => truthy(a()) && truthy(b());
    case '||':
      return () => truthy(a()) || truthy(b());
    default:
      void env;
      return ZERO;
  }
}

function compileSensor(env: CompileEnv, e: PartExpr): Ev {
  const { rt, ctx } = env;
  const r = resolvePart(ctx, rt.board, e.part);
  const isBool = e.k === 'buttonPressed' || e.k === 'buttonClicked' || e.k === 'switchOn';
  if (!r) return isBool ? FALSE : ZERO;
  const pin = r.boardPin;
  const active = r.binding.activeLow ? 0 : 1;
  switch (e.k) {
    case 'buttonPressed':
    case 'switchOn':
      return () => rt.readDigital(pin) === active;
    case 'buttonClicked': {
      // Mirrors the generated clicked_<PART>() helper (state shared per part).
      let st = rt.clicks.get(e.part);
      if (!st) rt.clicks.set(e.part, (st = { prev: false, last: 0 }));
      const state = st;
      return () => {
        const pressed = rt.readDigital(pin) === active;
        const now = rt.millis();
        if (pressed !== state.prev && now - state.last >= 30) {
          state.prev = pressed;
          state.last = now;
          return pressed;
        }
        return false;
      };
    }
    case 'potPercent':
    case 'lightPercent': {
      const max = rt.board?.adc.maxValue ?? 1023;
      const invert = r.binding.invert;
      return () => sensorPercent(rt.readAnalog(pin), max, invert);
    }
    case 'analogRaw':
      return () => rt.readAnalog(pin);
    default:
      return ZERO;
  }
}
