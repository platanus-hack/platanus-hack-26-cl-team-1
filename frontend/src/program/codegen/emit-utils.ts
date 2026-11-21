/** Small emission helpers shared by the statement and part-action emitters. */
import { arg, numLitValue, ternaryCond, type CExpr } from './expr';
import { digitalAsPwm, percentToPwm, pinDisplay, pinHasCap, toDelayMs, toPwm, truthy, type ResolvedPin } from './shared';
import { flushPending, warn, type GenState } from './state';

export function line(g: GenState, text: string, id: string | undefined, comment?: string): void {
  flushPending(g, id);
  g.out.line(text, id, comment);
}

export const delayComment = (ms: number) => {
  if (ms < 1000) return `espera ${ms} ms`;
  const s = String(Math.round(ms / 10) / 100).replace('.', ',');
  return `espera ${s} ${ms === 1000 ? 'segundo' : 'segundos'}`;
};

/** `HIGH`/`LOW` or `cond ? HIGH : LOW` (inverted for active-low wiring). */
export function level(e: CExpr, activeLow = false): { code: string; on?: boolean } {
  const [hi, lo] = activeLow ? ['LOW', 'HIGH'] : ['HIGH', 'LOW'];
  if (e.lit !== undefined) {
    const on = truthy(e.lit);
    return { code: on ? hi : lo, on };
  }
  return { code: `${ternaryCond(e)} ? ${hi} : ${lo}` };
}

/** digitalWrite — or analogWrite(pin, 0 | 255) on ESP32 pins that also use PWM (see digitalAsPwm). */
export function digitalOut(g: GenState, pin: string, boardPin: string, e: CExpr, activeLow: boolean, id: string | undefined, comment?: string): void {
  if (!digitalAsPwm(g.board, boardPin, g.pwmPins)) {
    line(g, `digitalWrite(${pin}, ${level(e, activeLow).code});`, id, comment);
    return;
  }
  const [hi, lo] = activeLow ? ['0', '255'] : ['255', '0'];
  const value = e.lit !== undefined ? (truthy(e.lit) ? hi : lo) : `${ternaryCond(e)} ? ${hi} : ${lo}`;
  line(g, `analogWrite(${pin}, ${value});`, id, comment ?? 'el pin también usa PWM: analogWrite a tope o en 0');
}

/** 0..255 value: folded literal or cv_pwm(x). */
export function pwmValue(g: GenState, e: CExpr): { code: string; lit?: number } {
  const v = numLitValue(e) ?? (typeof e.lit === 'boolean' ? (e.lit ? 1 : 0) : undefined);
  if (v !== undefined) {
    const p = toPwm(v);
    return { code: String(p), lit: p };
  }
  g.helpers.add('pwm');
  return { code: `cv_pwm(${arg(e)})` };
}

/** Percent (0..100) → PWM, inverted for active-low wiring. */
export function percentPwm(g: GenState, e: CExpr, activeLow: boolean): string {
  const v = numLitValue(e);
  if (v !== undefined) return String(activeLow ? 255 - percentToPwm(v) : percentToPwm(v));
  g.helpers.add('percentToPwm');
  const code = `cv_percentToPwm(${arg(e)})`;
  return activeLow ? `255 - ${code}` : code;
}

export function msValue(g: GenState, e: CExpr): string {
  const v = numLitValue(e);
  if (v !== undefined) return String(toDelayMs(v));
  if (e.type === 'ulong') return e.code;
  g.helpers.add('ms');
  return `cv_ms(${arg(e)})`;
}

export function pwmWarning(g: GenState, r: { boardPin: string; def?: ResolvedPin['def'] }, who: string, blockId: string | undefined, part?: string): void {
  if (!g.board || pinHasCap(r.def, 'pwm')) return;
  warn(g, `${who} usa el ${pinDisplay(g.board, r.boardPin)}, que no tiene PWM: solo podrá quedar totalmente encendido (valor ≥ 128) o apagado.`, { blockId, part });
}

/**
 * tone(pin, f[, ms]). Below 1 Hz the interpreter silences the pin, while
 * tone(pin, 0) divides by zero in the AVR core (it buzzes at ~30 Hz) and a
 * negative frequency is undefined: literals become noTone(pin), computed
 * frequencies go through cv_tone().
 */
export function toneCode(g: GenState, pin: string, f: CExpr, ms: CExpr | null): { code: string; silent: boolean } {
  const fl = numLitValue(f) ?? (typeof f.lit === 'boolean' ? (f.lit ? 1 : 0) : undefined);
  if (fl !== undefined) {
    if (!(Math.trunc(fl) > 0)) return { code: `noTone(${pin});`, silent: true };
    return { code: `tone(${pin}, ${arg(f)}${ms ? `, ${msValue(g, ms)}` : ''});`, silent: false };
  }
  g.helpers.add('tone');
  return { code: `cv_tone(${pin}, ${arg(f)}, ${ms ? msValue(g, ms) : '0'});`, silent: false };
}
