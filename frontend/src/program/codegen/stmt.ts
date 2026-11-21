/** Statement codegen (2-space indentation, Spanish comments, lineMap per block). */
import type { Stmt } from '@/contracts';
import { arg, emitExpr, isIntegral, notCode, numLit, numLitValue, P, wrapIf } from './expr';
import { delayComment, digitalOut, line, msValue, pwmValue, pwmWarning, toneCode } from './emit-utils';
import { emitOnboardLed, emitPartAction } from './parts';
import { cleanText, resolveGenericPin, toDelayMs } from './shared';
import { flushPending, warn, type GenState } from './state';

export function emitBlock(g: GenState, stmts: readonly Stmt[] | undefined): void {
  for (const s of stmts ?? []) {
    if (s && typeof s === 'object') emitStmt(g, s);
  }
}

function emitBody(g: GenState, stmts: readonly Stmt[] | undefined, isLoop = false): void {
  g.out.indent();
  if (isLoop) g.loopDepth++;
  emitBlock(g, stmts);
  if (isLoop) g.loopDepth--;
  g.out.dedent();
}

export function emitStmt(g: GenState, s: Stmt): void {
  const prevId = g.blockId;
  const id = s.id ?? prevId;
  g.blockId = id;
  try {
    emit(g, s, id);
  } finally {
    g.blockId = prevId;
    g.pending = [];
  }
}

function genericPin(g: GenState, pin: string, id: string | undefined): string | null {
  const r = resolveGenericPin(g.board, pin);
  if (r) return r.codeName;
  warn(g, `El pin «${pin}» no existe en esta placa: ese bloque se omitió.`, { blockId: id });
  line(g, `// ⚠ El pin ${cleanText(String(pin))} no existe en esta placa`, id);
  return null;
}

