/**
 * Shared SVG building blocks for the board / power renderers.
 */
import { useId } from 'react';
import { mixHex, rectSubpath } from './layout';

export const SANS = "Inter, 'Helvetica Neue', Arial, sans-serif";
export const MONO = "'JetBrains Mono', Menlo, Consolas, monospace";
export const SILK = '#f3f6f4';

/**
 * Unique, CSS-safe prefix for <defs> ids: `${part.id}-<react id>`.
 * The same part type may be drawn several times with the same part id
 * (palette + inspector thumbnails), so the React id keeps them distinct.
 */
export function useSvgId(partId: string): string {
  const rid = useId().replace(/[^A-Za-z0-9_-]/g, '');
  return `${partId.replace(/[^A-Za-z0-9_-]/g, '_')}-${rid}`;
}

export const url = (id: string) => `url(#${id})`;

/**
 * Soft drop shadow for SMALL pieces. Its filter region is much larger than the
 * shared cv-shadow (±20 %), so thin parts (headers, buttons) get a smooth falloff
 * instead of a clipped edge. Reference it as filter={url(`${uid}-sh`)}; large bodies use `${uid}-shL`.
 */
export function SoftShadow({ uid }: { uid: string }) {
  return (
    <>
      <filter id={`${uid}-sh`} x="-60%" y="-60%" width="220%" height="270%" colorInterpolationFilters="sRGB">
        <feDropShadow dx={0.1} dy={0.18} stdDeviation={0.14} floodColor="#000" floodOpacity={0.5} />
      </filter>
      {/* large bodies (PCB, breadboard, battery case): self-contained, no dependency on SharedDefs */}
      <filter id={`${uid}-shL`} x="-10%" y="-10%" width="120%" height="125%" colorInterpolationFilters="sRGB">
        <feDropShadow dx={0.15} dy={0.3} stdDeviation={0.3} floodColor="#000" floodOpacity={0.5} />
      </filter>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Text                                                                      */
/* ------------------------------------------------------------------------- */

interface SilkTextProps {
  x: number;
  y: number;
  size: number;
  children: string;
  anchor?: 'start' | 'middle' | 'end';
  /** Rotate -90° (reads bottom-to-top) around (x, y), like header labels on real boards. */
  vertical?: boolean;
  /** Vertically centre the glyphs on y (or on x when vertical) instead of using y as the baseline. */
  center?: boolean;
  fill?: string;
  weight?: number;
  mono?: boolean;
  spacing?: number;
  opacity?: number;
  italic?: boolean;
}

/**
 * Silkscreen text. Baselines are computed manually (no dominant-baseline),
 * so it renders identically in browsers and in rsvg QA renders.
 */
export function SilkText({ x, y, size, children, anchor = 'middle', vertical, center, fill = SILK, weight = 600, mono, spacing, opacity, italic }: SilkTextProps) {
  const shift = center ? size * 0.36 : 0; // ≈ half the cap height
  const common = {
    fontSize: size,
    fontFamily: mono ? MONO : SANS,
    fontWeight: weight,
    fill,
    textAnchor: anchor,
    letterSpacing: spacing,
    opacity,
    fontStyle: italic ? 'italic' : undefined,
  } as const;
  if (vertical) {
    return (
      <text transform={`translate(${x + shift} ${y}) rotate(-90)`} {...common}>
        {children}
      </text>
    );
  }
  return (
    <text x={x} y={y + shift} {...common}>
      {children}
    </text>
  );
}

/* ------------------------------------------------------------------------- */
/* Indicator LED (SMD 0603/0805 seen from above, optional glow)              */
/* ------------------------------------------------------------------------- */

interface IndicatorLedProps {
  /** Unique gradient id for the halo. */
  id: string;
  x: number;
  y: number;
  color: string;
  /** 0..1 brightness. */
  level: number;
  w?: number;
  h?: number;
  halo?: number;
  vertical?: boolean;
}

export function IndicatorLed({ id, x, y, color, level, w = 0.78, h = 0.44, halo = 1.7, vertical }: IndicatorLedProps) {
  const lv = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
  const lit = lv > 0.02;
  const bw = vertical ? h : w;
  const bh = vertical ? w : h;
  const cap = (vertical ? bh : bw) * 0.2;
  const off = mixHex(color, '#d9dbd2', 0.72);
  const lens = lit ? mixHex(off, mixHex(color, '#ffffff', 0.35), Math.min(1, lv * 1.4)) : off;
  return (
    <g>
      {lit && (
        <>
          <defs>
            <radialGradient id={id}>
              <stop offset="0" stopColor={color} stopOpacity={0.95 * lv} />
              <stop offset="0.35" stopColor={color} stopOpacity={0.42 * lv} />
              <stop offset="1" stopColor={color} stopOpacity={0} />
            </radialGradient>
          </defs>
          <circle cx={x} cy={y} r={halo * (0.7 + 0.3 * lv)} fill={url(id)} />
        </>
      )}
      <rect x={x - bw / 2} y={y - bh / 2} width={bw} height={bh} rx={0.05} fill={lens} stroke="rgba(0,0,0,0.35)" strokeWidth={0.03} />
      {vertical ? (
        <path d={`M${x - bw / 2} ${y - bh / 2}h${bw}v${cap}h${-bw}z M${x - bw / 2} ${y + bh / 2 - cap}h${bw}v${cap}h${-bw}z`} fill="#c9ced3" />
      ) : (
        <path d={`M${x - bw / 2} ${y - bh / 2}h${cap}v${bh}h${-cap}z M${x + bw / 2 - cap} ${y - bh / 2}h${cap}v${bh}h${-cap}z`} fill="#c9ced3" />
      )}
      {lit && <rect x={x - bw * 0.22} y={y - bh * 0.25} width={bw * 0.44} height={bh * 0.5} rx={0.06} fill="#ffffff" opacity={0.85 * lv} />}
    </g>
  );
}

/* ------------------------------------------------------------------------- */
/* Lead wire with a tinned tip (batteries)                                   */
/* ------------------------------------------------------------------------- */

interface LeadProps {
  /** Insulated part of the wire (SVG path data). */
  d: string;
  /** Tinned tip: from (x, y0) straight down to the pin point (x, y1). */
  tip: { x: number; y0: number; y1: number };
  color: string;
  thumbnail?: boolean;
}

export function LeadWire({ d, tip, color, thumbnail }: LeadProps) {
  const tipD = `M${tip.x} ${tip.y0}V${tip.y1}`;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={tipD} stroke="#5f666e" strokeWidth={0.24} />
      <path d={tipD} stroke="#c3c9cf" strokeWidth={0.17} />
      {!thumbnail && <path d={`M${tip.x - 0.035} ${tip.y0 + 0.1}V${tip.y1 - 0.05}`} stroke="#f4f6f8" strokeWidth={0.05} opacity={0.85} />}
      <path d={d} stroke="rgba(0,0,0,0.55)" strokeWidth={0.42} />
      <path d={d} stroke={color} strokeWidth={0.32} />
      {!thumbnail && <path d={d} stroke="#ffffff" strokeWidth={0.08} opacity={0.28} transform="translate(-0.07 -0.02)" />}
    </g>
  );
}

/* ------------------------------------------------------------------------- */
/* Selection halo                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Selection outline that follows the part's real silhouette. Render it BEFORE
 * the art: the wide stroke is half hidden under the body, so only a crisp
 * outer glow shows and protruding parts (USB, jack) stay on top of it.
 */
export function SelectionHalo({ d, rect }: { d?: string; rect?: { x: number; y: number; w: number; h: number; r: number } }) {
  const path = d ?? (rect ? rectSubpath(rect.x, rect.y, rect.w, rect.h, rect.r) : '');
  if (!path) return null;
  return (
    <g fill="none" stroke="#4cc2ff" strokeLinejoin="round">
      <path d={path} strokeOpacity={0.25} strokeWidth={0.75} />
      <path d={path} strokeOpacity={0.95} strokeWidth={0.34} />
    </g>
  );
}
