/**
 * Small pure helpers shared by the component renderers (prop parsing, colour
 * maths, number formatting for SVG path data). No React here.
 */
import type { PropValue } from '@/contracts';

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Finite number from a prop/sim value, else `fallback`. */
export function num(v: PropValue | undefined | null, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Finite number 0..1 from an optional sim value (NaN/undefined → 0). */
export function unit(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? clamp01(v) : 0;
}

export function bool(v: PropValue | undefined | null): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

export function str(v: PropValue | undefined | null, fallback: string): string {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return fallback;
}

/** Round for SVG output (avoids 0.30000000000000004 in path data). */
export const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;

export type RGB = readonly [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Linear blend between two hex colours (t = 0 → a, 1 → b). */
export function mix(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const k = clamp01(t);
  return rgbToHex([ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k]);
}

export const lighten = (c: string, t: number): string => mix(c, '#ffffff', t);
export const darken = (c: string, t: number): string => mix(c, '#000000', t);

/**
 * Mixed colour of an RGB LED from channel intensities (0..1 each).
 * Returns the hue at full value plus the overall intensity (max channel),
 * or null when the LED is effectively off.
 */
export function rgbLedColor(rgb: readonly number[] | undefined): { hex: string; intensity: number } | null {
  if (!rgb || rgb.length < 3) return null;
  const ch = [unit(rgb[0]), unit(rgb[1]), unit(rgb[2])];
  const m = Math.max(ch[0], ch[1], ch[2]);
  if (m < 0.02) return null;
  return { hex: rgbToHex([(ch[0] / m) * 255, (ch[1] / m) * 255, (ch[2] / m) * 255]), intensity: m };
}

/** Motor animation: seconds per revolution from a speed in −1..1 (null = stopped). */
export function spinSeconds(speed: number | undefined): number | null {
  if (typeof speed !== 'number' || !Number.isFinite(speed) || Math.abs(speed) < 0.02) return null;
  return r4(clamp(0.15 / Math.abs(speed), 0.12, 3));
}

/** Potentiometer knob: position 0..100 → indicator angle −135°..+135° (0° = up). */
export function knobAngle(position: number): number {
  return -135 + clamp(Number.isFinite(position) ? position : 50, 0, 100) * 2.7;
}

/** Servo horn angle: 0..180 (default 90 when unknown). */
export function servoAngle(angle: number | undefined): number {
  return typeof angle === 'number' && Number.isFinite(angle) ? clamp(angle, 0, 180) : 90;
}
