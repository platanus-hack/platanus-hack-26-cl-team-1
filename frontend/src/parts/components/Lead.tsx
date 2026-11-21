/**
 * Metallic component leg / lead and the per-instance SVG id helper.
 * A Lead is drawn as a polyline; its LAST point must be the pin position.
 * The main stroke carries `data-lead="<pinId>"` (used by tests to verify that
 * every leg ends exactly on its PinDef).
 */
import { memo, useId } from 'react';
import { r4 } from './util';

export type Pt = readonly [number, number];
export type LeadTone = 'tin' | 'gold' | 'copper';

const TONES: Record<LeadTone, { edge: string; body: string; hi: string }> = {
  tin: { edge: '#4f5861', body: '#b4bcc5', hi: '#f8fafc' },
  gold: { edge: '#6e5214', body: '#d6ae4c', hi: '#fff4cc' },
  copper: { edge: '#7a4a24', body: '#d08a52', hi: '#ffe0c4' },
};

export function leadPath(points: readonly Pt[]): string {
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${r4(x)} ${r4(y)}`).join(' ');
}

function mostlyVertical(points: readonly Pt[]): boolean {
  let dx = 0;
  let dy = 0;
  for (let i = 1; i < points.length; i++) {
    dx += Math.abs(points[i][0] - points[i - 1][0]);
    dy += Math.abs(points[i][1] - points[i - 1][1]);
  }
  return dy >= dx;
}

interface LeadProps {
  points: readonly Pt[];
  /** Pin id this lead ends on (last point). */
  pin: string;
  width?: number;
  tone?: LeadTone;
}

export const Lead = memo(function Lead({ points, pin, width = 0.075, tone = 'tin' }: LeadProps) {
  if (points.length < 2) return null;
  const t = TONES[tone];
  const d = leadPath(points);
  const o = width * 0.24;
  const vertical = mostlyVertical(points);
  const hd = leadPath(points.map(([x, y]) => [vertical ? x - o : x, vertical ? y : y - o] as const));
  return (
    <g className="cv-part-lead">
      <path d={d} fill="none" stroke={t.edge} strokeWidth={r4(width + 0.028)} strokeLinejoin="round" />
      <path data-lead={pin} d={d} fill="none" stroke={t.body} strokeWidth={width} strokeLinejoin="round" />
      <path d={hd} fill="none" stroke={t.hi} strokeWidth={r4(width * 0.34)} strokeLinejoin="round" opacity={0.85} />
    </g>
  );
});

/**
 * Local soft drop shadow (larger filter region than the shared cv-shadow so
 * the blur is never clipped into a visible rectangle).
 */
export function ShadowFilter({ id, dx = 0.12, dy = 0.2, blur = 0.18, opacity = 0.5 }: { id: string; dx?: number; dy?: number; blur?: number; opacity?: number }) {
  return (
    <filter id={id} x="-60%" y="-60%" width="220%" height="220%" colorInterpolationFilters="sRGB">
      <feDropShadow dx={dx} dy={dy} stdDeviation={blur} floodColor="#000000" floodOpacity={opacity} />
    </filter>
  );
}

/** Per-instance SVG id factory: ids are prefixed by the part id and unique per mounted renderer. */
export function usePartIds(partId: string): (name: string) => string {
  const raw = useId();
  const prefix = `${partId}-${raw}`.replace(/[^A-Za-z0-9_-]/g, '');
  return (name: string) => `${prefix}-${name}`;
}
