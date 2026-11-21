/**
 * Net classification shared by bindings and checks (static, no solve needed).
 */
import type { Id } from '@/contracts';
import { activeBoard, type ActiveBoard } from './board';
import type { PartRec, Topology } from './topology';

export interface NetInfo {
  index: number;
  pins: number[];
  /** Canonical GPIO ids of the active board in this net. */
  gpios: string[];
  /** Canonical rail ids of the active board ('5V', '3V3'). */
  rails: string[];
  /** Touches a GND pin of the active board. */
  ground: boolean;
  batPlus: Id[];
  batMinus: Id[];
  wires: Id[];
  /** Non-breadboard parts with a pin here (boards included), in project order. */
  parts: Id[];
}

export interface Analysis {
  topo: Topology;
  board: ActiveBoard | null;
  nets: NetInfo[];
  /** Net index of a part pin, -1 when missing. */
  net(partId: Id, pinId: string): number;
  info(partId: Id, pinId: string): NetInfo | null;
}

export const isSourceNet = (n: NetInfo) => n.rails.length > 0 || n.batPlus.length > 0;
export const isGroundNet = (n: NetInfo) => n.ground || n.batMinus.length > 0;
export const isPowerNet = (n: NetInfo) => isSourceNet(n) || isGroundNet(n);

const cache = new WeakMap<Topology, Analysis>();

export function getAnalysis(topo: Topology): Analysis {
  let a = cache.get(topo);
  if (!a) {
    a = buildAnalysis(topo);
    cache.set(topo, a);
  }
  return a;
}

function buildAnalysis(topo: Topology): Analysis {
  const board = activeBoard(topo);
  const nets: NetInfo[] = topo.netPins.map((pins, index) => ({
    index,
    pins,
    gpios: [],
    rails: [],
    ground: false,
    batPlus: [],
    batMinus: [],
    wires: [],
    parts: [],
  }));
  const seenPart = nets.map(() => new Set<number>());
  for (const pin of topo.pins) {
    const info = nets[topo.net[pin.idx]];
    const rec = topo.parts[pin.part];
    if (!rec.bus && !seenPart[info.index].has(rec.index)) {
      seenPart[info.index].add(rec.index);
      info.parts.push(rec.part.id);
    }
    if (board && rec === board.rec) {
      const bp = board.pins.get(pin.def.id);
      if (!bp) continue;
      const id = board.canonical(bp.id);
      if (bp.kind === 'ground') info.ground = true;
      else if (bp.kind === 'gpio' && !info.gpios.includes(id)) info.gpios.push(id);
      else if (bp.kind === 'power' && board.rails.has(id) && !info.rails.includes(id)) info.rails.push(id);
    } else if (rec.def.electrical.model === 'battery') {
      if (pin.def.id === 'plus') info.batPlus.push(rec.part.id);
      else if (pin.def.id === 'minus') info.batMinus.push(rec.part.id);
    }
  }
  for (const w of topo.wires) {
    if (w.from >= 0 && w.to >= 0) nets[topo.net[w.from]].wires.push(w.wire.id);
  }
  const net = (partId: Id, pinId: string) => {
    const idx = topo.partById.get(partId)?.pins.get(pinId);
    return idx === undefined ? -1 : topo.net[idx];
  };
  return {
    topo,
    board,
    nets,
    net,
    info: (partId, pinId) => {
      const n = net(partId, pinId);
      return n >= 0 ? nets[n] : null;
    },
  };
}

/** True when the pin touches anything outside its own part (another part's pin or a wire). */
export function pinConnected(an: Analysis, rec: PartRec, pinId: string): boolean {
  const info = an.info(rec.part.id, pinId);
  if (!info) return false;
  if (info.wires.length > 0) return true;
  return info.parts.some((p) => p !== rec.part.id);
}

/** Pin ids of a two-terminal series part (resistor/diode/…) → the other terminal. */
export function otherTerminal(rec: PartRec, pinId: string): string | null {
  const ids = rec.def.pins.map((p) => p.id);
  if (ids.length !== 2) return null;
  return ids[0] === pinId ? ids[1] : ids[1] === pinId ? ids[0] : null;
}
