/**
 * Square trimmer potentiometer, top view: blue body with a printed scale and
 * resistance code ("103" = 10 kΩ), white knurled rotor whose indicator turns
 * from −135° (position 0) to +135° (position 100).
 * The rotor is the actuator (data-actuator="position").
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { clamp, knobAngle, num, r4 } from './util';

const CX = 2;
const CY = 1.75;

/** 3-digit resistance code printed on trimmers: 10 kΩ → "103". */
export function potCode(ohms: number): string {
  if (!Number.isFinite(ohms) || ohms < 10) return '100';
  const exp = Math.floor(Math.log10(ohms) + 1e-9) - 1;
  const sig = clamp(Math.round(ohms / 10 ** exp), 10, 99);
  return `${sig}${clamp(exp, 0, 9)}`;
}

function polar(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r4(CX + r * Math.cos(a)), r4(CY + r * Math.sin(a))];
}

function PotentiometerImpl({ part, runtime, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const position = clamp(num(runtime.position, 50), 0, 100);
  const angle = knobAngle(position);
  const code = potCode(num(runtime.resistance, 10000));

  return (
    <g className="cv-part cv-part-potentiometer">
      <defs>
        <ShadowFilter id={id('shadow')} />
        <ShadowFilter id={id('kshadow')} dx={0.06} dy={0.12} blur={0.1} opacity={0.55} />
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f86ea" />
          <stop offset="0.5" stopColor="#2563c9" />
          <stop offset="1" stopColor="#163e86" />
        </linearGradient>
        <linearGradient id={id('top')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.22} />
          <stop offset="0.4" stopColor="#ffffff" stopOpacity={0} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.2} />
        </linearGradient>
        <radialGradient id={id('well')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.82" stopColor="#0c2350" />
          <stop offset="1" stopColor="#4a8ff0" />
        </radialGradient>
        <radialGradient id={id('rotor')} cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.55" stopColor="#e9edf1" />
          <stop offset="1" stopColor="#a3adb7" />
        </radialGradient>
        <linearGradient id={id('cap')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#f1f3f5" />
          <stop offset="1" stopColor="#c4ccd4" />
        </linearGradient>
      </defs>

      <Lead points={[[0.6, 3.4], [0.6, 3.58], [0, 3.84], [0, 4]]} pin="a" width={0.09} />
      <Lead points={[[2, 3.4], [2, 4]]} pin="wiper" width={0.09} />
      <Lead points={[[3.4, 3.4], [3.4, 3.58], [4, 3.84], [4, 4]]} pin="b" width={0.09} />

      <g filter={`url(#${id('shadow')})`}>
        <rect x={0.15} y={0} width={3.7} height={3.5} rx={0.28} fill={`url(#${id('body')})`} />
      </g>
      <rect x={0.15} y={0} width={3.7} height={3.5} rx={0.28} fill={`url(#${id('top')})`} />
      <rect x={0.3} y={0.15} width={3.4} height={3.2} rx={0.2} fill="none" stroke="#ffffff" strokeWidth={0.025} opacity={0.18} />

      {/* printed scale */}
      {!thumbnail &&
        Array.from({ length: 11 }, (_, i) => {
          const deg = -135 + i * 27;
          const [x1, y1] = polar(1.45, deg);
          const [x2, y2] = polar(i % 5 === 0 ? 1.6 : 1.54, deg);
          const on = deg <= angle + 0.01;
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="#ffffff"
              strokeWidth={i % 5 === 0 ? 0.06 : 0.04}
              strokeLinecap="round"
              opacity={on ? 0.85 : 0.28}
            />
          );
        })}
      {!thumbnail && (
        <text
          x={CX}
          y={3.4}
          fontSize={0.26}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fontWeight={600}
          fill="#ffffff"
          opacity={0.75}
          textAnchor="middle"
        >
          {code}
        </text>
      )}

      <circle cx={CX} cy={CY} r={1.33} fill={`url(#${id('well')})`} />

      <g className="cv-part-actuator" data-actuator="position">
        <circle cx={CX} cy={CY} r={1.4} fill="transparent" />
        <g filter={`url(#${id('kshadow')})`}>
          <circle cx={CX} cy={CY} r={1.2} fill={`url(#${id('rotor')})`} />
        </g>
        {/* knurled rim */}
        <circle cx={CX} cy={CY} r={1.16} fill="none" stroke="#b3bcc5" strokeWidth={0.07} strokeDasharray="0.05 0.055" />
        {/* raised knob cap */}
        <circle cx={CX + 0.03} cy={CY + 0.06} r={0.9} fill="#000000" opacity={0.22} />
        <circle cx={CX} cy={CY} r={0.9} fill={`url(#${id('cap')})`} />
        <circle cx={CX} cy={CY} r={0.9} fill="none" stroke="#aab3bc" strokeWidth={0.03} />
        <g transform={`rotate(${r4(angle)} ${CX} ${CY})`}>
          <rect x={CX - 0.085} y={CY - 1.12} width={0.17} height={0.8} rx={0.085} fill="#1b2330" />
          <rect x={CX - 0.04} y={CY - 1.06} width={0.08} height={0.38} rx={0.04} fill="#ff8a3d" />
          <rect x={CX + 0.05} y={CY - 1.0} width={0.03} height={0.62} rx={0.015} fill="#ffffff" opacity={0.6} />
        </g>
        <ellipse cx={CX - 0.36} cy={CY - 0.42} rx={0.28} ry={0.13} fill="#ffffff" opacity={0.7} transform={`rotate(-35 ${CX - 0.36} ${CY - 0.42})`} />
      </g>
    </g>
  );
}

export const PotentiometerRenderer = memo(PotentiometerImpl);
