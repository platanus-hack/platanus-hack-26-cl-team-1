/**
 * 12 mm passive piezo buzzer, top view in slight perspective: black cylinder,
 * sound hole, moulded "+" next to the long leg. Sound waves ripple out while
 * sim.sounding (only with tone()).
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { clamp, r4 } from './util';
import './components.css';

const CX = 1.5;
const CY = 1.95;
const R = 2.25;
const WALL = 0.36;

function arc(r: number, fromDeg: number, toDeg: number): string {
  const p = (deg: number) => {
    const a = (deg * Math.PI) / 180;
    return `${r4(CX + r * Math.cos(a))} ${r4(CY + r * Math.sin(a))}`;
  };
  return `M ${p(fromDeg)} A ${r} ${r} 0 0 1 ${p(toDeg)}`;
}

const WAVES = [2.62, 3.0, 3.38];

function BuzzerImpl({ part, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const sounding = sim?.sounding === true && sim?.burned !== true;
  // higher pitch → slightly faster ripple (purely cosmetic)
  const hz = typeof sim?.toneHz === 'number' && Number.isFinite(sim.toneHz) ? sim.toneHz : 440;
  const period = r4(clamp(1.3 - Math.log2(Math.max(hz, 50) / 220) * 0.18, 0.6, 1.5));

  return (
    <g className="cv-part cv-part-buzzer">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.25} blur={0.22} />
        <linearGradient id={id('wall')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#050607" />
          <stop offset="0.35" stopColor="#2a2e34" />
          <stop offset="0.6" stopColor="#15171b" />
          <stop offset="1" stopColor="#030304" />
        </linearGradient>
        <radialGradient id={id('top')} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#3d424a" />
          <stop offset="0.55" stopColor="#1d2025" />
          <stop offset="1" stopColor="#0c0d10" />
        </radialGradient>
        <radialGradient id={id('hole')} cx="0.6" cy="0.65" r="0.6">
          <stop offset="0" stopColor="#2a2d33" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
      </defs>

      <Lead points={[[0, 3.5], [0, 4.1], [-0.2, 4.3], [0, 4.5], [0, 5]]} pin="plus" width={0.08} />
      <Lead points={[[3, 3.5], [3, 5]]} pin="minus" width={0.08} />

      <g filter={`url(#${id('shadow')})`}>
        <circle cx={CX} cy={CY + WALL} r={R} fill={`url(#${id('wall')})`} />
      </g>
      <g className={sounding ? 'cv-part-buzz' : undefined}>
        <circle cx={CX} cy={CY} r={R} fill={`url(#${id('top')})`} />
        <circle cx={CX} cy={CY} r={R - 0.04} fill="none" stroke="#5a606a" strokeWidth={0.04} opacity={0.55} />
        {/* moulded rings */}
        <circle cx={CX} cy={CY} r={1.72} fill="none" stroke="#000000" strokeWidth={0.06} opacity={0.5} />
        <circle cx={CX} cy={CY + 0.03} r={1.72} fill="none" stroke="#ffffff" strokeWidth={0.025} opacity={0.08} />
        <circle cx={CX} cy={CY} r={0.92} fill="none" stroke="#000000" strokeWidth={0.05} opacity={0.45} />
        <circle cx={CX} cy={CY + 0.03} r={0.92} fill="none" stroke="#ffffff" strokeWidth={0.02} opacity={0.08} />
        {/* sound hole */}
        <circle cx={CX} cy={CY} r={0.4} fill="#4b5058" opacity={0.6} />
        <circle cx={CX} cy={CY} r={0.34} fill={`url(#${id('hole')})`} />
        {!thumbnail && (
          <path d="M 0.32 3.0 h 0.38 M 0.51 2.81 v 0.38" stroke="#c9ced6" strokeWidth={0.08} strokeLinecap="round" opacity={0.75} />
        )}
        {/* specular */}
        <path d={arc(R - 0.18, 200, 262)} fill="none" stroke="#ffffff" strokeWidth={0.12} strokeLinecap="round" opacity={0.18} />
        <ellipse cx={0.62} cy={0.95} rx={0.42} ry={0.18} fill="#ffffff" opacity={0.12} transform="rotate(-40 0.62 0.95)" />
      </g>

      {sounding &&
        !thumbnail &&
        WAVES.flatMap((r, i) =>
          [
            [-42, 42],
            [138, 222],
          ].map(([a, b2], side) => (
            <path
              key={`${i}-${side}`}
              className="cv-part-wave"
              d={arc(r, a, b2)}
              fill="none"
              stroke="#3ddc97"
              strokeWidth={0.09 - i * 0.015}
              strokeLinecap="round"
              style={{ animationDelay: `${r4(i * period * 0.22)}s`, animationDuration: `${period}s` }}
            />
          )),
        )}
    </g>
  );
}

export const BuzzerRenderer = memo(BuzzerImpl);
