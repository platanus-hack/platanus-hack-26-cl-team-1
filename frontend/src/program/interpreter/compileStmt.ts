/**
 * Statement compiler: simple statements become plain closures, statements that
 * can suspend (delay, loops, calls…) become generators that yield a wake tick
 * (or PAUSE). See runtime.ts for the clock / budget model.
 */
import type { Stmt } from '@/contracts';
import { formatValue, resolveGenericPin, toDelayMs, toNum, toPwm, truthy, type Value } from '../codegen/shared';
import { compilePartAction } from './compileParts';
import { compileExpr, type Slot } from './compileExpr';
import { BREAK, CONTINUE, digitalOut, NORMAL, noop, type CStmt, type Gen, type StmtEnv } from './env';
import { InterpError, MAX_CALL_DEPTH, PAUSE, TICKS_PER_MS, type Runtime } from './runtime';

/** Yield PAUSE until the runtime lets us continue (clock target / budget). */
export function* pause(rt: Runtime): Generator<number, void, void> {
  while (rt.mustPause) yield PAUSE;
}

export function* runBlock(rt: Runtime, block: CStmt[]): Gen {
  for (let i = 0; i < block.length; i++) {
    const s = block[i];
    if (rt.mustPause) yield* pause(rt);
    if (rt.toneTimers.size > 0) rt.fireTimers(rt.ticks);
    rt.ops++;
    if (s.id) rt.host.onBlock?.(s.id);
    let flow: unknown;
    if (s.sync) {
      flow = s.sync();
      rt.ticks += 1;
    } else flow = yield* s.gen!();
    // Only explicit loop signals propagate (sync closures may return host values).
    if (flow === BREAK || flow === CONTINUE) return flow;
  }
  return NORMAL;
}

/** One loop-header evaluation: may pause, counts as a statement. */
function* loopTick(rt: Runtime): Generator<number, void, void> {
  if (rt.mustPause) yield* pause(rt);
  rt.ops++;
  rt.ticks += 1;
}

const assign = (slot: Slot, v: Value) => {
  slot.v = slot.type === 'boolean' ? truthy(v) : toNum(v);
};

export function compileBlock(env: StmtEnv, stmts: readonly Stmt[] | undefined, inLoop: boolean): CStmt[] {
  const out: CStmt[] = [];
  for (const s of stmts ?? []) {
    if (!s || typeof s !== 'object') continue;
    const c = compileStmt(env, s, inLoop);
    if (s.id) c.id = s.id;
    out.push(c);
  }
  return out;
}


