/**
 * 2N2222 NPN transistor in a TO-92 package, flat face toward the viewer
 * (the rounded back shows as darker side edges). Legs E · B · C left→right.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';

/** Flat face outline: straight bottom, rounded top corners. */
const BODY = 'M 0.14 1.36 L 0.14 0.34 Q 0.14 0.02 0.46 0.02 L 1.54 0.02 Q 1.86 0.02 1.86 0.34 L 1.86 1.36 Z';

function NpnImpl({ part, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const burned = sim?.burned === true;
  const overloaded = !burned && sim?.overloaded === true;

  return (
    <g className="cv-part cv-part-npn">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.16} blur={0.14} />
        <clipPath id={id('clip')}>
          <path d={BODY} />
        </clipPath>
        <linearGradient id={id('body')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#020203" />
          <stop offset="0.14" stopColor={burned ? '#2a1f18' : '#24272c'} />
          <stop offset="0.45" stopColor={burned ? '#3a2c22' : '#33373d'} />
          <stop offset="0.86" stopColor={burned ? '#1e1610' : '#1c1f23'} />
          <stop offset="1" stopColor="#020203" />
        </linearGradient>
        <linearGradient id={id('face')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.14} />
          <stop offset="0.35" stopColor="#ffffff" stopOpacity={0.02} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.3} />
        </linearGradient>
      </defs>

      <Lead points={[[0.55, 1.3], [0.55, 1.48], [0, 1.78], [0, 2]]} pin="e" />
      <Lead points={[[1, 1.3], [1, 2]]} pin="b" />
      <Lead points={[[1.45, 1.3], [1.45, 1.48], [2, 1.78], [2, 2]]} pin="c" />

      <path d={BODY} fill={`url(#${id('body')})`} filter={`url(#${id('shadow')})`} />
      <g clipPath={`url(#${id('clip')})`}>
        <rect x={0.14} y={0} width={1.72} height={1.4} fill={`url(#${id('face')})`} />
        <rect x={0.34} y={0.08} width={1.32} height={0.06} rx={0.03} fill="#ffffff" opacity={0.22} />
        <rect x={0.14} y={1.22} width={1.72} height={0.14} fill="#000000" opacity={0.35} />
      </g>
      <circle cx={1} cy={0.28} r={0.07} fill="#000000" opacity={0.5} />
      {!thumbnail && (
        <g
          fontFamily="'JetBrains Mono', ui-monospace, monospace"
          fontWeight={600}
          fontSize={0.27}
          fill="#c9ced6"
          opacity={0.8}
          textAnchor="middle"
        >
          <text x={1} y={0.68}>2N</text>
          <text x={1} y={0.98}>2222</text>
        </g>
      )}
      {overloaded && <path className="cv-part-hot" d={BODY} fill="none" stroke="#ffb547" strokeWidth={0.06} />}
    </g>
  );
}

export const NpnRenderer = memo(NpnImpl);
