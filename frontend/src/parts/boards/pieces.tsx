/**
 * Small hardware pieces shared by the board renderers (top view, grid units).
 * Gradients come from <PieceDefs uid> mounted once per board instance.
 */
import { rectsPath, squaresPath, type Pt, type Rect } from './layout';
import { MONO, SoftShadow, url } from './svg';

/** Thin lighter rim so black packages still read on a black PCB. */
const IC_RIM = '#4a4e55';

export function PieceDefs({ uid }: { uid: string }) {
  return (
    <>
      <SoftShadow uid={uid} />
      <linearGradient id={`${uid}-steel`} x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0" stopColor="#f6f8fa" />
        <stop offset="0.38" stopColor="#d3d9df" />
        <stop offset="0.72" stopColor="#a5aeb7" />
        <stop offset="1" stopColor="#dfe3e7" />
      </linearGradient>
      <linearGradient id={`${uid}-plastic`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#34363b" />
        <stop offset="0.45" stopColor="#1a1b1e" />
        <stop offset="1" stopColor="#0c0d0f" />
      </linearGradient>
      <linearGradient id={`${uid}-ic`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#2c2e33" />
        <stop offset="1" stopColor="#141518" />
      </linearGradient>
      <linearGradient id={`${uid}-gold`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff4bf" />
        <stop offset="0.45" stopColor="#e5bb4c" />
        <stop offset="1" stopColor="#9c7414" />
      </linearGradient>
      <radialGradient id={`${uid}-can`} cx="0.42" cy="0.38" r="0.65">
        <stop offset="0" stopColor="#fbfcfd" />
        <stop offset="0.7" stopColor="#c3cad1" />
        <stop offset="1" stopColor="#8a949d" />
      </radialGradient>
    </>
  );
}

interface BoxProps {
  uid: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** USB-B receptacle, opening on the LEFT edge (x). */
export function UsbB({ uid, x, y, w, h }: BoxProps) {
  return (
    <g>
      <rect x={x + w - 0.1} y={y + 0.5} width={0.45} height={0.5} fill="#b9c0c7" />
      <rect x={x + w - 0.1} y={y + h - 1} width={0.45} height={0.5} fill="#b9c0c7" />
      <rect x={x} y={y} width={w} height={h} rx={0.14} fill={url(`${uid}-steel`)} filter={url(`${uid}-sh`)} />
      <rect x={x} y={y} width={0.42} height={h} rx={0.12} fill="#8b949d" />
      <rect x={x + 0.42} y={y} width={0.08} height={h} fill="#ffffff" opacity={0.55} />
      <rect x={x + 0.95} y={y + 0.4} width={w - 1.5} height={h - 0.8} rx={0.12} fill="none" stroke="#7d8790" strokeOpacity={0.55} strokeWidth={0.07} />
      <rect x={x + 1.0} y={y + 0.45} width={w - 1.6} height={h - 0.9} rx={0.1} fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.05} />
      <path d={`M${x + 2.1} ${y + 0.4}V${y + h - 0.4}`} stroke="#6f7983" strokeOpacity={0.35} strokeWidth={0.06} />
      {[y + 1.05, y + h - 1.05].map((cy) => (
        <g key={cy}>
          <circle cx={x + w - 1.25} cy={cy} r={0.22} fill="#8e979f" />
          <circle cx={x + w - 1.29} cy={cy - 0.05} r={0.12} fill="#e9edf0" />
        </g>
      ))}
    </g>
  );
}

/** USB-C receptacle (mid-mount), opening on the LEFT edge (x). */
export function UsbC({ uid, x, y, w, h }: BoxProps) {
  return (
    <g>
      <rect x={x + w - 0.15} y={y + 0.15} width={0.42} height={0.38} fill="#b9c0c7" />
      <rect x={x + w - 0.15} y={y + h - 0.53} width={0.42} height={0.38} fill="#b9c0c7" />
      <rect x={x} y={y} width={w} height={h} rx={0.4} fill={url(`${uid}-steel`)} filter={url(`${uid}-sh`)} />
      <rect x={x} y={y + 0.12} width={0.34} height={h - 0.24} rx={0.17} fill="#79838c" />
      <rect x={x + 0.09} y={y + 0.4} width={0.16} height={h - 0.8} rx={0.08} fill="#1d2126" />
      <path d={`M${x + 0.7} ${y + h / 2}H${x + w - 0.35}`} stroke="#7a848d" strokeOpacity={0.5} strokeWidth={0.05} />
      <path d={`M${x + 0.7} ${y + h / 2 + 0.06}H${x + w - 0.35}`} stroke="#ffffff" strokeOpacity={0.55} strokeWidth={0.04} />
    </g>
  );
}

/** Black DC barrel jack, plug side on the LEFT edge (x). */
export function BarrelJack({ uid, x, y, w, h }: BoxProps) {
  const ribs = [0.28, 0.5, 0.72].map((t) => `M${x + 1.5} ${y + h * t}H${x + w - 0.4}`).join('');
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={0.2} fill={url(`${uid}-plastic`)} filter={url(`${uid}-sh`)} />
      <rect x={x} y={y + 0.3} width={1.05} height={h - 0.6} rx={0.12} fill="#26282c" stroke="#3a3d42" strokeWidth={0.05} />
      <rect x={x + 1.3} y={y + 0.3} width={w - 1.55} height={h - 0.6} rx={0.14} fill="#202226" stroke="#33363b" strokeWidth={0.04} />
      <path d={ribs} stroke="#3c3f45" strokeWidth={0.08} />
      <path d={`M${x + 0.25} ${y + 0.06}H${x + w - 0.25}`} stroke="#ffffff" strokeOpacity={0.18} strokeWidth={0.06} />
    </g>
  );
}

interface DipProps {
  uid: string;
  /** x of the first pin column (left). */
  x0: number;
  perRow: number;
  rowTop: number;
  rowBottom: number;
  label: string;
  /** Notch (pin 1 end) on the right side. */
  notchRight?: boolean;
  thumbnail?: boolean;
}

/** DIP package in a turned-pin socket. */
export function Dip({ uid, x0, perRow, rowTop, rowBottom, label, notchRight, thumbnail }: DipProps) {
  const x1 = x0 + perRow - 1;
  const legs: Rect[] = [];
  for (let i = 0; i < perRow; i++) {
    legs.push({ x: x0 + i - 0.2, y: rowTop - 0.18, w: 0.4, h: 0.5 }, { x: x0 + i - 0.2, y: rowBottom - 0.32, w: 0.4, h: 0.5 });
  }
  const bx = x0 - 0.62;
  const bw = x1 - x0 + 1.24;
  const by = rowTop + 0.28;
  const bh = rowBottom - rowTop - 0.56;
  const cy = by + bh / 2;
  const notchX = notchRight ? bx + bw : bx;
  const pin1X = notchRight ? x1 - 0.1 : x0 + 0.1;
  return (
    <g>
      <rect x={bx - 0.3} y={rowTop - 0.5} width={bw + 0.6} height={rowBottom - rowTop + 1} rx={0.12} fill="#232427" stroke="#2f3135" strokeWidth={0.05} />
      <path d={rectsPath(legs, 0.05)} fill="#c5cbd1" stroke="#80888f" strokeWidth={0.03} />
      <rect x={bx} y={by} width={bw} height={bh} rx={0.14} fill={url(`${uid}-ic`)} stroke={IC_RIM} strokeWidth={0.04} filter={url(`${uid}-sh`)} />
      <path d={`M${bx + 0.15} ${by + 0.06}H${bx + bw - 0.15}`} stroke="#ffffff" strokeOpacity={0.12} strokeWidth={0.06} />
      <path d={`M${notchX} ${cy - 0.42}a0.42 0.42 0 0 ${notchRight ? 0 : 1} 0 0.84z`} fill="#0a0b0c" />
      <circle cx={pin1X} cy={by + 0.45} r={0.2} fill="#111214" stroke="#34363b" strokeWidth={0.03} />
      {!thumbnail && (
        <text x={bx + bw / 2} y={cy + 0.2} fontSize={0.56} fontFamily={MONO} fontWeight={600} fill="#8f959c" textAnchor="middle" letterSpacing={0.04}>
          {label}
        </text>
      )}
    </g>
  );
}

/** HC-49/S crystal (stadium-shaped metal can). */
export function Crystal({ uid, cx, cy, w, h, text, thumbnail }: { uid: string; cx: number; cy: number; w: number; h: number; text: string; thumbnail?: boolean }) {
  return (
    <g>
      <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={h / 2} fill={url(`${uid}-steel`)} filter={url(`${uid}-sh`)} />
      <rect x={cx - w / 2 + 0.16} y={cy - h / 2 + 0.14} width={w - 0.32} height={h - 0.28} rx={(h - 0.28) / 2} fill="none" stroke="#ffffff" strokeOpacity={0.6} strokeWidth={0.05} />
      {!thumbnail && (
        <text x={cx} y={cy + 0.15} fontSize={0.42} fontFamily={MONO} fontWeight={700} fill="#59616a" textAnchor="middle">
          {text}
        </text>
      )}
    </g>
  );
}

/** SMD aluminium electrolytic capacitor (can on a square base, polarity mark). */
export function ElectroCap({ uid, cx, cy, r }: { uid: string; cx: number; cy: number; r: number }) {
  const s = r + 0.18;
  const c = 0.35;
  const base = `M${cx - s + c} ${cy - s}H${cx + s}V${cy + s}H${cx - s + c}L${cx - s} ${cy + s - c}V${cy - s + c}z`;
  return (
    <g>
      <path d={base} fill="#16171a" />
      <circle cx={cx} cy={cy} r={r} fill={url(`${uid}-can`)} filter={url(`${uid}-sh`)} />
      <path d={`M${cx - r * 0.55} ${cy - r * 0.83}A${r} ${r} 0 0 0 ${cx - r * 0.55} ${cy + r * 0.83}z`} fill="#1f2b44" opacity={0.85} />
      <path d={`M${cx - r * 0.2} ${cy}h${r * 0.75}M${cx + r * 0.17} ${cy - r * 0.38}v${r * 0.76}`} stroke="#8a939b" strokeWidth={0.05} />
    </g>
  );
}

/** Tactile push button seen from above. */
export function Tactile({ uid, cx, cy, size, cap = '#25272b' }: { uid: string; cx: number; cy: number; size: number; cap?: string }) {
  const h = size / 2;
  const leg = 0.28;
  const legs: Rect[] = [
    { x: cx - h - leg, y: cy - h + 0.15, w: leg, h: 0.32 },
    { x: cx + h, y: cy - h + 0.15, w: leg, h: 0.32 },
    { x: cx - h - leg, y: cy + h - 0.47, w: leg, h: 0.32 },
    { x: cx + h, y: cy + h - 0.47, w: leg, h: 0.32 },
  ];
  return (
    <g>
      <path d={rectsPath(legs)} fill="#c3c9cf" />
      <rect x={cx - h} y={cy - h} width={size} height={size} rx={0.1} fill={url(`${uid}-steel`)} filter={url(`${uid}-sh`)} />
      <rect x={cx - h * 0.78} y={cy - h * 0.78} width={size * 0.78} height={size * 0.78} rx={0.08} fill="#2a2c30" />
      <circle cx={cx} cy={cy} r={size * 0.27} fill={cap} stroke="#000" strokeOpacity={0.5} strokeWidth={0.04} />
      <circle cx={cx - size * 0.07} cy={cy - size * 0.07} r={size * 0.12} fill="#ffffff" opacity={0.14} />
    </g>
  );
}

/** SOT-223 regulator (metal tab on top). */
export function Sot223({ uid, cx, cy }: { uid: string; cx: number; cy: number }) {
  const legs: Rect[] = [-0.6, 0, 0.6].map((dx) => ({ x: cx + dx - 0.12, y: cy + 0.45, w: 0.24, h: 0.4 }));
  return (
    <g>
      <rect x={cx - 0.62} y={cy - 0.95} width={1.24} height={0.5} fill={url(`${uid}-steel`)} />
      <path d={rectsPath(legs)} fill="#c5cbd1" />
      <rect x={cx - 0.85} y={cy - 0.6} width={1.7} height={1.1} rx={0.06} fill={url(`${uid}-ic`)} stroke={IC_RIM} strokeWidth={0.04} filter={url(`${uid}-sh`)} />
    </g>
  );
}

/** QFN chip with pads on all four sides. */
export function Qfn({ uid, cx, cy, size, label, thumbnail }: { uid: string; cx: number; cy: number; size: number; label?: string; thumbnail?: boolean }) {
  const h = size / 2;
  const pads: Rect[] = [];
  const k = 6;
  for (let i = 0; i < k; i++) {
    const t = -h + size * ((i + 1) / (k + 1));
    pads.push({ x: cx + t - 0.06, y: cy - h - 0.07, w: 0.12, h: 0.16 }, { x: cx + t - 0.06, y: cy + h - 0.09, w: 0.12, h: 0.16 });
    pads.push({ x: cx - h - 0.07, y: cy + t - 0.06, w: 0.16, h: 0.12 }, { x: cx + h - 0.09, y: cy + t - 0.06, w: 0.16, h: 0.12 });
  }
  return (
    <g>
      <path d={rectsPath(pads)} fill="#c5cbd1" />
      <rect x={cx - h} y={cy - h} width={size} height={size} rx={0.08} fill={url(`${uid}-ic`)} stroke={IC_RIM} strokeWidth={0.04} filter={url(`${uid}-sh`)} />
      <circle cx={cx - h + 0.28} cy={cy - h + 0.28} r={0.09} fill="#3a3d42" />
      {label && !thumbnail && (
        <text x={cx} y={cy + 0.12} fontSize={0.32} fontFamily={MONO} fontWeight={600} fill="#80878e" textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

/** SOIC-8 (gull-wing legs on the long sides). */
export function Soic8({ uid, cx, cy }: { uid: string; cx: number; cy: number }) {
  const legs: Rect[] = [];
  for (let i = 0; i < 4; i++) {
    const x = cx - 0.75 + i * 0.5 - 0.1;
    legs.push({ x, y: cy - 0.78, w: 0.2, h: 0.32 }, { x, y: cy + 0.46, w: 0.2, h: 0.32 });
  }
  return (
    <g>
      <path d={rectsPath(legs)} fill="#c5cbd1" />
      <rect x={cx - 1} y={cy - 0.52} width={2} height={1.04} rx={0.06} fill={url(`${uid}-ic`)} stroke={IC_RIM} strokeWidth={0.04} filter={url(`${uid}-sh`)} />
      <circle cx={cx - 0.72} cy={cy + 0.22} r={0.09} fill="#3a3d42" />
    </g>
  );
}

/** Male pin block (e.g. ICSP 2×3): cells start at (x0, y0), pitch 1. */
export function PinBlock({ uid, x0, y0, cols, rows }: { uid: string; x0: number; y0: number; cols: number; rows: number }) {
  const pts: Pt[] = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) pts.push({ x: x0 + c + 0.5, y: y0 + r + 0.5 });
  return (
    <g>
      <rect x={x0} y={y0} width={cols} height={rows} rx={0.1} fill={url(`${uid}-plastic`)} filter={url(`${uid}-sh`)} />
      <GoldPins points={pts} size={0.36} />
    </g>
  );
}

/** Square gold header pins seen from the tip (one base path + one highlight path). */
export function GoldPins({ points, size }: { points: readonly Pt[]; size: number }) {
  const hi = points.map((p) => ({ x: p.x - size * 0.16, y: p.y - size * 0.16 }));
  return (
    <g>
      <path d={squaresPath(points, size, size * 0.12)} fill="#c99a2e" stroke="#6f5110" strokeWidth={0.035} />
      <path d={squaresPath(hi, size * 0.5, size * 0.1)} fill="#fff1b5" opacity={0.85} />
    </g>
  );
}
