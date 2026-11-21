/**
 * NUMERIC MODEL of contracts/ir.ts: JS twins of the generated C helpers
 * (cv_div, cv_mod, cv_map, cv_pwm, cv_percentToPwm, cv_percent, cv_ms, cvPrint).
 * The interpreter uses these so simulation and hardware agree bit for bit.
 */
/* ------------------------------------------------------------------------- */

export type Value = number | boolean | string;

export const toNum = (v: Value): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0);
/** C truthiness: value != 0 (NaN is true, like in C). */
export const truthy = (v: Value): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : true);

/** C round(): halves away from zero. */
export const cRound = (x: number): number => (x < 0 ? -Math.round(-x) : Math.round(x));
/** Arduino constrain() macro semantics. */
export const constrain = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
/** cv_div: real division, 0 when dividing by zero. */
export const cvDiv = (a: number, b: number): number => (b === 0 ? 0 : a / b);
/** cv_mod: fmod (sign of the dividend), 0 when dividing by zero. */
export const cvMod = (a: number, b: number): number => (b === 0 ? 0 : a % b);
/** cv_map: float map, outMin when the input range is empty. */
export function cvMap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (inMax === inMin) return outMin;
  return ((v - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}
const finiteOr0 = (n: number) => (Number.isNaN(n) ? 0 : n);
/** cv_pwm: (int) round(constrain(v, 0, 255)). */
export const toPwm = (v: number): number => finiteOr0(Math.round(constrain(v, 0, 255)));
/** cv_percentToPwm: (int) round(constrain(p, 0, 100) * 255 / 100). */
export const percentToPwm = (p: number): number => finiteOr0(Math.round((constrain(p, 0, 100) * 255) / 100));
/** cv_ms: delays below 0 count as 0; fractional ms are truncated ((unsigned long) cast). */
export const toDelayMs = (ms: number): number => (ms > 0 ? Math.floor(ms) : 0);
/** Servo.write(constrain(a, 0, 180)) — int parameter truncates. */
export const toServoAngle = (a: number): number => finiteOr0(Math.trunc(constrain(a, 0, 180)));
/** Arduino random(min, max + 1) with long (truncated) arguments; returns min when the range is empty. */
export function randomInRange(min: number, max: number, rand: () => number): number {
  const lo = Math.trunc(finiteOr0(min));
  const hi = Math.trunc(finiteOr0(max + 1));
  if (lo >= hi) return lo;
  return lo + Math.floor(rand() * (hi - lo));
}
/** Sensor formula: round(raw * 100 / maxValue), then 100 − x when inverted. */
export function sensorPercent(raw: number, maxValue: number, invert: boolean | undefined): number {
  const p = cRound((raw * 100) / maxValue);
  return invert ? 100 - p : p;
}
/** Degrees → radians constant used by the generated code (Arduino DEG_TO_RAD). */
export const DEG_TO_RAD = 0.017453292519943295769236907684886;

/** cvPrint formatting: integers without decimals, others with 2, booleans in Spanish, 'ovf' like Arduino. */
export function formatValue(v: Value): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'verdadero' : 'falso';
  if (Number.isNaN(v)) return 'nan';
  if (!Number.isFinite(v)) return 'inf';
  // Arduino's Print::printFloat gives up beyond ±4294967040 (it prints the integer part as an unsigned long).
  if (Math.abs(v) > 4294967040) return 'ovf';
  if (Number.isInteger(v) && Math.abs(v) < 2e9) return String(v === 0 ? 0 : v);
  return printFloat(v, 2);
}

/**
 * Arduino Print::printFloat(number, digits) step by step (same IEEE double
 * operations as the ESP32 core): add 0.5·10^-digits, print the integer part,
 * then extract each decimal with ×10 and truncation. This is NOT toFixed():
 * printFloat(0.375, 2) prints "0.37" (0.38 × 10 = 3.7999…).
 */
export function printFloat(number: number, digits: number): string {
  if (Number.isNaN(number)) return 'nan';
  if (!Number.isFinite(number)) return 'inf';
  if (number > 4294967040 || number < -4294967040) return 'ovf';
  let out = '';
  if (number < 0) {
    out += '-';
    number = -number;
  }
  let rounding = 0.5;
  for (let i = 0; i < digits; i++) rounding /= 10;
  number += rounding;
  const intPart = Math.trunc(number);
  let remainder = number - intPart;
  out += String(intPart);
  if (digits > 0) out += '.';
  for (let d = digits; d > 0; d--) {
    remainder *= 10;
    const toPrint = Math.trunc(remainder);
    out += String(toPrint);
    remainder -= toPrint;
  }
  return out;
}