function compileStmt(env: StmtEnv, s: Stmt, inLoop: boolean): CStmt {
  const { rt } = env;
  const ex = (e: Parameters<typeof compileExpr>[1]) => compileExpr(env, e);
  switch (s.k) {
    case 'pinMode': {
      const pin = resolveGenericPin(rt.board, s.pin);
      const mode = s.mode;
      return pin ? { sync: () => rt.host.pinMode(pin.boardPin, mode) } : noop();
    }
    case 'digitalWrite': {
      const pin = resolveGenericPin(rt.board, s.pin);
      const v = ex(s.value);
      return pin ? { sync: () => digitalOut(env, pin.boardPin, truthy(v())) } : noop();
    }
    case 'analogWrite': {
      const pin = resolveGenericPin(rt.board, s.pin);
      const v = ex(s.value);
      return pin ? { sync: () => rt.writePwm(pin.boardPin, toPwm(toNum(v()))) } : noop();
    }
    case 'tone': {
      const pin = resolveGenericPin(rt.board, s.pin);
      const f = ex(s.freq);
      const ms = s.ms ? ex(s.ms) : null;
      return pin ? { sync: () => rt.startTone(pin.boardPin, toNum(f()), ms ? toNum(ms()) : undefined) } : noop();
    }
    case 'noTone': {
      const pin = resolveGenericPin(rt.board, s.pin);
      return pin ? { sync: () => rt.stopTone(pin.boardPin) } : noop();
    }
    case 'delay': {
      const ms = ex(s.ms);
      return {
        *gen() {
          const d = toDelayMs(toNum(ms()));
          if (d <= 0) rt.ticks += 1;
          else yield rt.ticks + d * TICKS_PER_MS;
          return NORMAL;
        },
      };
    }
    case 'waitUntil': {
      const cond = ex(s.cond);
      return {
        *gen() {
          for (;;) {
            yield* loopTick(rt);
            if (truthy(cond())) return NORMAL;
            yield rt.ticks + TICKS_PER_MS; // delay(1)
          }
        },
      };
    }
    case 'if': {
      const branches = (Array.isArray(s.branches) ? s.branches : []).map((b) => ({ cond: ex(b.cond), body: compileBlock(env, b.body, inLoop) }));
      const elseBody = compileBlock(env, s.else, inLoop);
      return {
        *gen() {
          rt.ticks += 1;
          for (const b of branches) if (truthy(b.cond())) return yield* runBlock(rt, b.body);
          return yield* runBlock(rt, elseBody);
        },
      };
    }
    case 'repeat': {
      const times = ex(s.times);
      const body = compileBlock(env, s.body, true);
      return {
        *gen() {
          // N is evaluated once, before the first turn (mirrors codegen emitRepeat).
          const n = toNum(times());
          for (let i = 0; ; i++) {
            yield* loopTick(rt);
            if (!(i < n)) break;
            if ((yield* runBlock(rt, body)) === BREAK) break;
          }
          return NORMAL;
        },
      };
    }
    case 'while': {
      const cond = ex(s.cond);
      const until = !!s.until;
      const body = compileBlock(env, s.body, true);
      return {
        *gen() {
          for (;;) {
            yield* loopTick(rt);
            const c = truthy(cond());
            if (until ? c : !c) break;
            if ((yield* runBlock(rt, body)) === BREAK) break;
          }
          return NORMAL;
        },
      };
    }
    case 'for':
      return compileFor(env, s);
    case 'break':
      return { sync: () => (inLoop ? BREAK : NORMAL) };
    case 'continue':
      return { sync: () => (inLoop ? CONTINUE : NORMAL) };
    case 'call': {
      const name = s.name;
      return {
        *gen() {
          rt.ticks += 1;
          const body = env.functions.get(name);
          if (!body) throw new InterpError(`La función «${name}» no existe (¿la borraste?).`);
          if (rt.depth >= MAX_CALL_DEPTH) throw new InterpError(`Demasiadas llamadas anidadas a funciones (¿«${name}» se llama a sí misma sin parar?).`);
          rt.depth++;
          try {
            yield* runBlock(rt, body);
          } finally {
            rt.depth--;
          }
          return NORMAL;
        },
      };
    }
    case 'set': {
      const slot = env.slots.get(s.var);
      const v = ex(s.value);
      return slot ? { sync: () => assign(slot, v()) } : missingVar(s.var);
    }
    case 'change': {
      const slot = env.slots.get(s.var);
      const d = ex(s.delta);
      return slot ? { sync: () => assign(slot, toNum(slot.v) + toNum(d())) } : missingVar(s.var);
    }
    case 'serialPrint': {
      const v = ex(s.value);
      const nl = s.newline ? '\n' : '';
      return { sync: () => rt.host.serial(formatValue(v()) + nl) };
    }
    case 'onboardLed': {
      const on = ex(s.on);
      const led = rt.board?.onboard.find((o) => o.kind === 'led');
      if (led) {
        const pin = resolveGenericPin(rt.board, led.pin)?.boardPin ?? led.pin;
        return { sync: () => rt.host.digitalWrite(pin, truthy(on()) ? 1 : 0) };
      }
      if (rt.board?.onboard.some((o) => o.kind === 'rgb-ws2812')) {
        return {
          sync: () => {
            const v = truthy(on()) ? 255 : 0;
            rt.host.onboardRgb(v, v, v);
          },
        };
      }
      return noop();
    }
    case 'onboardRgb': {
      if (!rt.board?.onboard.some((o) => o.kind === 'rgb-ws2812')) return noop();
      const [r, g, b] = [s.r, s.g, s.b].map(ex);
      return { sync: () => rt.host.onboardRgb(toPwm(toNum(r())), toPwm(toNum(g())), toPwm(toNum(b()))) };
    }
    case 'led':
    case 'ledBrightness':
    case 'rgb':
    case 'buzzerTone':
    case 'buzzerOff':
    case 'servo':
    case 'motor':
      return compilePartAction(env, s);
    default:
      return noop();
  }
}

function missingVar(name: string): CStmt {
  return {
    sync: () => {
      throw new InterpError(`La variable «${name}» no existe.`);
    },
  };
}

/** Counting loop: bounds and step evaluated once; works up or down (mirrors codegen). */
function compileFor(env: StmtEnv, s: Extract<Stmt, { k: 'for' }>): CStmt {
  const { rt } = env;
  const slot = env.slots.get(s.var);
  if (!slot) return missingVar(s.var);
  const [from, to, by] = [s.from, s.to, s.by].map((e) => compileExpr(env, e));
  const body = compileBlock(env, s.body, true);
  return {
    *gen() {
      const a = toNum(from());
      const b = toNum(to());
      let step = Math.abs(toNum(by()));
      if (a > b) step = -step;
      assign(slot, a);
      for (;;) {
        yield* loopTick(rt);
        const x = toNum(slot.v);
        if (!(step > 0 ? x <= b : x >= b)) break;
        if ((yield* runBlock(rt, body)) === BREAK) break;
        assign(slot, toNum(slot.v) + step);
      }
      return NORMAL;
    },
  };
}
