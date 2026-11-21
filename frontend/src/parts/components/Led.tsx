/**
 * 5 mm LED, front view: translucent epoxy dome with the lead frame visible
 * inside, flange with the flat on the cathode side, long bent anode leg.
 * Lights up with sim.brightness, flickers when overloaded, cracks when burned.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { darken, lighten, str, unit } from './util';
import './components.css';

export interface LedPalette {
  epoxy: string; // body tint when off
  deep: string; // edge shade
  lit: string; // body when lit
  core: string; // hot spot
  glow: string; // halo
}

export const LED_PALETTES: Record<string, LedPalette> = {
  red: { epoxy: '#c8262f', deep: '#5e0b12', lit: '#ff5448', core: '#fff0e8', glow: '#ff2b23' },
  green: { epoxy: '#1f9f45', deep: '#0a4119', lit: '#57ff8c', core: '#effff3', glow: '#22ff66' },
  yellow: { epoxy: '#e0ae17', deep: '#6d4e05', lit: '#ffe45e', core: '#fffdf0', glow: '#ffcf1f' },
  blue: { epoxy: '#2a5fd8', deep: '#0b2163', lit: '#66b0ff', core: '#f0f8ff', glow: '#3687ff' },
  white: { epoxy: '#d9e1ea', deep: '#76818f', lit: '#ffffff', core: '#ffffff', glow: '#d6e6ff' },
};

const BURNED: LedPalette = { epoxy: '#4a3a31', deep: '#1a1310', lit: '#4a3a31', core: '#4a3a31', glow: '#000000' };

/** Dome: cylinder with a hemispherical top (centre x = 0.5). */
export const LED_DOME = 'M -0.32 1.74 L -0.32 0.86 A 0.82 0.82 0 0 1 1.32 0.86 L 1.32 1.74 Z';
/** Flange with the flat cut on the cathode (right) side. */
const FLANGE = 'M -0.36 1.69 L 1.34 1.69 L 1.34 1.96 L -0.36 1.96 Q -0.45 1.96 -0.45 1.87 L -0.45 1.78 Q -0.45 1.69 -0.36 1.69 Z';

const ANODE_LEG = [[0, 1.9], [0, 2.26], [-0.22, 2.44], [0, 2.62], [0, 3]] as const;
const CATHODE_LEG = [[1, 1.9], [1, 3]] as const;

/** Lead frame seen through the epoxy: thin anode post, cathode anvil cup, bond wire. */
export function LeadFrame({ color, opacity, die }: { color: string; opacity: number; die?: string }) {
  return (
    <g opacity={opacity}>
      <rect x={-0.045} y={1.02} width={0.09} height={0.72} fill={color} />
      <rect x={-0.09} y={0.98} width={0.2} height={0.1} rx={0.02} fill={color} />
      <rect x={0.955} y={1.12} width={0.09} height={0.62} fill={color} />
      <path d="M 0.5 0.97 L 1.14 0.97 L 1.07 1.17 L 0.58 1.17 Z" fill={color} />
      <path d="M 0.07 1.0 Q 0.32 0.68 0.76 0.9" fill="none" stroke={color} strokeWidth={0.022} />
      <rect x={0.72} y={0.88} width={0.13} height={0.09} fill={die ?? color} />
    </g>
  );
}

