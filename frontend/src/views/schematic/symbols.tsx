/**
 * Hand-drawn SVG schematic symbols. Every symbol draws in its node's local
 * frame (0,0)–(w,h); leads end exactly on the PortGeom positions from
 * geometry.ts. Live state (glow, switch position, motor spin…) comes in
 * `live`.
 */
import type { ReactNode } from 'react';
import { LABEL_H, MCU_HEADER, MCU_STUB } from './geometry';
import type { SNode } from './graph';
import type { LaidOutNode } from './layout';

export interface NodeLive {
  brightness?: number;
  ledColor?: string;
  rgb?: [number, number, number];
  burned?: boolean;
  reversed?: boolean;
  overloaded?: boolean;
  pressed?: boolean;
  position?: number | string;
  light?: number;
  speed?: number;
  sounding?: boolean;
  angle?: number;
  region?: string;
  /** Port id → colour of its net (MCU pin dots). */
  portColors?: Record<string, string>;
}

export const LED_COLORS: Record<string, string> = {
  red: '#ff4d5e',
  green: '#3ee07a',
  yellow: '#ffd23f',
  blue: '#4c9dff',
  white: '#f2f6ff',
};

const RGB_TINT = ['#ff4d5e', '#3ee07a', '#4c9dff'];

/** Finite number or the fallback (odd props / NaN sim values never reach SVG attributes). */
const fin = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function Arrow({ x1, y1, x2, y2, className = 'sch-line', color }: { x1: number; y1: number; x2: number; y2: number; className?: string; color?: string }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const s = 4.2;
  const p1 = `${x2 - s * Math.cos(a - 0.45)},${y2 - s * Math.sin(a - 0.45)}`;
  const p2 = `${x2 - s * Math.cos(a + 0.45)},${y2 - s * Math.sin(a + 0.45)}`;
  return (
    <g className={className} style={color ? { stroke: color } : undefined}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <polyline points={`${p1} ${x2},${y2} ${p2}`} />
    </g>
  );
}

function zigzag(x0: number, x1: number, cy: number, amp = 6, peaks = 6): string {
  const step = (x1 - x0) / peaks;
  const pts = [`${x0},${cy}`];
  for (let i = 0; i < peaks; i++) pts.push(`${x0 + step * (i + 0.5)},${cy + (i % 2 === 0 ? -amp : amp)}`);
  pts.push(`${x1},${cy}`);
  return pts.join(' ');
}

function Label({ node }: { node: SNode }) {
  if (node.labelPos === 'right') {
    return (
      <g>
        <text className="sch-label" x={62} y={34}>
          {node.label}
        </text>
        {node.value && (
          <text className="sch-value" x={62} y={49}>
            {node.value}
          </text>
        )}
      </g>
    );
  }
  return (
    <text className="sch-label" x={node.w / 2} y={12} textAnchor="middle">
      {node.label}
      {node.value && (
        <tspan className="sch-value" dx={6}>
          {node.value}
        </tspan>
      )}
    </text>
  );
}

