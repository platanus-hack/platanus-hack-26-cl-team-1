/**
 * 5 mm RGB LED (common cathode), milky diffused dome. Lit with the colour
 * mixed from sim.rgb; four legs fanned out to a 0.1" pitch, com the longest.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { lighten, rgbLedColor } from './util';
import './components.css';

const DOME = 'M 0.68 1.74 L 0.68 0.86 A 0.82 0.82 0 0 1 2.32 0.86 L 2.32 1.74 Z';
/** Flange, flat on the red-leg side. */
const FLANGE = 'M 0.64 1.69 L 2.36 1.69 Q 2.45 1.69 2.45 1.78 L 2.45 1.87 Q 2.45 1.96 2.36 1.96 L 0.64 1.96 Z';

const LEGS = {
  r: [[0.9, 1.9], [0.9, 2.06], [0, 2.7], [0, 3]],
  com: [[1.3, 1.9], [1.3, 2.06], [1, 2.28], [1, 2.42], [0.8, 2.58], [1, 2.74], [1, 3]],
  g: [[1.7, 1.9], [1.7, 2.08], [2, 2.36], [2, 3]],
  b: [[2.1, 1.9], [2.1, 2.06], [3, 2.7], [3, 3]],
} as const;

function LedRgbImpl({ part, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const burned = sim?.burned === true;
  const mixed = burned ? null : rgbLedColor(sim?.rgb);
  const k = mixed?.intensity ?? 0;
  const hue = mixed?.hex ?? '#ffffff';
  const overloaded = !burned && sim?.overloaded === true;
  const glowClass = overloaded ? 'cv-part-glow cv-part-flicker' : 'cv-part-glow';
  const milk = burned ? '#5a4a40' : '#e9edf1';

  return (
    <g className="cv-part cv-part-led-rgb">
      <defs>
        <ShadowFilter id={id('shadow')} />
        <clipPath id={id('clip')}>
          <path d={DOME} />
        </clipPath>
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={burned ? '#241a15' : '#9aa5b1'} />
          <stop offset="0.25" stopColor={milk} />
          <stop offset="0.55" stopColor={burned ? '#6a584c' : '#f8fafc'} />
          <stop offset="0.82" stopColor={milk} />
          <stop offset="1" stopColor={burned ? '#241a15' : '#9aa5b1'} />
        </linearGradient>
        <linearGradient id={id('flange')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={burned ? '#6a584c' : '#f4f6f8'} />
          <stop offset="1" stopColor={burned ? '#241a15' : '#9ca6b0'} />
        </linearGradient>
        {mixed && (
          <>
            <radialGradient id={id('lit')} gradientUnits="userSpaceOnUse" cx={1.5} cy={0.98} r={1.15}>
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.3" stopColor={lighten(hue, 0.45)} />
              <stop offset="0.8" stopColor={lighten(hue, 0.1)} />
              <stop offset="1" stopColor={hue} />
            </radialGradient>
            <radialGradient id={id('halo')}>
              <stop offset="0" stopColor={hue} stopOpacity={0.85} />
              <stop offset="0.32" stopColor={hue} stopOpacity={0.4} />
              <stop offset="0.65" stopColor={hue} stopOpacity={0.12} />
              <stop offset="1" stopColor={hue} stopOpacity={0} />
            </radialGradient>
          </>
        )}
      </defs>

      {mixed && (
        <g className={glowClass} opacity={0.3 + 0.7 * k}>
          <circle cx={1.5} cy={0.95} r={1.3 + 2.0 * k} fill={`url(#${id('halo')})`} />
        </g>
      )}

      <Lead points={LEGS.r} pin="r" />
      <Lead points={LEGS.com} pin="com" />
      <Lead points={LEGS.g} pin="g" />
      <Lead points={LEGS.b} pin="b" />

      <g filter={`url(#${id('shadow')})`}>
        <path d={FLANGE} fill={`url(#${id('flange')})`} />
        <path d={DOME} fill={`url(#${id('body')})`} />
      </g>
      <rect x={0.64} y={1.7} width={0.05} height={0.25} fill="#ffffff" opacity={0.35} />

      <g clipPath={`url(#${id('clip')})`}>
        {/* three dies on the common cathode cup, softly visible through the milky epoxy */}
        <g opacity={burned ? 0.6 : 0.42}>
          <rect x={1.26} y={1.18} width={0.08} height={0.56} fill="#8a939c" />
          <path d="M 1.12 1.0 L 1.88 1.0 L 1.8 1.2 L 1.2 1.2 Z" fill="#8a939c" />
          <rect x={0.86} y={1.24} width={0.07} height={0.5} fill="#8a939c" />
          <rect x={1.66} y={1.24} width={0.07} height={0.5} fill="#8a939c" />
          <rect x={2.06} y={1.24} width={0.07} height={0.5} fill="#8a939c" />
        </g>
        {!burned && (
          <g opacity={mixed ? 0.25 : 0.6}>
            <rect x={1.22} y={0.9} width={0.11} height={0.09} fill="#e5484d" />
            <rect x={1.44} y={0.9} width={0.11} height={0.09} fill="#30a46c" />
            <rect x={1.66} y={0.9} width={0.11} height={0.09} fill="#3b82f6" />
          </g>
        )}
        {/* milky diffusion haze */}
        <ellipse cx={1.5} cy={1.0} rx={0.85} ry={0.9} fill={milk} opacity={burned ? 0.2 : 0.32} />
        {mixed && <path className={glowClass} d={DOME} fill={`url(#${id('lit')})`} opacity={0.4 + 0.6 * k} />}
        {burned && (
          <path
            d="M 1.25 0.2 L 1.4 0.6 L 1.28 0.95 L 1.45 1.3 M 1.4 0.6 L 1.72 0.75 L 1.9 0.62"
            fill="none"
            stroke="#0b0705"
            strokeWidth={0.035}
          />
        )}
        <ellipse cx={0.88} cy={1.18} rx={0.075} ry={0.48} fill="#ffffff" opacity={0.35} />
        <ellipse cx={1.14} cy={0.42} rx={0.17} ry={0.1} fill="#ffffff" opacity={0.8} transform="rotate(-38 1.14 0.42)" />
        <path d="M 2.12 0.5 Q 2.29 0.95 2.25 1.7" fill="none" stroke="#ffffff" strokeWidth={0.045} opacity={0.25} />
      </g>

      {mixed && !thumbnail && (
        <circle className={glowClass} cx={1.5} cy={0.95} r={0.5 + 0.35 * k} fill="#ffffff" opacity={0.18 * k} />
      )}
      {overloaded && <path className="cv-part-hot" d={DOME} fill="none" stroke="#ffb547" strokeWidth={0.07} />}
    </g>
  );
}

export const LedRgbRenderer = memo(LedRgbImpl);