function LedImpl({ part, runtime, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const colorKey = str(runtime.color, 'red');
  const base = LED_PALETTES[colorKey] ?? LED_PALETTES.red;
  const burned = sim?.burned === true;
  const pal = burned ? BURNED : base;
  const b = burned ? 0 : unit(sim?.brightness);
  const lit = b > 0.01;
  const overloaded = !burned && sim?.overloaded === true;
  const haloR = 1.2 + 2.0 * b;

  return (
    <g className="cv-part cv-part-led">
      <defs>
        <ShadowFilter id={id('shadow')} />
        <clipPath id={id('clip')}>
          <path d={LED_DOME} />
        </clipPath>
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={pal.deep} />
          <stop offset="0.22" stopColor={pal.epoxy} />
          <stop offset="0.5" stopColor={lighten(pal.epoxy, 0.14)} />
          <stop offset="0.8" stopColor={pal.epoxy} />
          <stop offset="1" stopColor={pal.deep} />
        </linearGradient>
        <linearGradient id={id('flange')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={lighten(pal.epoxy, 0.18)} />
          <stop offset="0.45" stopColor={darken(pal.epoxy, 0.12)} />
          <stop offset="1" stopColor={darken(pal.epoxy, 0.45)} />
        </linearGradient>
        <radialGradient id={id('lens')} cx="0.5" cy="0.32" r="0.55">
          <stop offset="0" stopColor={lighten(pal.epoxy, 0.45)} stopOpacity={0.55} />
          <stop offset="1" stopColor={lighten(pal.epoxy, 0.45)} stopOpacity={0} />
        </radialGradient>
        {lit && (
          <>
            <radialGradient id={id('lit')} gradientUnits="userSpaceOnUse" cx={0.7} cy={0.95} r={1.15}>
              <stop offset="0" stopColor={pal.core} />
              <stop offset="0.3" stopColor={lighten(pal.lit, 0.25)} />
              <stop offset="0.75" stopColor={pal.lit} />
              <stop offset="1" stopColor={darken(pal.lit, 0.2)} />
            </radialGradient>
            <radialGradient id={id('halo')}>
              <stop offset="0" stopColor={pal.glow} stopOpacity={0.9} />
              <stop offset="0.3" stopColor={pal.glow} stopOpacity={0.45} />
              <stop offset="0.62" stopColor={pal.glow} stopOpacity={0.14} />
              <stop offset="1" stopColor={pal.glow} stopOpacity={0} />
            </radialGradient>
            <radialGradient id={id('bloom')}>
              <stop offset="0" stopColor="#ffffff" stopOpacity={0.95} />
              <stop offset="0.35" stopColor={pal.core} stopOpacity={0.6} />
              <stop offset="1" stopColor={pal.glow} stopOpacity={0} />
            </radialGradient>
          </>
        )}
        {burned && !thumbnail && (
          <filter id={id('smoke')} x="-100%" y="-50%" width="300%" height="200%">
            <feGaussianBlur stdDeviation="0.07" />
          </filter>
        )}
      </defs>

      {lit && (
        <g className={overloaded ? 'cv-part-glow cv-part-flicker' : 'cv-part-glow'} opacity={0.3 + 0.7 * b}>
          <circle cx={0.5} cy={0.95} r={haloR} fill={`url(#${id('halo')})`} />
        </g>
      )}

      <Lead points={ANODE_LEG} pin="anode" />
      <Lead points={CATHODE_LEG} pin="cathode" />

      <g filter={`url(#${id('shadow')})`}>
        <path d={FLANGE} fill={`url(#${id('flange')})`} />
        <path d={LED_DOME} fill={`url(#${id('body')})`} opacity={0.97} />
      </g>
      {/* flat face of the flange (cathode marker) */}
      <rect x={1.29} y={1.7} width={0.05} height={0.25} fill={lighten(pal.epoxy, 0.35)} opacity={0.5} />
      <path d="M -0.36 1.71 L 1.32 1.71" stroke={lighten(pal.epoxy, 0.5)} strokeWidth={0.03} opacity={0.45} />

      <g clipPath={`url(#${id('clip')})`}>
        <LeadFrame color={burned ? '#0d0907' : darken(pal.epoxy, 0.55)} opacity={burned ? 0.7 : lit ? 0.32 : 0.5} die={lit ? pal.core : undefined} />
        <ellipse cx={0.5} cy={0.62} rx={0.62} ry={0.5} fill={`url(#${id('lens')})`} />
      </g>

      {lit && (
        <g className={overloaded ? 'cv-part-glow cv-part-flicker' : 'cv-part-glow'}>
          <path d={LED_DOME} fill={`url(#${id('lit')})`} opacity={0.35 + 0.65 * b} />
          <LeadFrame color={darken(pal.lit, 0.35)} opacity={0.22} die="#ffffff" />
        </g>
      )}

      {burned && (
        <g>
          <ellipse cx={0.55} cy={0.5} rx={0.42} ry={0.3} fill="#000" opacity={0.5} />
          <path
            d="M 0.28 0.2 L 0.42 0.58 L 0.3 0.92 L 0.47 1.28 M 0.42 0.58 L 0.72 0.74 L 0.9 0.64 M 0.72 0.74 L 0.8 1.05 M 0.3 0.92 L 0.05 1.08"
            fill="none"
            stroke="#0b0705"
            strokeWidth={0.035}
            strokeLinejoin="round"
          />
          <path d="M 0.43 0.6 L 0.74 0.77" stroke="#8a7466" strokeWidth={0.012} opacity={0.5} />
        </g>
      )}

      {/* specular highlights */}
      <g opacity={burned ? 0.35 : 1} clipPath={`url(#${id('clip')})`}>
        <ellipse cx={-0.12} cy={1.18} rx={0.075} ry={0.48} fill="#ffffff" opacity={0.3} />
        <ellipse cx={0.14} cy={0.42} rx={0.17} ry={0.1} fill="#ffffff" opacity={0.75} transform="rotate(-38 0.14 0.42)" />
        <path d="M 1.12 0.5 Q 1.29 0.95 1.25 1.7" fill="none" stroke="#ffffff" strokeWidth={0.045} opacity={0.2} />
      </g>

      {lit && (
        <circle
          className={overloaded ? 'cv-part-glow cv-part-flicker' : 'cv-part-glow'}
          cx={0.72}
          cy={0.93}
          r={0.42 + 0.4 * b}
          fill={`url(#${id('bloom')})`}
          opacity={0.25 + 0.6 * b}
        />
      )}

      {overloaded && (
        <path className="cv-part-hot" d={LED_DOME} fill="none" stroke="#ffb547" strokeWidth={0.07} opacity={0.9} />
      )}

      {burned && !thumbnail && (
        <path
          className="cv-part-smoke"
          d="M 0.62 0.05 C 0.25 -0.3 1.0 -0.55 0.6 -0.95 C 0.32 -1.22 0.78 -1.45 0.55 -1.75"
          fill="none"
          stroke="#a3abb5"
          strokeWidth={0.2}
          strokeLinecap="round"
          opacity={0.55}
          filter={`url(#${id('smoke')})`}
        />
      )}
    </g>
  );
}

export const LedRenderer = memo(LedImpl);
