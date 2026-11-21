/**
 * SG90 micro servo, top view: translucent blue case with mounting ears,
 * gearbox boss, white single-arm horn rotated by sim.angle (0° → right,
 * 90° → up, 180° → left, like a protractor), brown/red/orange ribbon cable to
 * a black connector whose 3 male pins sit on gnd / vcc / signal.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { r4, servoAngle } from './util';

const SHAFT = { x: 7.0, y: 1.4 };
const BODY = { x: 1.6, y: -0.9, w: 7.8, h: 4.6 };
const WIRES = [
  { pin: 'gnd', color: '#6b3d1f', x0: 2.55, x1: 1 },
  { pin: 'vcc', color: '#d4352b', x0: 2.89, x1: 2 },
  { pin: 'signal', color: '#f28a1a', x0: 3.23, x1: 3 },
] as const;

const wirePath = (x0: number, x1: number) => `M ${x0} 3.55 C ${x0} 5.7 ${x1} 5.2 ${x1} 7.32`;

const ARM = 'M 0 -0.5 L 2.62 -0.24 A 0.24 0.24 0 0 1 2.62 0.24 L 0 0.5 Z';

const EAR_W = 1.45;

/** Mounting ear with its screw hole and the open slot towards the outer edge. */
function Ear({ x, holeX, fill }: { x: number; holeX: number; fill: string }) {
  const outerLeft = holeX - x < EAR_W / 2;
  const slotX = outerLeft ? x - 0.01 : holeX;
  const slotW = outerLeft ? holeX - x + 0.01 : x + EAR_W - holeX + 0.01;
  return (
    <g>
      <rect x={x} y={-0.3} width={EAR_W} height={3.4} rx={0.18} fill={fill} />
      <rect x={x + 0.08} y={-0.24} width={EAR_W - 0.16} height={0.06} rx={0.03} fill="#ffffff" opacity={0.25} />
      <rect x={x} y={-0.3} width={EAR_W} height={3.4} rx={0.18} fill="none" stroke="#163c86" strokeWidth={0.04} />
      <rect x={slotX} y={1.27} width={slotW} height={0.26} fill="#0b0f14" />
      <circle cx={holeX} cy={1.4} r={0.3} fill="#0b0f14" />
      <circle cx={holeX} cy={1.4} r={0.3} fill="none" stroke="#5d97f2" strokeWidth={0.03} opacity={0.6} />
    </g>
  );
}

