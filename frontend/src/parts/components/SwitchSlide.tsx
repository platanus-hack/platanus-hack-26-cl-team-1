/**
 * SPDT slide switch, top view: blue body, steel bezel around the slot, white
 * ridged slider on the 'a' (left, joins com↔a) or 'b' (right) side.
 * The slider is the actuator (data-actuator="position").
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { str } from './util';

const SLOT = { x: 0.08, y: 0.46, w: 1.84, h: 0.66 };
const SLIDER_W = 0.86;

function SwitchSlideImpl({ part, runtime, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const pos = str(runtime.position, 'a') === 'b' ? 'b' : 'a';
  const sx = pos === 'a' ? SLOT.x + 0.06 : SLOT.x + SLOT.w - 0.06 - SLIDER_W;

  return (
    <g className="cv-part cv-part-switch-slide">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.16} blur={0.14} />
        <ShadowFilter id={id('kshadow')} dx={pos === 'a' ? 0.08 : -0.02} dy={0.08} blur={0.06} opacity={0.6} />
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a92f0" />
          <stop offset="0.55" stopColor="#2766c8" />
          <stop offset="1" stopColor="#163f86" />
        </linearGradient>
        <linearGradient id={id('bezel')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0f3f6" />
          <stop offset="0.5" stopColor="#aab3bc" />
          <stop offset="1" stopColor="#6c757e" />
        </linearGradient>
        <linearGradient id={id('slot')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#020304" />
          <stop offset="1" stopColor="#1a1f26" />
        </linearGradient>
        <linearGradient id={id('knob')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#e7ebef" />
          <stop offset="1" stopColor="#b8c0c8" />
        </linearGradient>
      </defs>

      <Lead points={[[0, 1.4], [0, 2]]} pin="a" width={0.1} />
      <Lead points={[[1, 1.4], [1, 2]]} pin="com" width={0.1} />
      <Lead points={[[2, 1.4], [2, 2]]} pin="b" width={0.1} />

      <g filter={`url(#${id('shadow')})`}>
        <rect x={-0.44} y={0.1} width={2.88} height={1.46} rx={0.12} fill={`url(#${id('body')})`} />
      </g>
      {/* front face strip for depth */}
      <rect x={-0.44} y={1.34} width={2.88} height={0.22} rx={0.08} fill="#0f2f66" opacity={0.55} />
      <rect x={-0.4} y={0.14} width={2.8} height={0.05} rx={0.025} fill="#ffffff" opacity={0.3} />

      {/* steel bezel + slot */}
      <rect x={SLOT.x - 0.1} y={SLOT.y - 0.1} width={SLOT.w + 0.2} height={SLOT.h + 0.2} rx={0.1} fill={`url(#${id('bezel')})`} />
      <rect x={SLOT.x} y={SLOT.y} width={SLOT.w} height={SLOT.h} rx={0.06} fill={`url(#${id('slot')})`} />

      {!thumbnail && (
        <g fontFamily="Inter, system-ui, sans-serif" fontWeight={700} fontSize={0.3} fill="#ffffff" opacity={0.7} textAnchor="middle">
          <text x={-0.2} y={0.9}>A</text>
          <text x={2.2} y={0.9}>B</text>
        </g>
      )}

      <g className="cv-part-actuator" data-actuator="position">
        <rect x={SLOT.x} y={SLOT.y - 0.2} width={SLOT.w} height={SLOT.h + 0.4} fill="transparent" />
        <g filter={`url(#${id('kshadow')})`}>
          <rect x={sx} y={SLOT.y - 0.08} width={SLIDER_W} height={SLOT.h + 0.16} rx={0.08} fill={`url(#${id('knob')})`} />
        </g>
        <rect x={sx + 0.04} y={SLOT.y - 0.05} width={SLIDER_W - 0.08} height={0.06} rx={0.03} fill="#ffffff" opacity={0.9} />
        {[0.24, 0.38, 0.52, 0.66].map((dx) => (
          <g key={dx}>
            <rect x={sx + dx - 0.02} y={SLOT.y + 0.06} width={0.04} height={SLOT.h - 0.12} fill="#9aa4ae" />
            <rect x={sx + dx + 0.02} y={SLOT.y + 0.06} width={0.025} height={SLOT.h - 0.12} fill="#ffffff" opacity={0.8} />
          </g>
        ))}
      </g>
    </g>
  );
}

export const SwitchSlideRenderer = memo(SwitchSlideImpl);
