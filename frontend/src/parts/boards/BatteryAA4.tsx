/**
 * 4×AA battery holder seen from above: four cylindrical cells in alternating
 * orientation, springs and contacts, red / black leads to the pins.
 */
import { memo } from 'react';
import type { PartRenderProps } from '../types';
import { leadPath, pinPoint } from './layout';
import { LeadWire, SANS, SelectionHalo, SoftShadow, url, useSvgId } from './svg';

const HOLDER = { x: 0.3, y: 0.2, w: 11.4, h: 12.1 };
const CAVITY = { x: 0.75, y: 0.7, w: 10.5, h: 10.55 };
const CELL_W = 2.5;
const CELL_X = [0.85, 3.45, 6.05, 8.65];
const CELL_TOP = 1.35;
const CELL_BOT = 10.75;
const RED = '#e5484d';
const BLACK = '#353a42';
const TIP = 0.8;

/** Spring coil (zigzag) across a cell's negative end. */
function springPath(cx: number, y0: number, y1: number): string {
  let d = `M${cx - 0.75} ${y0}`;
  for (let i = 0; i < 7; i++) d += `L${(cx - 0.75 + (i + 0.5) * (1.5 / 7)).toFixed(3)} ${i % 2 === 0 ? y1 : y0}`;
  return `${d}L${cx + 0.75} ${y1}`;
}

function Cell({ uid, x, plusUp, thumbnail }: { uid: string; x: number; plusUp: boolean; thumbnail?: boolean }) {
  const cx = x + CELL_W / 2;
  const len = CELL_BOT - CELL_TOP;
  const band = 1.7;
  const plusEnd = plusUp ? CELL_TOP : CELL_BOT;
  const bandY = plusUp ? CELL_TOP : CELL_BOT - band;
  const nubY = plusUp ? CELL_TOP - 0.34 : CELL_BOT - 0.02;
  const negY = plusUp ? CELL_BOT - 0.22 : CELL_TOP;
  const rot = plusUp ? -90 : 90;
  const textCy = (CELL_TOP + CELL_BOT) / 2 + (plusUp ? 0.6 : -0.6);
  return (
    <g>
      <rect x={cx - 0.42} y={nubY} width={0.84} height={0.38} rx={0.1} fill={url(`${uid}-metal`)} />
      <rect x={x} y={CELL_TOP} width={CELL_W} height={len} rx={0.3} fill={url(`${uid}-wrap`)} />
      <rect x={x} y={bandY} width={CELL_W} height={band} rx={0.3} fill={url(`${uid}-metal`)} />
      <rect x={x} y={plusUp ? CELL_TOP + band - 0.12 : CELL_BOT - band} width={CELL_W} height={0.12} fill="#e9edf0" opacity={0.7} />
      <rect x={x} y={negY} width={CELL_W} height={0.22} rx={0.1} fill={url(`${uid}-metal`)} />
      {!thumbnail && (
        <g transform={`translate(${cx} ${textCy}) rotate(${rot})`} fontFamily={SANS} textAnchor="middle" fill="#ffffff">
          <text x={0} y={0.24} fontSize={0.72} fontWeight={800} letterSpacing={0.04}>
            AA
          </text>
          <text x={2.3} y={0.18} fontSize={0.42} fontWeight={600} opacity={0.85}>
            1,5V
          </text>
          <text x={-2.75} y={0.24} fontSize={0.7} fontWeight={800} opacity={0.9}>
            −
          </text>
        </g>
      )}
      {!thumbnail && (
        <text x={cx} y={plusUp ? plusEnd + band * 0.62 : plusEnd - band * 0.38} fontSize={0.7} fontWeight={800} fontFamily={SANS} textAnchor="middle" fill="#3c444c">
          +
        </text>
      )}
    </g>
  );
}

