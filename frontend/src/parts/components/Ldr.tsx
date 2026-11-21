/**
 * 5 mm photoresistor (LDR), top view: ceramic disc with the orange CdS
 * serpentine track between silver electrodes under a clear epoxy coat.
 * Tint follows props.runtime.light (0..100). The disc is the actuator
 * (data-actuator="light").
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { clamp, mix, num, r4 } from './util';

const CX = 1;
const CY = 1.12;
const R_OUT = 0.98;
const R_IN = 0.8;

/** Serpentine track points inside the sensor window (pure, memo-free: cheap). */
export function serpentinePoints(rows = 7, spacing = 0.2, inner = 0.7): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  const y0 = CY - ((rows - 1) * spacing) / 2;
  for (let i = 0; i < rows; i++) {
    const y = y0 + i * spacing;
    const dy = y - CY;
    const h = Math.sqrt(Math.max(0, inner * inner - dy * dy)) - 0.04;
    const left: [number, number] = [r4(CX - h), r4(y)];
    const right: [number, number] = [r4(CX + h), r4(y)];
    if (i % 2 === 0) pts.push(left, right);
    else pts.push(right, left);
  }
  return pts;
}

const TRACK = serpentinePoints()
  .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`)
  .join(' ');

function LdrImpl({ part, runtime, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const t = clamp(num(runtime.light, 60), 0, 100) / 100;
  const track = mix('#6a2810', '#ff7a2c', t);
  const trackHi = mix('#8a3a1a', '#ffb070', t);

  return (
    <g className="cv-part cv-part-ldr">
      <defs>
        <ShadowFilter id={id('shadow')} />
        <clipPath id={id('win')}>
          <circle cx={CX} cy={CY} r={R_IN} />
        </clipPath>
        <radialGradient id={id('rim')} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#fbf3e6" />
          <stop offset="0.7" stopColor="#e2d1b8" />
          <stop offset="1" stopColor="#a8916f" />
        </radialGradient>
        <radialGradient id={id('metal')} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#eef1f4" />
          <stop offset="1" stopColor="#9aa3ac" />
        </radialGradient>
        <radialGradient id={id('light')} cx="0.45" cy="0.4" r="0.6">
          <stop offset="0" stopColor="#fff7dc" stopOpacity={0.9} />
          <stop offset="1" stopColor="#ffd27a" stopOpacity={0} />
        </radialGradient>
      </defs>

      <Lead points={[[0.62, 1.9], [0.62, 2.25], [0, 2.62], [0, 3]]} pin="a" />
      <Lead points={[[1.38, 1.9], [1.38, 2.25], [2, 2.62], [2, 3]]} pin="b" />

      <g className="cv-part-actuator" data-actuator="light">
        {t > 0.55 && !thumbnail && (
          <circle cx={CX} cy={CY} r={R_OUT + 0.55 * t} fill={`url(#${id('light')})`} opacity={(t - 0.55) * 0.9} />
        )}
        <g filter={`url(#${id('shadow')})`}>
          <circle cx={CX} cy={CY} r={R_OUT} fill={`url(#${id('rim')})`} />
        </g>
        <circle cx={CX} cy={CY} r={R_IN} fill={`url(#${id('metal')})`} />
        <g clipPath={`url(#${id('win')})`}>
          <path d={TRACK} fill="none" stroke={track} strokeWidth={0.115} strokeLinejoin="round" strokeLinecap="round" />
          {!thumbnail && (
            <path
              d={TRACK}
              fill="none"
              stroke={trackHi}
              strokeWidth={0.03}
              strokeLinejoin="round"
              transform="translate(-0.01 -0.025)"
              opacity={0.7}
            />
          )}
          <circle cx={CX} cy={CY} r={R_IN} fill={`url(#${id('light')})`} opacity={0.15 + 0.4 * t} />
          <rect x={0} y={0} width={2} height={2.2} fill="#000000" opacity={(1 - t) * 0.38} />
        </g>
        <circle cx={CX} cy={CY} r={R_IN} fill="none" stroke="#8c7558" strokeWidth={0.03} opacity={0.7} />
        {/* clear epoxy dome */}
        <circle cx={CX} cy={CY} r={R_OUT - 0.02} fill="none" stroke="#ffffff" strokeWidth={0.03} opacity={0.35} />
        <ellipse cx={CX - 0.35} cy={CY - 0.45} rx={0.3} ry={0.14} fill="#ffffff" opacity={0.55} transform={`rotate(-35 ${CX - 0.35} ${CY - 0.45})`} />
        <path d={`M ${CX + 0.55} ${CY + 0.55} A 0.78 0.78 0 0 0 ${CX + 0.78} ${CY - 0.1}`} fill="none" stroke="#ffffff" strokeWidth={0.04} opacity={0.25} />
      </g>
    </g>
  );
}

export const LdrRenderer = memo(LdrImpl);
