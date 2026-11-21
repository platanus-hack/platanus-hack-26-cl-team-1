/**
 * Small DC motor (130 size) standing on its end cap, seen from the front and
 * slightly above: brushed-steel can, brass bushing, shaft and a bright
 * propeller in perspective that spins with sim.speed (sign = direction).
 * Red/black leads run from the terminals down to pins a / b.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { Lead, ShadowFilter, usePartIds } from './Lead';
import { spinSeconds } from './util';
import './components.css';

const CX = 5;
const CAN = { x0: 2.2, x1: 7.8, top: 4.2, bottom: 8.5, ry: 0.7 };
const PROP = { cy: 2.0, r: 4.3, squash: 0.4 };

/** One propeller blade pointing along +x (local, unsquashed). */
const BLADE = 'M 0.45 -0.32 C 1.5 -1.45 3.55 -1.38 4.28 -0.4 C 4.48 0.08 4.05 0.48 3.4 0.52 C 2.2 0.62 1.0 0.52 0.45 0.32 Z';

const RED_WIRE = 'M 3.6 9.95 C 3.6 10.7 3.0 10.75 3.0 11.48';
const BLACK_WIRE = 'M 6.4 9.95 C 6.4 10.7 6.0 10.75 6.0 11.48';

function Wire({ d, color }: { d: string; color: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke="#000000" strokeWidth={0.3} strokeLinecap="round" opacity={0.55} />
      <path d={d} fill="none" stroke={color} strokeWidth={0.24} strokeLinecap="round" />
      <path d={d} fill="none" stroke="#ffffff" strokeWidth={0.06} strokeLinecap="round" opacity={0.35} transform="translate(-0.05 0)" />
    </g>
  );
}

