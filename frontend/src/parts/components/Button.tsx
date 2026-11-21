/**
 * 6 mm tactile push button, top view: black base, stamped steel cover,
 * coloured round cap (props.runtime.cap) that sinks in when pressed.
 * The cap is the actuator (data-actuator="pressed"); the canvas handles input.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { bool, darken, lighten, str } from './util';

export const CAP_COLORS: Record<string, string> = {
  black: '#2c3036',
  red: '#e5484d',
  blue: '#3b82f6',
  yellow: '#f5c518',
  green: '#30a46c',
};

const CX = 1;
const CY = 1.5;
/** Steel cover plate with chamfered corners (the black base shows at the corners). */
const PLATE = 'M 0.2 0.4 L 1.8 0.4 L 2.1 0.7 L 2.1 2.3 L 1.8 2.6 L 0.2 2.6 L -0.1 2.3 L -0.1 0.7 Z';

function ButtonImpl({ part, runtime, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const pressed = bool(runtime.pressed);
  const base = CAP_COLORS[str(runtime.cap, 'black')] ?? CAP_COLORS.black;
  const cap = pressed ? darken(base, 0.18) : base;
  const capR = pressed ? 0.66 : 0.74;

  return (
    <g className="cv-part cv-part-button">
      <defs>
        <ShadowFilter id={id('shadow')} />
        <filter id={id('blur')} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={pressed ? 0.03 : 0.07} />
        </filter>
        <linearGradient id={id('base')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#30343b" />
          <stop offset="1" stopColor="#111317" />
        </linearGradient>
        <linearGradient id={id('plate')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3f5f7" />
          <stop offset="0.35" stopColor="#c3cad1" />
          <stop offset="0.6" stopColor="#e1e6ea" />
          <stop offset="1" stopColor="#8a939c" />
        </linearGradient>
        <radialGradient id={id('cap')} cx="0.36" cy="0.3" r="0.78">
          <stop offset="0" stopColor={lighten(cap, pressed ? 0.25 : 0.5)} />
          <stop offset="0.45" stopColor={cap} />
          <stop offset="1" stopColor={darken(cap, 0.5)} />
        </radialGradient>
        <linearGradient id={id('dish')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#000000" stopOpacity={0.35} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0.25} />
        </linearGradient>
      </defs>

      <Lead points={[[0, 0.45], [0, 0]]} pin="a1" width={0.13} />
      <Lead points={[[2, 0.45], [2, 0]]} pin="b1" width={0.13} />
      <Lead points={[[0, 2.55], [0, 3]]} pin="a2" width={0.13} />
      <Lead points={[[2, 2.55], [2, 3]]} pin="b2" width={0.13} />

      <g filter={`url(#${id('shadow')})`}>
        <rect x={-0.22} y={0.28} width={2.44} height={2.44} rx={0.16} fill={`url(#${id('base')})`} />
      </g>
      {[[-0.04, 0.46], [2.04, 0.46], [-0.04, 2.54], [2.04, 2.54]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={0.1} fill="#0b0c0f" />
          <circle cx={x - 0.02} cy={y - 0.02} r={0.05} fill="#4b5059" opacity={0.6} />
        </g>
      ))}
      <path d={PLATE} fill={`url(#${id('plate')})`} />
      <path d={PLATE} fill="none" stroke="#5f6870" strokeWidth={0.03} />
      <path d="M 0.22 0.46 L 1.78 0.46" stroke="#ffffff" strokeWidth={0.03} opacity={0.6} />
      {!thumbnail && (
        <g opacity={0.5}>
          <circle cx={0.32} cy={0.78} r={0.06} fill="#7d868f" />
          <circle cx={1.68} cy={0.78} r={0.06} fill="#7d868f" />
          <circle cx={0.32} cy={2.22} r={0.06} fill="#7d868f" />
          <circle cx={1.68} cy={2.22} r={0.06} fill="#7d868f" />
        </g>
      )}
      {/* embossed ring + hole */}
      <circle cx={CX} cy={CY} r={0.92} fill="none" stroke="#ffffff" strokeWidth={0.05} opacity={0.55} transform="translate(0.02 0.03)" />
      <circle cx={CX} cy={CY} r={0.92} fill="none" stroke="#6a737c" strokeWidth={0.05} />
      <circle cx={CX} cy={CY} r={0.82} fill="#08090b" />

      <g className="cv-part-actuator" data-actuator="pressed">
        <circle cx={CX} cy={CY} r={0.95} fill="transparent" />
        <circle
          cx={CX + (pressed ? 0.02 : 0.07)}
          cy={CY + (pressed ? 0.03 : 0.12)}
          r={capR + 0.02}
          fill="#000000"
          opacity={pressed ? 0.5 : 0.65}
          filter={`url(#${id('blur')})`}
        />
        <circle cx={CX} cy={CY} r={capR} fill={`url(#${id('cap')})`} />
        <circle cx={CX} cy={CY} r={capR * 0.68} fill={`url(#${id('dish')})`} opacity={pressed ? 0.5 : 0.8} />
        <circle cx={CX} cy={CY} r={capR} fill="none" stroke={darken(cap, 0.6)} strokeWidth={0.03} opacity={0.7} />
        <ellipse
          cx={CX - 0.25}
          cy={CY - 0.3}
          rx={0.2}
          ry={0.11}
          fill="#ffffff"
          opacity={pressed ? 0.25 : 0.55}
          transform={`rotate(-35 ${CX - 0.25} ${CY - 0.3})`}
        />
        {pressed && <circle cx={CX} cy={CY} r={0.75} fill="none" stroke="#000000" strokeWidth={0.07} opacity={0.55} />}
      </g>
    </g>
  );
}

export const ButtonRenderer = memo(ButtonImpl);
