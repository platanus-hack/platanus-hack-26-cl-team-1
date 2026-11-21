/**
 * 9 V battery seen from above, terminal end down with a snap connector;
 * red / black leads end in tinned tips exactly on the plus / minus pins.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { leadPath, pinPoint } from './layout';
import { LeadWire, MONO, SANS, SelectionHalo, SoftShadow, url, useSvgId } from './svg';

const BODY = { x: 0.9, y: 0.3, w: 6.2, h: 11 };
const SNAP = { x: 1.55, y: 10.25, w: 4.9, h: 2.65 };
const RED = '#e5484d';
const BLACK = '#353a42';
const TIP = 1.15; // length of the tinned tip

function hexPath(cx: number, cy: number, r: number): string {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(a)).toFixed(3)} ${(cy + r * Math.sin(a)).toFixed(3)}`;
  });
  return `M${pts.join('L')}z`;
}

function Battery9VImpl({ part, def, selected, thumbnail }: PartRenderProps) {
  const uid = useSvgId(part.id);
  const minus = pinPoint(def.pins, 'minus', { x: 2, y: 16 });
  const plus = pinPoint(def.pins, 'plus', { x: 5, y: 16 });
  const exitY = SNAP.y + SNAP.h - 0.05;
  const mx = 2.6;
  const px = 5.4;
  const b = BODY;
  return (
    <g>
      <defs>
        <SoftShadow uid={uid} />
        <linearGradient id={`${uid}-case`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#111215" />
          <stop offset="0.16" stopColor="#2b2e34" />
          <stop offset="0.45" stopColor="#3b3f46" />
          <stop offset="0.84" stopColor="#2a2d33" />
          <stop offset="1" stopColor="#101114" />
        </linearGradient>
        <linearGradient id={`${uid}-label`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0" stopColor="#ffd166" />
          <stop offset="0.55" stopColor="#ff9f2e" />
          <stop offset="1" stopColor="#f2711c" />
        </linearGradient>
        <linearGradient id={`${uid}-round`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity="0.45" />
          <stop offset="0.14" stopColor="#000" stopOpacity="0" />
          <stop offset="0.3" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.42" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.86" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id={`${uid}-crimp`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6c757d" />
          <stop offset="0.3" stopColor="#d9dee3" />
          <stop offset="0.45" stopColor="#f7f9fa" />
          <stop offset="0.7" stopColor="#aab3bb" />
          <stop offset="1" stopColor="#5f6870" />
        </linearGradient>
        <linearGradient id={`${uid}-snap`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e3035" />
          <stop offset="1" stopColor="#0f1012" />
        </linearGradient>
      </defs>

      {selected && <SelectionHalo rect={{ x: b.x, y: b.y, w: b.w, h: SNAP.y + SNAP.h - b.y, r: 0.55 }} />}
      {/* body */}
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={0.55} fill={url(`${uid}-case`)} filter={url(`${uid}-shL`)} />
      <rect x={b.x} y={1.5} width={b.w} height={7.7} fill={url(`${uid}-label`)} />
      <rect x={b.x} y={2.35} width={b.w} height={0.14} fill="#1b1c1f" opacity={0.85} />
      <rect x={b.x} y={8.3} width={b.w} height={0.14} fill="#1b1c1f" opacity={0.85} />
      <g fill="#1b1c1f" textAnchor="middle">
        <text x={4} y={6.35} fontSize={3.1} fontFamily={SANS} fontWeight={800} letterSpacing={-0.1}>
          9V
        </text>
        {!thumbnail && (
          <>
            <text x={4} y={2.1} fontSize={0.44} fontFamily={MONO} fontWeight={700} opacity={0.75}>
              6LR61
            </text>
            <text x={4} y={7.65} fontSize={0.56} fontFamily={SANS} fontWeight={700} letterSpacing={0.16}>
              ALCALINA
            </text>
          </>
        )}
      </g>
      {/* terminal end: metal crimp */}
      <rect x={b.x} y={9.45} width={b.w} height={b.h - 9.15} rx={0.4} fill={url(`${uid}-crimp`)} />
      <path d={`M${b.x + 0.2} 9.75H${b.x + b.w - 0.2}M${b.x + 0.2} 10.05H${b.x + b.w - 0.2}`} stroke="#5f6870" strokeOpacity={0.5} strokeWidth={0.05} />
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={0.55} fill={url(`${uid}-round`)} />

      {/* snap connector */}
      <rect x={SNAP.x} y={SNAP.y} width={SNAP.w} height={SNAP.h} rx={0.5} fill={url(`${uid}-snap`)} filter={url(`${uid}-sh`)} />
      <path d={`M${SNAP.x + 0.4} ${SNAP.y + 0.07}H${SNAP.x + SNAP.w - 0.4}`} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={0.06} />
      {/* minus: hexagonal socket, plus: round stud (as on a real snap) */}
      <path d={hexPath(mx, 11.4, 0.7)} fill="#222429" stroke="#3a3d43" strokeWidth={0.05} />
      <circle cx={px} cy={11.4} r={0.62} fill="#222429" stroke="#3a3d43" strokeWidth={0.05} />
      {[mx, px].map((cx) => (
        <rect key={cx} x={cx - 0.27} y={exitY - 0.25} width={0.54} height={0.42} rx={0.12} fill="#1a1b1e" />
      ))}
      {!thumbnail && (
        <g fill="#9aa1a9" fontFamily={SANS} fontWeight={800} textAnchor="middle" fontSize={0.72}>
          <text x={mx} y={11.64}>−</text>
          <text x={px} y={11.66}>+</text>
        </g>
      )}

      {/* leads */}
      <LeadWire d={leadPath(mx, exitY, minus.x, minus.y, TIP)} tip={{ x: minus.x, y0: minus.y - TIP, y1: minus.y }} color={BLACK} thumbnail={thumbnail} />
      <LeadWire d={leadPath(px, exitY, plus.x, plus.y, TIP)} tip={{ x: plus.x, y0: plus.y - TIP, y1: plus.y }} color={RED} thumbnail={thumbnail} />

    </g>
  );
}

export const Battery9V = memo(Battery9VImpl);
