/**
 * Schematic symbol geometry (pure): node size and port positions per
 * SchematicSymbol, in schematic pixels. The SVG drawings in symbols.tsx use
 * the same constants so leads end exactly on the ports ELK routes to.
 */
import type { PartDef, SchematicSymbol } from '@/contracts';

export type Side = 'WEST' | 'EAST' | 'NORTH' | 'SOUTH';

export interface PortGeom {
  side: Side;
  x: number; // relative to the node's top-left
  y: number;
}

/** Height of the label band above most symbols. */
export const LABEL_H = 18;
export const MCU_W = 156;
export const MCU_HEADER = 40;
export const MCU_PIN_PITCH = 22;
export const MCU_STUB = 16;

interface Spec {
  baseW: number;
  h: number;
  /** Port of each pin id for a node of width w (before flip). */
  ports: (w: number, h: number) => Record<string, PortGeom>;
  /** Mirrors left/right when the flow runs the other way (non-polar parts). */
  flippable?: boolean;
  labelPos?: 'top' | 'right';
}

const we = (cy: number, west: string, east: string) => (w: number) => ({
  [west]: { side: 'WEST' as const, x: 0, y: cy },
  [east]: { side: 'EAST' as const, x: w, y: cy },
});

const SPECS: Partial<Record<SchematicSymbol, Spec>> = {
  resistor: { baseW: 76, h: LABEL_H + 28, ports: we(LABEL_H + 14, 'a', 'b'), flippable: true },
  ldr: { baseW: 76, h: LABEL_H + 36, ports: we(LABEL_H + 22, 'a', 'b'), flippable: true },
  potentiometer: {
    baseW: 76,
    h: LABEL_H + 46,
    ports: (w, h) => ({
      a: { side: 'WEST', x: 0, y: LABEL_H + 14 },
      b: { side: 'EAST', x: w, y: LABEL_H + 14 },
      wiper: { side: 'SOUTH', x: Math.round(w / 2), y: h },
    }),
    flippable: true,
  },
  led: { baseW: 68, h: LABEL_H + 36, ports: we(LABEL_H + 22, 'anode', 'cathode') },
  diode: { baseW: 68, h: LABEL_H + 28, ports: we(LABEL_H + 14, 'anode', 'cathode') },
  'rgb-led': {
    baseW: 88,
    h: LABEL_H + 68,
    ports: (w) => ({
      r: { side: 'WEST', x: 0, y: LABEL_H + 14 },
      g: { side: 'WEST', x: 0, y: LABEL_H + 34 },
      b: { side: 'WEST', x: 0, y: LABEL_H + 54 },
      com: { side: 'EAST', x: w, y: LABEL_H + 34 },
    }),
  },
  battery: { baseW: 68, h: LABEL_H + 36, ports: we(LABEL_H + 18, 'minus', 'plus') },
  'push-button': {
    baseW: 76,
    h: LABEL_H + 32,
    ports: (w) => ({
      a1: { side: 'WEST', x: 0, y: LABEL_H + 24 },
      a2: { side: 'WEST', x: 0, y: LABEL_H + 24 },
      b1: { side: 'EAST', x: w, y: LABEL_H + 24 },
      b2: { side: 'EAST', x: w, y: LABEL_H + 24 },
    }),
    flippable: true,
  },
  'slide-switch': {
    baseW: 76,
    h: LABEL_H + 46,
    ports: (w) => ({
      com: { side: 'WEST', x: 0, y: LABEL_H + 23 },
      a: { side: 'EAST', x: w, y: LABEL_H + 10 },
      b: { side: 'EAST', x: w, y: LABEL_H + 36 },
    }),
  },
  buzzer: { baseW: 68, h: LABEL_H + 42, ports: we(LABEL_H + 30, 'plus', 'minus') },
  motor: { baseW: 68, h: LABEL_H + 46, ports: we(LABEL_H + 23, 'a', 'b'), flippable: true },
  npn: {
    baseW: 104,
    h: 76,
    labelPos: 'right',
    ports: () => ({
      b: { side: 'WEST', x: 0, y: 38 },
      c: { side: 'NORTH', x: 38, y: 0 },
      e: { side: 'SOUTH', x: 38, y: 76 },
    }),
  },
  servo: {
    baseW: 116,
    h: LABEL_H + 60,
    ports: () => ({
      signal: { side: 'WEST', x: 0, y: LABEL_H + 14 },
      vcc: { side: 'WEST', x: 0, y: LABEL_H + 30 },
      gnd: { side: 'WEST', x: 0, y: LABEL_H + 46 },
    }),
  },
};

export interface NodeGeom {
  w: number;
  h: number;
  ports: Record<string, PortGeom>;
  flipped: boolean;
  labelPos: 'top' | 'right';
}

/** Rough text width (px) for Inter 11px / mono 10px labels. */
export const textWidth = (s: string, px = 11) => Math.ceil(s.length * px * 0.58);

export function isFlippable(symbol: SchematicSymbol): boolean {
  return !!SPECS[symbol]?.flippable;
}

/** Geometry of a discrete symbol (null for 'mcu' / 'none' / unknown). */
export function symbolGeometry(symbol: SchematicSymbol, label: string, value: string | undefined, flip: boolean): NodeGeom | null {
  const spec = SPECS[symbol];
  if (!spec) return null;
  const labelPos = spec.labelPos ?? 'top';
  const text = labelPos === 'top' ? textWidth(label) + (value ? textWidth(value, 10) + 10 : 0) + 8 : 0;
  const w = Math.max(spec.baseW, text);
  const raw = spec.ports(w, spec.h);
  const flipped = flip && !!spec.flippable;
  const ports: Record<string, PortGeom> = {};
  for (const [pin, p] of Object.entries(raw)) {
    ports[pin] = flipped && (p.side === 'WEST' || p.side === 'EAST') ? { side: p.side === 'WEST' ? 'EAST' : 'WEST', x: w - p.x, y: p.y } : p;
  }
  return { w, h: spec.h, ports, flipped, labelPos };
}

export function mcuHeight(portCount: number): number {
  return Math.max(96, MCU_HEADER + 14 + portCount * MCU_PIN_PITCH);
}

/** Electrical value shown next to the label ("220 Ω", "9 V", "NPN"). */
export function symbolValue(def: PartDef, props: Record<string, unknown>, formatOhms: (o: number) => string): string | undefined {
  const e = def.electrical;
  switch (e.model) {
    case 'resistor':
    case 'potentiometer': {
      const v = Number(props[e.resistanceProp] ?? def.props.find((p) => p.key === e.resistanceProp)?.default);
      return Number.isFinite(v) ? formatOhms(v) : undefined;
    }
    case 'battery':
      return `${String(e.voltage).replace('.', ',')} V`;
    case 'npn':
      return 'NPN';
    default:
      return undefined;
  }
}