/** Body drawings keyed by symbol (local frame, unflipped). */
function Body({ node, live }: { node: SNode; live: NodeLive }): ReactNode {
  const { w, h } = node;
  const cx = w / 2;
  switch (node.symbol) {
    case 'resistor': {
      const cy = LABEL_H + 14;
      return (
        <g className="sch-line">
          <line x1={0} y1={cy} x2={cx - 20} y2={cy} />
          <polyline points={zigzag(cx - 20, cx + 20, cy)} />
          <line x1={cx + 20} y1={cy} x2={w} y2={cy} />
        </g>
      );
    }
    case 'ldr': {
      const cy = LABEL_H + 22;
      const light = clamp(fin(live.light, 60), 0, 100) / 100;
      const glow = `rgba(255, 210, 122, ${0.35 + 0.65 * light})`;
      return (
        <g>
          <g className="sch-line">
            <line x1={0} y1={cy} x2={cx - 18} y2={cy} />
            <rect x={cx - 18} y={cy - 6} width={36} height={12} rx={2} className="sch-fill" />
            <line x1={cx + 18} y1={cy} x2={w} y2={cy} />
          </g>
          <Arrow x1={cx - 16} y1={cy - 21} x2={cx - 7} y2={cy - 10} color={glow} />
          <Arrow x1={cx - 6} y1={cy - 21} x2={cx + 3} y2={cy - 10} color={glow} />
        </g>
      );
    }
    case 'potentiometer': {
      const cy = LABEL_H + 14;
      const pos = clamp(fin(live.position, 50), 0, 100);
      const tipX = cx - 20 + (40 * pos) / 100;
      return (
        <g>
          <g className="sch-line">
            <line x1={0} y1={cy} x2={cx - 20} y2={cy} />
            <polyline points={zigzag(cx - 20, cx + 20, cy)} />
            <line x1={cx + 20} y1={cy} x2={w} y2={cy} />
            <polyline points={`${cx},${h} ${cx},${cy + 20} ${tipX},${cy + 20}`} />
          </g>
          <Arrow x1={tipX} y1={cy + 20} x2={tipX} y2={cy + 8} className="sch-line sch-accent-stroke" />
        </g>
      );
    }
    case 'led': {
      const cy = LABEL_H + 22;
      const color = live.ledColor ?? LED_COLORS.red;
      const b = live.burned ? 0 : clamp(fin(live.brightness, 0), 0, 1);
      return (
        <g>
          {b > 0.02 && <circle cx={cx - 1} cy={cy} r={20} fill={color} opacity={0.18 + 0.5 * b} filter="url(#sch-glow)" />}
          <g className="sch-line">
            <line x1={0} y1={cy} x2={cx - 9} y2={cy} />
            <polygon
              points={`${cx - 9},${cy - 9} ${cx - 9},${cy + 9} ${cx + 7},${cy}`}
              style={{ fill: live.burned ? '#2a2f36' : color, fillOpacity: live.burned ? 1 : 0.14 + 0.86 * b }}
            />
            <line x1={cx + 7} y1={cy - 9} x2={cx + 7} y2={cy + 9} />
            <line x1={cx + 7} y1={cy} x2={w} y2={cy} />
          </g>
          <Arrow x1={cx - 2} y1={cy - 11} x2={cx + 5} y2={cy - 19} color={b > 0.02 ? color : undefined} />
          <Arrow x1={cx + 4} y1={cy - 9} x2={cx + 11} y2={cy - 17} color={b > 0.02 ? color : undefined} />
          {live.burned && (
            <g className="sch-danger-stroke">
              <line x1={cx - 6} y1={cy - 6} x2={cx + 4} y2={cy + 6} />
              <line x1={cx + 4} y1={cy - 6} x2={cx - 6} y2={cy + 6} />
            </g>
          )}
        </g>
      );
    }
    case 'diode': {
      const cy = LABEL_H + 14;
      return (
        <g className="sch-line">
          <line x1={0} y1={cy} x2={cx - 9} y2={cy} />
          <polygon points={`${cx - 9},${cy - 9} ${cx - 9},${cy + 9} ${cx + 7},${cy}`} className="sch-fill" />
          <line x1={cx + 7} y1={cy - 9} x2={cx + 7} y2={cy + 9} />
          <line x1={cx + 7} y1={cy} x2={w} y2={cy} />
        </g>
      );
    }
    case 'rgb-led': {
      const ys = [LABEL_H + 14, LABEL_H + 34, LABEL_H + 54];
      const bus = w - 22;
      const dx = cx - 8;
      return (
        <g>
          {ys.map((y, i) => {
            const v = live.burned ? 0 : clamp(fin(live.rgb?.[i], 0), 0, 1);
            return v > 0.02 ? <circle key={`g${i}`} cx={dx} cy={y} r={13} fill={RGB_TINT[i]} opacity={0.15 + 0.5 * v} filter="url(#sch-glow)" /> : null;
          })}
          <g className="sch-line">
            {ys.map((y, i) => {
              const v = live.burned ? 0 : clamp(fin(live.rgb?.[i], 0), 0, 1);
              return (
                <g key={i}>
                  <line x1={0} y1={y} x2={dx - 6} y2={y} />
                  <polygon points={`${dx - 6},${y - 6} ${dx - 6},${y + 6} ${dx + 5},${y}`} style={{ fill: RGB_TINT[i], fillOpacity: 0.16 + 0.84 * v }} />
                  <line x1={dx + 5} y1={y - 6} x2={dx + 5} y2={y + 6} />
                  <line x1={dx + 5} y1={y} x2={bus} y2={y} />
                </g>
              );
            })}
            <line x1={bus} y1={ys[0]} x2={bus} y2={ys[2]} />
            <line x1={bus} y1={ys[1]} x2={w} y2={ys[1]} />
          </g>
          <circle cx={bus} cy={ys[1]} r={2.4} className="sch-dot" />
          {['R', 'G', 'B'].map((t, i) => (
            <text key={t} className="sch-pin" x={8} y={ys[i] - 4} style={{ fill: RGB_TINT[i] }}>
              {t}
            </text>
          ))}
        </g>
      );
    }
    case 'battery': {
      const cy = LABEL_H + 18;
      return (
        <g>
          <g className="sch-line">
            <line x1={0} y1={cy} x2={cx - 10} y2={cy} />
            <line x1={cx - 10} y1={cy - 6} x2={cx - 10} y2={cy + 6} className="sch-thick" />
            <line x1={cx - 4} y1={cy - 12} x2={cx - 4} y2={cy + 12} />
            <line x1={cx + 4} y1={cy - 6} x2={cx + 4} y2={cy + 6} className="sch-thick" />
            <line x1={cx + 10} y1={cy - 12} x2={cx + 10} y2={cy + 12} />
            <line x1={cx + 10} y1={cy} x2={w} y2={cy} />
          </g>
          <text className="sch-pin sch-plus" x={cx + 15} y={cy - 8}>
            +
          </text>
          <text className="sch-pin" x={cx - 21} y={cy - 8}>
            −
          </text>
        </g>
      );
    }
    case 'push-button': {
      const cy = LABEL_H + 24;
      const pressed = !!live.pressed;
      const by = pressed ? cy - 3 : cy - 9;
      return (
        <g>
          <g className="sch-line">
            <line x1={0} y1={cy} x2={cx - 16} y2={cy} />
            <line x1={cx + 16} y1={cy} x2={w} y2={cy} />
          </g>
          <g className={pressed ? 'sch-line sch-accent-stroke' : 'sch-line'}>
            <line x1={cx - 18} y1={by} x2={cx + 18} y2={by} />
            <line x1={cx} y1={by} x2={cx} y2={by - 8} />
            <line x1={cx - 6} y1={by - 8} x2={cx + 6} y2={by - 8} />
          </g>
          <circle cx={cx - 16} cy={cy} r={2.4} className="sch-dot" />
          <circle cx={cx + 16} cy={cy} r={2.4} className="sch-dot" />
        </g>
      );
    }
    case 'slide-switch': {
      const yc = LABEL_H + 23, ya = LABEL_H + 10, yb = LABEL_H + 36;
      const toB = live.position === 'b';
      const ty = toB ? yb : ya;
      return (
        <g>
          <g className="sch-line">
            <line x1={0} y1={yc} x2={cx - 14} y2={yc} />
            <line x1={cx + 14} y1={ya} x2={w} y2={ya} />
            <line x1={cx + 14} y1={yb} x2={w} y2={yb} />
          </g>
          <line className="sch-line sch-accent-stroke" x1={cx - 14} y1={yc} x2={cx + 12} y2={ty + (toB ? -1.5 : 1.5)} />
          <circle cx={cx - 14} cy={yc} r={2.4} className="sch-dot" />
          <circle cx={cx + 14} cy={ya} r={2.4} className="sch-dot" />
          <circle cx={cx + 14} cy={yb} r={2.4} className="sch-dot" />
          <text className="sch-pin" x={w - 10} y={ya - 4}>
            A
          </text>
          <text className="sch-pin" x={w - 10} y={yb - 4}>
            B
          </text>
        </g>
      );
    }
    case 'buzzer': {
      const cy = LABEL_H + 30;
      return (
        <g>
          <g className="sch-line">
            <polyline points={`0,${cy} ${cx - 8},${cy} ${cx - 8},${cy - 5}`} />
            <polyline points={`${cx + 8},${cy - 5} ${cx + 8},${cy} ${w},${cy}`} />
            <path d={`M ${cx - 15} ${cy - 5} A 15 15 0 0 1 ${cx + 15} ${cy - 5} Z`} className="sch-fill" />
          </g>
          <text className="sch-pin sch-plus" x={cx - 20} y={cy - 8}>
            +
          </text>
          {live.sounding && (
            <g className="sch-waves">
              <path d={`M ${cx + 18} ${cy - 22} q 5 6 0 12`} />
              <path d={`M ${cx + 23} ${cy - 26} q 8 10 0 20`} />
            </g>
          )}
        </g>
      );
    }
    case 'motor': {
      const cy = LABEL_H + 23;
      const spin = Math.min(1, Math.abs(fin(live.speed, 0)));
      return (
        <g>
          <g className="sch-line">
            <line x1={0} y1={cy} x2={cx - 15} y2={cy} />
            <line x1={cx + 15} y1={cy} x2={w} y2={cy} />
            <circle cx={cx} cy={cy} r={15} className="sch-fill" />
          </g>
          {spin > 0.03 && (
            <circle
              cx={cx}
              cy={cy}
              r={19}
              className="sch-spin"
              style={{ animationDuration: `${Math.max(0.25, 1.6 - spin * 1.3)}s`, animationDirection: (live.speed ?? 0) < 0 ? 'reverse' : 'normal', transformOrigin: `${cx}px ${cy}px` }}
            />
          )}
          <text className="sch-motor" x={cx} y={cy + 4.5} textAnchor="middle">
            M
          </text>
        </g>
      );
    }
    case 'npn': {
      return (
        <g>
          <circle cx={38} cy={38} r={21} className="sch-line sch-fill" />
          <g className="sch-line">
            <line x1={0} y1={38} x2={25} y2={38} />
            <line x1={25} y1={26} x2={25} y2={50} className="sch-thick" />
            <polyline points="25,32 38,22 38,0" />
            <polyline points="25,44 38,54 38,76" />
          </g>
          <Arrow x1={27} y1={45.5} x2={36.5} y2={53} />
        </g>
      );
    }
    case 'servo': {
      const ys = [LABEL_H + 14, LABEL_H + 30, LABEL_H + 46];
      const bx = 26, bw = w - 32, by = LABEL_H + 3, bh = h - LABEL_H - 7;
      const angle = clamp(fin(live.angle, 90), 0, 180);
      const gx = bx + bw - 24, gy = by + bh - 12;
      // Same convention as the breadboard drawing (ServoSg90): 0° → right, 90° → up, 180° → left.
      const rad = (angle * Math.PI) / 180;
      return (
        <g>
          <g className="sch-line">
            {ys.map((y) => (
              <line key={y} x1={0} y1={y} x2={bx} y2={y} />
            ))}
            <rect x={bx} y={by} width={bw} height={bh} rx={6} className="sch-fill" />
            <path d={`M ${gx - 13} ${gy} A 13 13 0 0 1 ${gx + 13} ${gy}`} className="sch-faint" />
          </g>
          <line className="sch-line sch-accent-stroke" x1={gx} y1={gy} x2={gx + 12 * Math.cos(rad)} y2={gy - 12 * Math.sin(rad)} />
          <circle cx={gx} cy={gy} r={2.2} className="sch-dot" />
          {['señal', 'V+', 'GND'].map((t, i) => (
            <text key={t} className="sch-pin" x={bx + 5} y={ys[i] + 3}>
              {t}
            </text>
          ))}
          <text className="sch-pin sch-muted" x={gx} y={by + 12} textAnchor="middle">
            {Number.isFinite(live.angle) ? `${Math.round(angle)}°` : 'SERVO'}
          </text>
        </g>
      );
    }
    default:
      return <rect x={0} y={LABEL_H} width={w} height={h - LABEL_H} rx={6} className="sch-line sch-fill" />;
  }
}

