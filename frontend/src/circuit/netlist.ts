/**
 * buildNetlist: connectivity from male↔female overlap + wires + internal buses.
 * Net ids 'n1', 'n2'… follow the order of the first pin of each net (parts in
 * project order, pins in PartDef order) so they are deterministic per project.
 */
import type { Net, Netlist, PinRef, ProjectModel } from '@/contracts';
import { activeBoard, type ActiveBoard } from './board';
import { getTopology, type Topology } from './topology';

export const netIdOf = (group: number) => `n${group + 1}`;

/** Lower rank wins when a net touches several named pins. */
function boardPinName(board: ActiveBoard, pinId: string): { name: string; rank: number } | null {
  const bp = board.pins.get(pinId);
  if (!bp) return null;
  const id = board.canonical(pinId);
  switch (bp.kind) {
    case 'ground':
      return { name: 'GND', rank: 0 };
    case 'power': {
      if (board.rails.has(id)) return { name: id, rank: 1 };
      return { name: id, rank: 2 }; // VIN
    }
    case 'gpio':
      return { name: id, rank: 3 };
    case 'reset':
    case 'aref':
      return { name: id, rank: 4 };
    default:
      return null; // NC
  }
}

function batteryNames(topo: Topology): Map<number, string> {
  const out = new Map<number, string>();
  const bats = topo.parts.filter((p) => p.def.electrical.model === 'battery');
  for (const rec of bats) {
    const prefix = bats.length > 1 ? `${rec.part.label} ` : '';
    const plus = rec.pins.get('plus');
    const minus = rec.pins.get('minus');
    if (plus !== undefined) out.set(plus, `${prefix}BAT+`);
    if (minus !== undefined) out.set(minus, `${prefix}BAT−`);
  }
  return out;
}

export function computeNetNames(topo: Topology): Array<string | undefined> {
  const board = activeBoard(topo);
  const bat = batteryNames(topo);
  const names: Array<string | undefined> = [];
  for (let g = 0; g < topo.netCount; g++) {
    let best: { name: string; rank: number } | null = null;
    for (const idx of topo.netPins[g]) {
      const pin = topo.pins[idx];
      let cand: { name: string; rank: number } | null = null;
      if (board && pin.part === board.rec.index) cand = boardPinName(board, pin.def.id);
      else {
        const b = bat.get(idx);
        if (b) cand = { name: b, rank: 5 };
      }
      if (cand && (!best || cand.rank < best.rank)) best = cand;
    }
    names.push(best?.name);
  }
  return names;
}

export function buildNetlist(project: ProjectModel): Netlist {
  const topo = getTopology(project);
  const names = computeNetNames(topo);
  const nets: Net[] = [];
  for (let g = 0; g < topo.netCount; g++) {
    const net: Net = { id: netIdOf(g), pins: topo.netPins[g].map((i) => topo.pins[i].ref), wires: [] };
    if (names[g] !== undefined) net.name = names[g];
    nets.push(net);
  }
  const pinNet: Record<PinRef, string> = {};
  for (const pin of topo.pins) pinNet[pin.ref] = netIdOf(topo.net[pin.idx]);
  for (const w of topo.wires) {
    if (w.from < 0 || w.to < 0) continue;
    const g = topo.net[w.from];
    if (g === topo.net[w.to]) nets[g].wires.push(w.wire.id);
  }
  const insertions = topo.insertions.map(([m, f]) => ({ pin: topo.pins[m].ref, into: topo.pins[f].ref }));
  return { nets, pinNet, insertions };
}