function emit(g: GenState, s: Stmt, id: string | undefined): void {
  switch (s.k) {
    case 'pinMode': {
      const pin = genericPin(g, s.pin, id);
      if (pin) line(g, `pinMode(${pin}, ${s.mode});`, id);
      return;
    }
    case 'digitalWrite': {
      const v = emitExpr(g, s.value);
      const pin = genericPin(g, s.pin, id);
      const r = resolveGenericPin(g.board, s.pin);
      if (pin && r) digitalOut(g, pin, r.boardPin, v, false, id);
      return;
    }
    case 'analogWrite': {
      const v = emitExpr(g, s.value);
      const r = resolveGenericPin(g.board, s.pin);
      const pin = genericPin(g, s.pin, id);
      if (!pin || !r) return;
      pwmWarning(g, r, `El bloque analogWrite`, id);
      line(g, `analogWrite(${pin}, ${pwmValue(g, v).code});`, id);
      return;
    }
    case 'tone': {
      const f = emitExpr(g, s.freq);
      const ms = s.ms ? emitExpr(g, s.ms) : null;
      const pin = genericPin(g, s.pin, id);
      if (!pin) return;
      const t = toneCode(g, pin, f, ms);
      line(g, t.code, id, t.silent ? 'frecuencia menor que 1 Hz: silencio' : undefined);
      return;
    }
    case 'noTone': {
      const pin = genericPin(g, s.pin, id);
      if (pin) line(g, `noTone(${pin});`, id);
      return;
    }
    case 'delay': {
      const ms = emitExpr(g, s.ms);
      const lit = numLitValue(ms);
      line(g, `delay(${msValue(g, ms)});`, id, lit !== undefined ? delayComment(toDelayMs(lit)) : undefined);
      return;
    }
    case 'waitUntil': {
      const c = emitExpr(g, s.cond);
      line(g, `while (${notCode(c)}) delay(1);`, id, 'espera hasta que se cumpla la condición');
      return;
    }
    case 'if': {
      const branches = Array.isArray(s.branches) ? s.branches : [];
      if (branches.length === 0) {
        emitBlock(g, s.else);
        return;
      }
      branches.forEach((b, i) => {
        const c = emitExpr(g, b.cond);
        if (i === 0) line(g, `if (${c.code}) {`, id);
        else {
          flushPending(g, id);
          g.out.line(`} else if (${c.code}) {`, id);
        }
        emitBody(g, b.body);
      });
      if (s.else && s.else.length) {
        g.out.line('} else {', id);
        emitBody(g, s.else);
      }
      g.out.line('}', id);
      return;
    }
    case 'repeat':
      emitRepeat(g, s, id);
      return;
    case 'while': {
      const c = emitExpr(g, s.cond);
      line(g, `while (${s.until ? notCode(c) : c.code}) {`, id);
      emitBody(g, s.body, true);
      g.out.line('}', id);
      return;
    }
    case 'for':
      emitFor(g, s, id);
      return;
    case 'break':
    case 'continue':
      if (g.loopDepth > 0) line(g, `${s.k};`, id);
      else {
        warn(g, `«${s.k === 'break' ? 'salir del bucle' : 'continuar con la siguiente vuelta'}» solo funciona dentro de un bucle: se omitió.`, { blockId: id });
        line(g, `// ⚠ ${s.k} fuera de un bucle (se omitió)`, id);
      }
      return;
    case 'call': {
      const fn = g.functions.get(s.name);
      if (fn) line(g, `${fn}();`, id);
      else {
        warn(g, `La función «${s.name}» no existe: ese bloque se omitió.`, { blockId: id });
        line(g, `// ⚠ La función ${cleanText(String(s.name))} no existe`, id);
      }
      return;
    }
    case 'set': {
      const v = g.vars.get(s.var);
      const val = emitExpr(g, s.value);
      if (v) line(g, `${v.c} = ${val.type === 'str' ? '0' : val.code};`, id);
      return;
    }
    case 'change': {
      const v = g.vars.get(s.var);
      const d = emitExpr(g, s.delta);
      if (!v) return;
      const dl = numLitValue(d);
      if (v.type === 'boolean') line(g, `${v.c} = ${v.c} + ${wrapIf(d, d.prec <= P.add || d.code.startsWith('-'))};`, id);
      else if (dl === 1) line(g, `${v.c}++;`, id);
      else if (dl === -1) line(g, `${v.c}--;`, id);
      else if (dl !== undefined && dl < 0) line(g, `${v.c} -= ${numLit(-dl).code};`, id);
      else line(g, `${v.c} += ${d.code};`, id);
      return;
    }
    case 'serialPrint': {
      const v = emitExpr(g, s.value);
      const fn = s.newline ? 'println' : 'print';
      if (v.type === 'str') line(g, `Serial.${fn}(${v.code});`, id);
      else if (v.type === 'bool') {
        g.helpers.add('printBool');
        line(g, `cvPrint${s.newline ? 'ln' : ''}(${v.code});`, id);
      } else if (isIntegral(v.type)) line(g, `Serial.${fn}(${v.code});`, id);
      else {
        g.helpers.add('printNum');
        line(g, `cvPrint${s.newline ? 'ln' : ''}(${v.code});`, id);
      }
      return;
    }
    case 'onboardLed':
      emitOnboardLed(g, s.on, id);
      return;
    case 'onboardRgb': {
      const vals = [s.r, s.g, s.b].map((x) => pwmValue(g, emitExpr(g, x)).code);
      if (!g.board?.onboard.some((o) => o.kind === 'rgb-ws2812')) {
        warn(g, `${g.board?.name ?? 'Esta placa'} no tiene un LED RGB integrado: el bloque se omitió.`, { blockId: id });
        line(g, `// ⚠ ${g.board?.name ?? 'Esta placa'} no tiene LED RGB integrado`, id);
        return;
      }
      line(g, `rgbLedWrite(RGB_BUILTIN, ${vals.join(', ')});`, id, 'color del LED integrado');
      return;
    }
    case 'led':
    case 'ledBrightness':
    case 'rgb':
    case 'buzzerTone':
    case 'buzzerOff':
    case 'servo':
    case 'motor':
      emitPartAction(g, s, id);
      return;
    default:
      warn(g, `Bloque desconocido: «${(s as { k?: string }).k ?? '?'}».`, { blockId: id });
  }
}