function McuBody({ node, layout, live }: { node: SNode; layout: LaidOutNode; live: NodeLive }) {
  const bw = node.w - MCU_STUB;
  return (
    <g>
      <rect x={-6} y={22} width={8} height={20} rx={2} className="sch-usb" />
      <rect x={0} y={0} width={bw} height={node.h} rx={10} className="sch-mcu" />
      <text className="sch-mcu-title" x={14} y={20}>
        {node.boardName ?? node.label}
      </text>
      <text className="sch-value" x={14} y={34}>
        {node.boardSub ?? node.label}
      </text>
      <line x1={10} x2={bw - 10} y1={MCU_HEADER - 2} y2={MCU_HEADER - 2} className="sch-mcu-sep" />
      {node.ports.map((p) => {
        const pos = layout.ports[p.id];
        if (!pos) return null;
        const color = live.portColors?.[p.id];
        return (
          <g key={p.id}>
            <line x1={bw} y1={pos.y} x2={node.w} y2={pos.y} className="sch-line" />
            <rect x={bw - 3} y={pos.y - 3} width={6} height={6} rx={1.5} className="sch-mcu-pin" style={color ? { fill: color } : undefined} />
            <text className="sch-mcu-pinlabel" x={bw - 9} y={pos.y + 3.5} textAnchor="end">
              {p.label}
            </text>
          </g>
        );
      })}
      {node.ports.length === 0 && (
        <text className="sch-value" x={14} y={MCU_HEADER + 20}>
          Sin pines conectados
        </text>
      )}
    </g>
  );
}

export function SchematicSymbol({ node, layout, live }: { node: SNode; layout: LaidOutNode; live: NodeLive }) {
  if (node.symbol === 'mcu') return <McuBody node={node} layout={layout} live={live} />;
  const connected = new Set(node.ports.map((p) => p.pin));
  const groups = new Set(node.ports.flatMap((p) => p.pins));
  const open = Object.entries(node.terminals).filter(([pin]) => !connected.has(pin) && !groups.has(pin));
  const seen = new Set<string>();
  return (
    <g>
      <Label node={node} />
      {node.flipped ? (
        <g transform={`translate(${node.w} 0) scale(-1 1)`}>
          <Body node={node} live={live} />
        </g>
      ) : (
        <Body node={node} live={live} />
      )}
      {open.map(([pin, g]) => {
        const k = `${g.x},${g.y}`;
        if (seen.has(k)) return null;
        seen.add(k);
        return <circle key={pin} cx={g.x} cy={g.y} r={2.6} className="sch-open" />;
      })}
    </g>
  );
}