function MotorDcImpl({ part, sim, thumbnail }: PartRenderProps) {
  const id = usePartIds(part.id);
  const burned = sim?.burned === true;
  const speed = burned ? 0 : sim?.speed;
  const secs = spinSeconds(speed);
  const s = secs === null ? 0 : Math.min(1, Math.abs(speed ?? 0));
  const overloaded = !burned && sim?.overloaded === true;

  return (
    <g className="cv-part cv-part-motor-dc">
      <defs>
        <ShadowFilter id={id('shadow')} dy={0.3} blur={0.3} />
        <linearGradient id={id('can')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={burned ? '#3a3633' : '#5c646d'} />
          <stop offset="0.18" stopColor={burned ? '#6a625c' : '#d9dfe5'} />
          <stop offset="0.3" stopColor={burned ? '#7a716a' : '#f7f9fb'} />
          <stop offset="0.5" stopColor={burned ? '#5a524c' : '#b3bcc4'} />
          <stop offset="0.78" stopColor={burned ? '#4a433e' : '#8d969f'} />
          <stop offset="0.92" stopColor={burned ? '#2e2a27' : '#c7ced5'} />
          <stop offset="1" stopColor={burned ? '#1e1b19' : '#5a626a'} />
        </linearGradient>
        <radialGradient id={id('lid')} cx="0.42" cy="0.35" r="0.7">
          <stop offset="0" stopColor={burned ? '#6a625c' : '#f5f7f9'} />
          <stop offset="1" stopColor={burned ? '#3a3633' : '#9aa3ac'} />
        </radialGradient>
        <linearGradient id={id('cap')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0b0c0e" />
          <stop offset="0.3" stopColor="#2d3137" />
          <stop offset="1" stopColor="#0b0c0e" />
        </linearGradient>
        <linearGradient id={id('brass')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8a6420" />
          <stop offset="0.4" stopColor="#f1d27a" />
          <stop offset="1" stopColor="#8a6420" />
        </linearGradient>
        <linearGradient id={id('blade')} x1="0" y1="-1" x2="0" y2="1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffb057" />
          <stop offset="0.55" stopColor="#ff7a1f" />
          <stop offset="1" stopColor="#d9480f" />
        </linearGradient>
        <radialGradient id={id('blur')}>
          <stop offset="0" stopColor="#ff8c2e" stopOpacity={0.7} />
          <stop offset="0.75" stopColor="#ff7a1f" stopOpacity={0.45} />
          <stop offset="0.95" stopColor="#ff7a1f" stopOpacity={0.25} />
          <stop offset="1" stopColor="#ff7a1f" stopOpacity={0} />
        </radialGradient>
      </defs>

      {/* leads */}
      <Lead points={[[3, 11.4], [3, 12]]} pin="a" width={0.1} />
      <Lead points={[[6, 11.4], [6, 12]]} pin="b" width={0.1} />
      <Wire d={RED_WIRE} color="#d8342c" />
      <Wire d={BLACK_WIRE} color="#25282e" />

      {/* end cap + terminals */}
      <g filter={`url(#${id('shadow')})`}>
        <path d="M 2.4 8.5 L 2.4 9.2 A 2.6 0.65 0 0 0 7.6 9.2 L 7.6 8.5 Z" fill={`url(#${id('cap')})`} />
        <path
          d={`M ${CAN.x0} ${CAN.top} L ${CAN.x0} ${CAN.bottom} A 2.8 ${CAN.ry} 0 0 0 ${CAN.x1} ${CAN.bottom} L ${CAN.x1} ${CAN.top} Z`}
          fill={`url(#${id('can')})`}
        />
      </g>
      {[3.6, 6.4].map((x) => (
        <g key={x}>
          <rect x={x - 0.16} y={9.5} width={0.32} height={0.56} rx={0.04} fill={`url(#${id('brass')})`} />
          <circle cx={x} cy={9.72} r={0.07} fill="#3a2a10" />
          <ellipse cx={x} cy={10.0} rx={0.17} ry={0.1} fill="#c9ced4" />
        </g>
      ))}

      {/* can details: crimp ring, vents */}
      <path d={`M ${CAN.x0} 7.95 A 2.8 ${CAN.ry} 0 0 0 ${CAN.x1} 7.95`} fill="none" stroke="#000000" strokeWidth={0.05} opacity={0.3} />
      <path d={`M ${CAN.x0} 8.02 A 2.8 ${CAN.ry} 0 0 0 ${CAN.x1} 8.02`} fill="none" stroke="#ffffff" strokeWidth={0.03} opacity={0.35} />
      {!thumbnail && (
        <g>
          <rect x={3.15} y={6.9} width={0.5} height={0.26} rx={0.1} fill="#2a2f35" opacity={0.85} />
          <rect x={6.35} y={6.9} width={0.5} height={0.26} rx={0.1} fill="#2a2f35" opacity={0.85} />
          <rect x={2.75} y={4.6} width={0.12} height={3.0} rx={0.06} fill="#ffffff" opacity={0.35} />
        </g>
      )}

      {/* lid */}
      <ellipse cx={CX} cy={CAN.top} rx={2.8} ry={CAN.ry} fill={`url(#${id('lid')})`} />
      <ellipse cx={CX} cy={CAN.top} rx={2.8} ry={CAN.ry} fill="none" stroke="#6b737c" strokeWidth={0.04} />
      <ellipse cx={CX} cy={CAN.top} rx={1.6} ry={0.4} fill="none" stroke="#7d868f" strokeWidth={0.04} opacity={0.7} />
      <ellipse cx={3.7} cy={CAN.top} rx={0.17} ry={0.07} fill="#1e2227" />
      <ellipse cx={6.3} cy={CAN.top} rx={0.17} ry={0.07} fill="#1e2227" />
      <ellipse cx={CX} cy={CAN.top} rx={0.6} ry={0.17} fill={`url(#${id('brass')})`} />
      <ellipse cx={CX} cy={CAN.top - 0.02} rx={0.38} ry={0.1} fill="#6e4f14" opacity={0.6} />

      {/* shaft */}
      <rect x={CX - 0.12} y={PROP.cy} width={0.24} height={CAN.top - PROP.cy} fill="url(#cv-metal)" />
      <rect x={CX - 0.06} y={PROP.cy} width={0.05} height={CAN.top - PROP.cy} fill="#ffffff" opacity={0.7} />

      {/* propeller in perspective */}
      <g transform={`translate(${CX} ${PROP.cy}) scale(1 ${PROP.squash})`}>
        {secs !== null && <circle r={PROP.r} fill={`url(#${id('blur')})`} opacity={0.15 + 0.4 * s} />}
        <g
          className={secs !== null ? 'cv-part-spin' : undefined}
          style={secs !== null ? { animationDuration: `${secs}s`, animationDirection: (speed ?? 0) < 0 ? 'reverse' : 'normal' } : undefined}
        >
          <circle r={PROP.r + 0.1} fill="transparent" />
          <g opacity={1 - 0.5 * s}>
            {[0, 120, 240].map((a) => (
              <g key={a} transform={`rotate(${a})`}>
                <path d={BLADE} fill={`url(#${id('blade')})`} />
                <path d={BLADE} fill="none" stroke="#a8380a" strokeWidth={0.06} opacity={0.6} />
                <path d="M 0.8 -0.2 C 1.8 -0.9 3.2 -0.95 3.95 -0.42" fill="none" stroke="#ffffff" strokeWidth={0.1} opacity={0.35} />
              </g>
            ))}
          </g>
          <circle r={0.7} fill="#e8590c" />
          <circle r={0.7} fill="none" stroke="#a8380a" strokeWidth={0.08} />
          <circle r={0.3} fill="url(#cv-metal)" />
          <circle cx={-0.2} cy={-0.25} r={0.22} fill="#ffffff" opacity={0.4} />
        </g>
      </g>

      {overloaded && (
        <path
          className="cv-part-hot"
          d={`M ${CAN.x0} ${CAN.top} L ${CAN.x0} ${CAN.bottom} A 2.8 ${CAN.ry} 0 0 0 ${CAN.x1} ${CAN.bottom} L ${CAN.x1} ${CAN.top}`}
          fill="none"
          stroke="#ffb547"
          strokeWidth={0.1}
        />
      )}
    </g>
  );
}

export const MotorDcRenderer = memo(MotorDcImpl);
