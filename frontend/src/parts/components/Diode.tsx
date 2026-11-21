/**
 * 1N4007 rectifier diode (DO-41): glossy black body, silver band on the
 * cathode side (right, pin "cathode"), micro marking.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';

const BODY = { x: 0.96, y: -0.43, w: 2.08, h: 0.86, r: 0.16 };

function DiodeImpl({ part, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const burned = sim?.burned === true;
  const overloaded = !burned && sim?.overloaded === true;

  return (
    <g className="cv-part cv-part-diode">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.16} blur={0.14} />
        <clipPath id={id('clip')}>
          <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} />
        </clipPath>
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={burned ? '#3a2b22' : '#5a6069'} />
          <stop offset="0.22" stopColor={burned ? '#22180f' : '#262a30'} />
          <stop offset="0.6" stopColor="#0d0f12" />
          <stop offset="1" stopColor="#030405" />
        </linearGradient>
        <linearGradient id={id('band')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.3" stopColor="#d6dbe0" />
          <stop offset="0.7" stopColor="#9aa3ab" />
          <stop offset="1" stopColor="#5f6770" />
        </linearGradient>
      </defs>

      <Lead points={[[1.0, 0], [0, 0]]} pin="anode" />
      <Lead points={[[3.0, 0], [4, 0]]} pin="cathode" />

      <rect
        x={BODY.x}
        y={BODY.y}
        width={BODY.w}
        height={BODY.h}
        rx={BODY.r}
        fill={`url(#${id('body')})`}
        filter={`url(#${id('shadow')})`}
      />
      <g clipPath={`url(#${id('clip')})`}>
        <rect x={2.56} y={-0.5} width={0.26} height={1} fill={`url(#${id('band')})`} />
        <rect x={BODY.x} y={-0.33} width={BODY.w} height={0.09} rx={0.04} fill="#ffffff" opacity={0.28} />
        <rect x={BODY.x} y={0.28} width={BODY.w} height={0.06} fill="#ffffff" opacity={0.06} />
      </g>
      {!thumbnail && (
        <text
          x={1.74}
          y={0.1}
          fontSize={0.27}
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fontWeight={600}
          fill="#c4c9d0"
          opacity={0.78}
          textAnchor="middle"
          letterSpacing={0.01}
        >
          1N4007
        </text>
      )}
      {overloaded && (
        <rect className="cv-part-hot" x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} fill="none" stroke="#ffb547" strokeWidth={0.06} />
      )}
    </g>
  );
}

export const DiodeRenderer = memo(DiodeImpl);