/**
 * «repetir N veces»: N is evaluated ONCE (Scratch / Blockly semantics, and what
 * the interpreter does), so `repetir (al azar 1..6)` or a body that changes N
 * still runs the number of turns computed at the start. int is 16-bit on the
 * Uno, so counts that may exceed 32767 use a long counter.
 */
function emitRepeat(g: GenState, s: Extract<Stmt, { k: 'repeat' }>, id: string | undefined): void {
  const t = emitExpr(g, s.times);
  const counter = g.names.free(['i', 'j', 'k'][g.locals.size % 3] ?? 'i', g.locals);
  const lit = numLitValue(t);
  if (lit !== undefined) {
    const type = Math.abs(lit) <= 32767 ? 'int' : 'long';
    line(g, `for (${type} ${counter} = 0; ${counter} < ${wrapIf(t, t.prec <= P.rel)}; ${counter}++) {`, id);
    g.locals.add(counter);
    emitBody(g, s.body, true);
    g.locals.delete(counter);
    g.out.line('}', id);
    return;
  }
  const times = g.names.free(`${counter}Veces`, new Set([...g.locals, counter]));
  line(g, '{', id, 'el número de vueltas se calcula una sola vez, al empezar');
  g.out.indent();
  g.out.line(`double ${times} = ${t.code};`, id);
  g.out.line(`for (long ${counter} = 0; ${counter} < ${times}; ${counter}++) {`, id);
  g.locals.add(counter);
  g.locals.add(times);
  emitBody(g, s.body, true);
  g.locals.delete(counter);
  g.locals.delete(times);
  g.out.line('}', id);
  g.out.dedent();
  g.out.line('}', id);
}

function emitFor(g: GenState, s: Extract<Stmt, { k: 'for' }>, id: string | undefined): void {
  const v = g.vars.get(s.var);
  if (!v) return;
  const from = emitExpr(g, s.from);
  const to = emitExpr(g, s.to);
  const by = emitExpr(g, s.by);
  const [a, b, step] = [numLitValue(from), numLitValue(to), numLitValue(by)];
  const x = v.c;
  if (a !== undefined && b !== undefined && step !== undefined && step !== 0) {
    const up = a <= b;
    const st = Math.abs(step);
    const cond = `${x} ${up ? '<=' : '>='} ${to.code}`;
    const inc = st === 1 ? `${x}${up ? '++' : '--'}` : `${x} ${up ? '+=' : '-='} ${numLit(st).code}`;
    line(g, `for (${x} = ${from.code}; ${cond}; ${inc}) {`, id);
    emitBody(g, s.body, true);
    g.out.line('}', id);
    return;
  }
  // General form: works counting up or down, bounds evaluated once.
  const lo = g.names.free(`${x}Desde`, g.locals);
  const hi = g.names.free(`${x}Hasta`, g.locals);
  const st = g.names.free(`${x}Paso`, g.locals);
  line(g, '{', id, `${x} cuenta hacia arriba o hacia abajo según los límites`);
  g.out.indent();
  const stepCode = step !== undefined ? numLit(Math.abs(step)).code : `fabs(${by.code})`;
  g.out.line(`double ${lo} = ${from.code}, ${hi} = ${to.code}, ${st} = ${stepCode};`, id);
  g.out.line(`if (${lo} > ${hi}) ${st} = -${st};`, id);
  g.out.line(`for (${x} = ${lo}; ${st} > 0 ? ${x} <= ${hi} : ${x} >= ${hi}; ${x} += ${st}) {`, id);
  for (const n of [lo, hi, st]) g.locals.add(n);
  emitBody(g, s.body, true);
  for (const n of [lo, hi, st]) g.locals.delete(n);
  g.out.line('}', id);
  g.out.dedent();
  g.out.line('}', id);
}