function BatteryAA4Impl({ part, def, selected, thumbnail }: PartRenderProps) {
  const uid = useSvgId(part.id);
  const minus = pinPoint(def.pins, 'minus', { x: 5, y: 14 });
  const plus = pinPoint(def.pins, 'plus', { x: 7, y: 14 });
  const h = HOLDER;
  const c = CAVITY;
  const exitY = h.y + h.h - 0.12;
  const springs = CELL_X.map((x, i) => {
    const cx = x + CELL_W / 2;
    return i % 2 === 0 ? springPath(cx, CELL_BOT + 0.05, c.y + c.h - 0.08) : springPath(cx, c.y + 0.08, CELL_TOP - 0.05);
  }).join('');
  return (
    <g>
      <defs>
        <SoftShadow uid={uid} />
        <linearGradient id={`${uid}-holder`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f3237" />
          <stop offset="1" stopColor="#141518" />
        </linearGradient>
        <linearGradient id={`${uid}-wrap`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0d2238" />
          <stop offset="0.28" stopColor="#245d93" />
          <stop offset="0.42" stopColor="#5fa3dc" />
          <stop offset="0.58" stopColor="#2a68a1" />
          <stop offset="1" stopColor="#0b1d30" />
        </linearGradient>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#5c656d" />
          <stop offset="0.3" stopColor="#c9d0d6" />
          <stop offset="0.44" stopColor="#f8fafb" />
          <stop offset="0.66" stopColor="#b0b8c0" />
          <stop offset="1" stopColor="#525a62" />
        </linearGradient>
      </defs>

      {selected && <SelectionHalo rect={{ x: h.x, y: h.y, w: h.w, h: h.h, r: 0.55 }} />}
      <rect x={h.x} y={h.y} width={h.w} height={h.h} rx={0.55} fill={url(`${uid}-holder`)} filter={url(`${uid}-shL`)} />
      <rect x={h.x + 0.05} y={h.y + 0.05} width={h.w - 0.1} height={h.h - 0.1} rx={0.5} fill="none" stroke="#ffffff" strokeOpacity={0.1} strokeWidth={0.06} />
      <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={0.3} fill="#0b0c0e" stroke="#000" strokeWidth={0.05} />
      {/* contacts: plates at + ends, springs at − ends */}
      <path d={springs} fill="none" stroke="#c3cad0" strokeWidth={0.09} strokeLinejoin="round" />
      {CELL_X.map((x, i) => (
        <rect key={x} x={x + 0.55} y={i % 2 === 0 ? c.y + 0.06 : c.y + c.h - 0.24} width={CELL_W - 1.1} height={0.18} fill="#aeb6bd" />
      ))}
      {CELL_X.map((x, i) => (
        <Cell key={x} uid={uid} x={x} plusUp={i % 2 === 0} thumbnail={thumbnail} />
      ))}

      {!thumbnail && (
        <g fontFamily={SANS} fontWeight={800} textAnchor="middle" fill="#7d838c">
          <text x={6} y={11.98} fontSize={0.5} letterSpacing={0.04}>
            6V
          </text>
          <text x={3.6} y={12.02} fontSize={0.62}>
            −
          </text>
          <text x={8.4} y={12.02} fontSize={0.62}>
            +
          </text>
        </g>
      )}
      {[4.5, 7.5].map((x) => (
        <rect key={x} x={x - 0.3} y={exitY - 0.3} width={0.6} height={0.42} rx={0.15} fill="#0e0f11" />
      ))}

      <LeadWire d={leadPath(4.5, exitY, minus.x, minus.y, TIP)} tip={{ x: minus.x, y0: minus.y - TIP, y1: minus.y }} color={BLACK} thumbnail={thumbnail} />
      <LeadWire d={leadPath(7.5, exitY, plus.x, plus.y, TIP)} tip={{ x: plus.x, y0: plus.y - TIP, y1: plus.y }} color={RED} thumbnail={thumbnail} />

    </g>
  );
}

export const BatteryAA4 = memo(BatteryAA4Impl);