function ServoSg90Impl({ part, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const angle = servoAngle(sim?.angle);

  return (
    <g className="cv-part cv-part-servo-sg90">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.28} blur={0.28} />
        <ShadowFilter id={id('hshadow')} dx={0.1} dy={0.18} blur={0.12} opacity={0.55} />
        <linearGradient id={id('body')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4d8ff5" />
          <stop offset="0.5" stopColor="#2e6ad6" />
          <stop offset="1" stopColor="#1b47a6" />
        </linearGradient>
        <linearGradient id={id('ear')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f7fe6" />
          <stop offset="1" stopColor="#1d4aa8" />
        </linearGradient>
        <radialGradient id={id('boss')} cx="0.4" cy="0.35" r="0.7">
          <stop offset="0" stopColor="#5d9cf7" />
          <stop offset="1" stopColor="#245bc4" />
        </radialGradient>
        <radialGradient id={id('horn')} cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.7" stopColor="#eef0f2" />
          <stop offset="1" stopColor="#c3c9cf" />
        </radialGradient>
        <linearGradient id={id('conn')} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a3e45" />
          <stop offset="0.2" stopColor="#1d2025" />
          <stop offset="1" stopColor="#0a0b0d" />
        </linearGradient>
      </defs>

      {/* connector pins (male, on the pin points) */}
      {WIRES.map((w) => (
        <Lead key={w.pin} points={[[w.x1, 8.5], [w.x1, 9]]} pin={w.pin} width={0.13} tone="gold" />
      ))}

      {/* ribbon cable */}
      {WIRES.map((w) => (
        <path key={`o-${w.pin}`} d={wirePath(w.x0, w.x1)} fill="none" stroke="#000000" strokeWidth={0.36} strokeLinecap="round" opacity={0.5} />
      ))}
      {WIRES.map((w) => (
        <g key={`w-${w.pin}`}>
          <path d={wirePath(w.x0, w.x1)} fill="none" stroke={w.color} strokeWidth={0.3} strokeLinecap="round" />
          <path d={wirePath(w.x0 - 0.06, w.x1 - 0.06)} fill="none" stroke="#ffffff" strokeWidth={0.06} strokeLinecap="round" opacity={0.3} />
        </g>
      ))}

      {/* connector */}
      <g filter={`url(#${id('shadow')})`}>
        <rect x={0.45} y={7.22} width={3.1} height={1.36} rx={0.1} fill={`url(#${id('conn')})`} />
      </g>
      <rect x={0.55} y={7.3} width={2.9} height={0.08} rx={0.04} fill="#ffffff" opacity={0.18} />
      {!thumbnail && (
        <g>
          {[1, 2, 3].map((x) => (
            <rect key={x} x={x - 0.18} y={7.6} width={0.36} height={0.7} rx={0.05} fill="#000000" opacity={0.55} />
          ))}
          <path d="M 0.62 8.38 l 0.16 -0.2 l 0.16 0.2 Z" fill="#9aa3ad" opacity={0.6} />
        </g>
      )}

      {/* case */}
      <g filter={`url(#${id('shadow')})`}>
        <Ear x={0.25} holeX={0.85} fill={`url(#${id('ear')})`} />
        <Ear x={9.3} holeX={10.15} fill={`url(#${id('ear')})`} />
        <rect x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={0.3} fill={`url(#${id('body')})`} />
      </g>
      <rect x={BODY.x + 0.12} y={BODY.y + 0.12} width={BODY.w - 0.24} height={BODY.h - 0.24} rx={0.22} fill="none" stroke="#9cc3ff" strokeWidth={0.04} opacity={0.35} />
      <rect x={2.35} y={3.5} width={1.3} height={0.32} rx={0.1} fill="#13306e" />

      {/* gears faintly visible through the translucent case */}
      {!thumbnail && (
        <g fill="none" stroke="#bcd6ff" opacity={0.16}>
          <circle cx={4.3} cy={1.6} r={1.05} strokeWidth={0.14} strokeDasharray="0.12 0.1" />
          <circle cx={4.3} cy={1.6} r={0.45} strokeWidth={0.05} />
          <circle cx={2.9} cy={0.4} r={0.6} strokeWidth={0.12} strokeDasharray="0.1 0.09" />
        </g>
      )}

      {/* gearbox boss */}
      <circle cx={5.05} cy={SHAFT.y} r={0.95} fill={`url(#${id('boss')})`} />
      <circle cx={SHAFT.x} cy={SHAFT.y} r={1.72} fill={`url(#${id('boss')})`} />
      <circle cx={SHAFT.x} cy={SHAFT.y} r={1.72} fill="none" stroke="#163c86" strokeWidth={0.04} />
      <circle cx={5.05} cy={SHAFT.y} r={0.95} fill="none" stroke="#163c86" strokeWidth={0.04} opacity={0.6} />
      <circle cx={SHAFT.x} cy={SHAFT.y} r={1.66} fill="none" stroke="#a9ccff" strokeWidth={0.035} opacity={0.4} />

      {/* screws */}
      {[[2.0, -0.5], [9.0, -0.5], [2.0, 3.3], [9.0, 3.3]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r={0.15} fill="url(#cv-metal)" />
          <path d={`M ${x - 0.1} ${y} L ${x + 0.1} ${y}`} stroke="#4b545d" strokeWidth={0.04} />
        </g>
      ))}

      {!thumbnail && (
        <g fontFamily="Inter, system-ui, sans-serif" fill="#ffffff" textAnchor="middle">
          <text x={2.85} y={1.5} fontSize={0.66} fontWeight={800} opacity={0.88} letterSpacing={0.02}>
            SG90
          </text>
          <text x={2.85} y={2.2} fontSize={0.34} fontWeight={600} opacity={0.6}>
            9g · 180°
          </text>
        </g>
      )}

      {/* horn */}
      <g filter={`url(#${id('hshadow')})`}>
        <g transform={`translate(${SHAFT.x} ${SHAFT.y}) rotate(${r4(-angle)})`}>
          <path d={ARM} fill="#f4f5f6" />
          <path d={ARM} fill="none" stroke="#b9c0c7" strokeWidth={0.04} />
          <path d="M 0.6 -0.3 L 2.6 -0.15" stroke="#ffffff" strokeWidth={0.06} opacity={0.9} />
          {[1.2, 1.6, 2.0, 2.4].map((x) => (
            <circle key={x} cx={x} cy={0} r={0.075} fill="#5c6670" />
          ))}
          <circle r={0.8} fill={`url(#${id('horn')})`} />
          <circle r={0.8} fill="none" stroke="#b9c0c7" strokeWidth={0.04} />
          <circle r={0.46} fill="none" stroke="#c9cfd5" strokeWidth={0.04} />
          <circle r={0.22} fill="url(#cv-metal)" />
          <path d="M -0.14 0 L 0.14 0 M 0 -0.14 L 0 0.14" stroke="#4b545d" strokeWidth={0.05} />
        </g>
      </g>
    </g>
  );
}

export const ServoSg90Renderer = memo(ServoSg90Impl);
