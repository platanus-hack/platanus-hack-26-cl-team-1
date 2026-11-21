/** Effective part property values (instance value → default, with runtime overrides). */
import type { PartDef, PartInstance, PropValue } from '@/contracts';

/**
 * Value of `key`: a runtime override wins for props declared `runtime: true`,
 * then the instance value, then the PartDef default.
 */
export function effectiveProp(
  part: PartInstance,
  def: PartDef,
  key: string,
  runtime?: Record<string, PropValue>,
): PropValue | undefined {
  const pd = def.props.find((p) => p.key === key);
  if (runtime && pd?.runtime && Object.prototype.hasOwnProperty.call(runtime, key)) return runtime[key];
  // `props` may be missing on a hand-edited / imported project: fall back to the defaults.
  const props = part.props;
  if (props && typeof props === 'object' && Object.prototype.hasOwnProperty.call(props, key)) return props[key];
  return pd?.default;
}

export function toNum(v: PropValue | undefined, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function toBool(v: PropValue | undefined): boolean {
  return v === true || v === 1 || v === 'true' || v === '1';
}

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
