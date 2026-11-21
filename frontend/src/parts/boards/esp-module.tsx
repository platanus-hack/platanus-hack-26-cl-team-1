/**
 * ESP32-C6-WROOM-1 module: castellated substrate, brushed-metal RF shield and
 * the PCB antenna (meander trace) at the right end.
 */
import { meanderPath, rectsPath, type Rect } from './layout';
import { MONO, SANS, url } from './svg';

export const MODULE = { x: 11.6, y: 2.6, w: 10.4, h: 5.8 };
const SHIELD = { x: 11.85, y: 2.85, w: 7.45, h: 5.3 };
const ANT_X = SHIELD.x + SHIELD.w + 0.2;

/** Deterministic pseudo data-matrix (8×8) as one path. */
function matrixPath(x: number, y: number, cell: number): string {
  const bits = [0xff, 0x81, 0xb5, 0xa3, 0xcd, 0x99, 0xe7, 0xff];
  const rects: Rect[] = [];
  bits.forEach((row, r) => {
    for (let c = 0; c < 8; c++) if (row & (1 << (7 - c))) rects.push({ x: x + c * cell, y: y + r * cell, w: cell, h: cell });
  });
  return rectsPath(rects);
}

const PADS: string = (() => {
  const rects: Rect[] = [];
  for (let px = MODULE.x + 0.45; px <= ANT_X - 0.4; px += 0.5) {
    rects.push({ x: px - 0.12, y: MODULE.y - 0.12, w: 0.24, h: 0.34 }, { x: px - 0.12, y: MODULE.y + MODULE.h - 0.22, w: 0.24, h: 0.34 });
  }
  for (let py = MODULE.y + 0.7; py <= MODULE.y + MODULE.h - 0.6; py += 0.55) rects.push({ x: MODULE.x - 0.12, y: py - 0.12, w: 0.34, h: 0.24 });
  return rectsPath(rects);
})();

const BRUSH: { light: string; dark: string } = (() => {
  let light = '';
  let dark = '';
  let i = 0;
  for (let yy = SHIELD.y + 0.18; yy < SHIELD.y + SHIELD.h - 0.1; yy += 0.13, i++) {
    const seg = `M${SHIELD.x + 0.12} ${yy.toFixed(3)}H${(SHIELD.x + SHIELD.w - 0.12).toFixed(3)}`;
    if (i % 3 === 1) dark += seg;
    else if (i % 2 === 0) light += seg;
  }
  return { light, dark };
})();

const ANTENNA = meanderPath(ANT_X + 0.35, MODULE.x + MODULE.w - 0.4, MODULE.y + 0.55, MODULE.y + MODULE.h - 1.3, 0.36);
const MATRIX = matrixPath(SHIELD.x + 0.45, SHIELD.y + 2.75, 0.17);

export function EspModule({ uid, thumbnail }: { uid: string; thumbnail?: boolean }) {
  const m = MODULE;
  const s = SHIELD;
  return (
    <g>
      <defs>
        <linearGradient id={`${uid}-sub`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#24303f" />
          <stop offset="1" stopColor="#141b25" />
        </linearGradient>
        <linearGradient id={`${uid}-shield`} x1="0" y1="0" x2="1" y2="0.18">
          <stop offset="0" stopColor="#dfe4e8" />
          <stop offset="0.18" stopColor="#c6cdd3" />
          <stop offset="0.36" stopColor="#eef1f3" />
          <stop offset="0.55" stopColor="#bfc7ce" />
          <stop offset="0.74" stopColor="#e3e7ea" />
          <stop offset="0.9" stopColor="#b5bec6" />
          <stop offset="1" stopColor="#d6dce1" />
        </linearGradient>
      </defs>
      <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={0.14} fill={url(`${uid}-sub`)} filter={url(`${uid}-sh`)} />
      <path d={PADS} fill="#d3a843" />
      {/* antenna */}
      <path d={ANTENNA} fill="none" stroke="#c99d3f" strokeOpacity={0.8} strokeWidth={0.13} strokeLinejoin="round" />
      <path d={`M${ANT_X + 0.35} ${m.y + m.h - 1.3}V${m.y + m.h - 0.5}`} stroke="#c99d3f" strokeOpacity={0.8} strokeWidth={0.13} />
      {/* shield */}
      <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={0.12} fill={url(`${uid}-shield`)} stroke="#8a949c" strokeWidth={0.06} filter={url(`${uid}-sh`)} />
      {!thumbnail && (
        <g>
          <path d={BRUSH.light} stroke="#ffffff" strokeOpacity={0.22} strokeWidth={0.05} />
          <path d={BRUSH.dark} stroke="#5e6870" strokeOpacity={0.12} strokeWidth={0.04} />
        </g>
      )}
      <rect x={s.x + 0.1} y={s.y + 0.1} width={s.w - 0.2} height={s.h - 0.2} rx={0.08} fill="none" stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.05} />
      {!thumbnail && (
        <g>
          <text x={s.x + s.w / 2} y={s.y + 1.75} fontSize={0.6} fontFamily={SANS} fontWeight={800} fill="#4e5760" textAnchor="middle" letterSpacing={0.02}>
            ESP32-C6-WROOM-1
          </text>
          <path d={MATRIX} fill="#58616a" opacity={0.9} />
          <text x={s.x + 2.3} y={s.y + 3.15} fontSize={0.42} fontFamily={MONO} fontWeight={700} fill="#5c656e">
            N8
          </text>
          <text x={s.x + 2.3} y={s.y + 3.75} fontSize={0.3} fontFamily={MONO} fontWeight={600} fill="#69727a">
            Wi-Fi 6 · BLE 5 · 802.15.4
          </text>
          <text x={s.x + 2.3} y={s.y + 4.25} fontSize={0.3} fontFamily={MONO} fontWeight={600} fill="#69727a">
            RISC-V 160 MHz
          </text>
        </g>
      )}
    </g>
  );
}
