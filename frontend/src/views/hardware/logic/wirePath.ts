/**
 * Jumper-wire geometry: a gentle curved path (cubic Béziers with a slight
 * sag) through the wire's waypoints, plus current-flow animation parameters.
 */
import type { Point } from '@/contracts';

const fmt = (n: number) => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

/** Unit normal of segment a→b that points "down" the screen (y+), or right for vertical segments. */
function sagNormal(a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1;
  let nx = -dy / d;
  let ny = dx / d;
  if (ny < -1e-9 || (Math.abs(ny) <= 1e-9 && nx < 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/** Sag (grid units) for a segment of length `len`. */
export const sagFor = (len: number, factor = 0.1) => Math.min(len * factor, 1.1);

/**
 * SVG path through `points` (≥ 2). Two points → one sagging cubic; more →
 * Catmull-Rom spline converted to cubics, each segment with a smaller sag.
 */
export function buildWirePath(points: Point[], sagFactor = 0.1): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M${fmt(points[0].x)} ${fmt(points[0].y)}`;
  const parts: string[] = [`M${fmt(points[0].x)} ${fmt(points[0].y)}`];
  if (points.length === 2) {
    const [a, b] = points;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = sagNormal(a, b);
    const s = sagFor(len, sagFactor) * 1.33; // control offset → actual mid sag ≈ 0.75·offset
    const c1 = { x: a.x + (b.x - a.x) / 3 + n.x * s, y: a.y + (b.y - a.y) / 3 + n.y * s };
    const c2 = { x: a.x + ((b.x - a.x) * 2) / 3 + n.x * s, y: a.y + ((b.y - a.y) * 2) / 3 + n.y * s };
    parts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(b.x)} ${fmt(b.y)}`);
    return parts.join(' ');
  }
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const len = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = sagNormal(p1, p2);
    const s = sagFor(len, sagFactor) * 0.6;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6 + n.x * s, y: p1.y + (p2.y - p0.y) / 6 + n.y * s };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6 + n.x * s, y: p2.y - (p3.y - p1.y) / 6 + n.y * s };
    parts.push(`C${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`);
  }
  return parts.join(' ');
}

/** Direction (unit vector) in which the wire leaves `end` towards the next point. */
export function endDirection(points: Point[], atStart: boolean): Point {
  if (points.length < 2) return { x: 0, y: -1 };
  const a = atStart ? points[0] : points[points.length - 1];
  const b = atStart ? points[1] : points[points.length - 2];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  return d < 1e-9 ? { x: 0, y: -1 } : { x: dx / d, y: dy / d };
}

/** Minimum current magnitude that animates (A). */
export const FLOW_THRESHOLD_A = 0.05e-3;
/** Dash period of the flow animation, in grid units. */
export const FLOW_PERIOD = 1;
/** Visible dash length inside each period (round caps add the stroke width). */
export const FLOW_DASH = 0.18;

export interface FlowParams {
  active: boolean;
  /** Seconds per dash period. */
  durationS: number;
  /** true when current flows to → from (negative). */
  reverse: boolean;
  /** Visual intensity 0..1 (log scale). */
  intensity: number;
}

/** Animation parameters: speed ∝ log10(current), direction = sign. */
export function flowParams(currentA: number | undefined): FlowParams {
  const i = currentA ?? 0;
  const mag = Math.abs(i);
  if (!Number.isFinite(mag) || mag <= FLOW_THRESHOLD_A) return { active: false, durationS: 0, reverse: false, intensity: 0 };
  const decades = Math.log10(mag / FLOW_THRESHOLD_A); // 0 at threshold, ~2.6 at 20 mA, ~4 at 500 mA
  // grid units / s, quantised so tiny current jitter does not restart the CSS animation
  const speed = Math.round(Math.min(5, Math.max(0.6, 0.6 + 0.9 * decades)) * 5) / 5;
  return {
    active: true,
    durationS: FLOW_PERIOD / speed,
    reverse: i < 0,
    intensity: Math.min(1, Math.max(0.25, decades / 3.5)),
  };
}

/** Index of the polyline segment closest to `p` (for inserting a waypoint). */
export function closestSegment(points: Point[], p: Point): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    const d = Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
