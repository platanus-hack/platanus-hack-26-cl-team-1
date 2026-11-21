/**
 * Live overlay helpers (pure): voltage → colour, per-edge current/direction,
 * per-node state. Everything is keyed by part id / PinRef (never NetId).
 */
import type { CircuitResult, ProjectModel, PropValue } from '@/contracts';
import { findPartDef, propValue } from '@/catalog';
import type { SchematicGraph, SEdge, SNet } from './graph';
import { LED_COLORS, type NodeLive } from './symbols';

export const IDLE_LINE = '#9aa7b4';

/** Numeric prop value, or the fallback for missing / non-numeric values ('abc', NaN). */
function finiteOr(v: PropValue | undefined, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const STOPS: Array<[number, RGB]> = [
  [0, hex('#4f5b68')],
  [0.45, hex('#7fa9c4')],
  [1, hex('#ffd27a')],
];

/** 0 V (muted slate) → half supply (cool blue) → supply (bright amber). */
export function voltageColor(v: number, vmax: number): string {
  const t = Math.max(0, Math.min(1, vmax > 0 ? v / vmax : 0));
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1][0]) i++;
  const [t0, c0] = STOPS[i];
  const [t1, c1] = STOPS[i + 1];
  const k = (t - t0) / (t1 - t0 || 1);
  const c = c0.map((a, j) => Math.round(a + (c1[j] - a) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/**
 * Top of the colour scale: the highest net voltage present, but never below
 * the board's logic level (so the scale does not jump while a pin blinks).
 */
export function voltageScale(observed: Array<number | undefined>, logicVolts: number | undefined): number {
  const v = Math.max(logicVolts ?? 0, ...observed.filter((x): x is number => typeof x === 'number' && Number.isFinite(x)));
  return v > 0.5 ? v : 5;
}

export function netVoltage(net: SNet, result: CircuitResult | null): number | undefined {
  if (!result) return undefined;
  for (const p of net.ports) {
    const v = result.pinVoltages[p.ref];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  for (const r of net.refs) {
    const v = result.pinVoltages[r];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** Current (A, ≥ 0) along an edge and whether it flows source → target. */
export function edgeFlow(edge: SEdge, result: CircuitResult | null): { amps: number; forward: boolean } {
  if (!result) return { amps: 0, forward: true };
  const iT = edge.targetRef ? result.pinCurrents[edge.targetRef] : undefined;
  const iS = edge.sourceRef ? result.pinCurrents[edge.sourceRef] : undefined;
  // pinCurrents = current flowing from the node INTO the leg.
  if (typeof iT === 'number' && Number.isFinite(iT) && (iS === undefined || Math.abs(iT) >= Math.abs(iS ?? 0))) {
    return { amps: Math.abs(iT), forward: iT > 0 };
  }
  if (typeof iS === 'number' && Number.isFinite(iS)) return { amps: Math.abs(iS), forward: iS < 0 };
  return { amps: 0, forward: true };
}

/** Animation period (s) for a current: faster with more current. */
export function flowPeriod(amps: number): number {
  const mA = amps * 1000;
  return Math.max(0.3, Math.min(2.2, 1.6 / Math.log10(2 + mA * 4)));
}

export function nodeLive(
  graph: SchematicGraph,
  project: ProjectModel,
  result: CircuitResult | null,
  runtime: Record<string, Record<string, PropValue>>,
  netColors: Record<string, string>,
): Record<string, NodeLive> {
  const out: Record<string, NodeLive> = {};
  for (const node of graph.nodes) {
    const part = project.parts.find((p) => p.id === node.id);
    const def = part && findPartDef(part.type);
    if (!part || !def) continue;
    const rt = { ...part.props, ...(runtime[part.id] ?? {}) };
    const st = result?.parts[part.id];
    const live: NodeLive = {
      brightness: st?.brightness,
      rgb: st?.rgb,
      burned: st?.burned,
      reversed: st?.reversed,
      overloaded: st?.overloaded,
      speed: st?.speed,
      sounding: st?.sounding,
      angle: st?.angle,
      region: st?.region,
    };
    if (def.electrical.model === 'led') live.ledColor = LED_COLORS[String(propValue(part, def.electrical.colorProp, def))] ?? LED_COLORS.red;
    if (def.electrical.model === 'switch') {
      const v = rt[def.electrical.stateProp];
      if (def.electrical.kind === 'push') live.pressed = v === true;
      else live.position = typeof v === 'string' ? v : 'a';
    }
    if (def.electrical.model === 'potentiometer') live.position = finiteOr(rt[def.electrical.positionProp], 50);
    if (def.electrical.model === 'ldr') live.light = finiteOr(rt[def.electrical.lightProp], 60);
    if (node.symbol === 'mcu') {
      live.portColors = {};
      for (const p of node.ports) if (netColors[p.netKey]) live.portColors[p.id] = netColors[p.netKey];
    }
    out[node.id] = live;
  }
  return out;
}
