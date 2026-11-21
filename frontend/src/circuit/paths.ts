/** Conductor paths (wires + part-internal buses) between two pins. */
import type { Topology } from './topology';

export interface WireStep {
  wire: string;
  /** +1 when the path walks wire.from → wire.to. */
  sign: number;
}

/** One conductor walked by a path: a wire, or a part-internal bus (link) entered at `link[0]` and left at `link[1]`. */
export type ConductorStep = { wire: string; sign: number; link?: undefined } | { wire?: undefined; sign: number; link: [number, number] };

interface Edge {
  to: number;
  wire: string | null;
  sign: number;
  /** Link edges: [pin entered, pin left] in this direction. */
  link?: [number, number];
}

const adjCache = new WeakMap<Topology, Map<number, Edge[]>>();

function adjacency(topo: Topology): Map<number, Edge[]> {
  let adj = adjCache.get(topo);
  if (adj) return adj;
  adj = new Map();
  const add = (a: number, b: number, wire: string | null, sign: number, link?: [number, number]) => {
    const list = adj?.get(a);
    const e: Edge = { to: b, wire, sign, link };
    if (list) list.push(e);
    else adj?.set(a, [e]);
  };
  for (const w of topo.wires) {
    if (w.from < 0 || w.to < 0) continue;
    const a = topo.node[w.from];
    const b = topo.node[w.to];
    if (a === b) continue;
    add(a, b, w.wire.id, 1);
    add(b, a, w.wire.id, -1);
  }
  for (const l of topo.links) {
    const a = topo.node[l.a];
    const b = topo.node[l.b];
    if (a === b) continue;
    add(a, b, null, 1, [l.a, l.b]);
    add(b, a, null, -1, [l.b, l.a]);
  }
  adjCache.set(topo, adj);
  return adj;
}

/**
 * Shortest conductor path between two pins (BFS over solver nodes): every
 * wire (with its direction) and part-internal bus walked, in order. Empty when
 * both pins share a node, null if the pins are not joined by conductors.
 */
export function conductorPath(topo: Topology, fromPin: number, toPin: number): ConductorStep[] | null {
  if (fromPin < 0 || toPin < 0) return null;
  const start = topo.node[fromPin];
  const goal = topo.node[toPin];
  if (start === goal) return [];
  const adj = adjacency(topo);
  const prev = new Map<number, { from: number; edge: Edge | null }>();
  prev.set(start, { from: -1, edge: null });
  const queue = [start];
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q];
    if (n === goal) break;
    for (const e of adj.get(n) ?? []) {
      if (prev.has(e.to)) continue;
      prev.set(e.to, { from: n, edge: e });
      queue.push(e.to);
    }
  }
  if (!prev.has(goal)) return null;
  const steps: ConductorStep[] = [];
  for (let n = goal; n !== start; ) {
    const p = prev.get(n);
    if (!p?.edge) break;
    if (p.edge.wire) steps.push({ wire: p.edge.wire, sign: p.edge.sign });
    else if (p.edge.link) steps.push({ sign: p.edge.sign, link: p.edge.link });
    n = p.from;
  }
  return steps.reverse();
}

/** Wires only of the shortest conductor path between two pins (see conductorPath). */
export function wirePath(topo: Topology, fromPin: number, toPin: number): WireStep[] | null {
  const path = conductorPath(topo, fromPin, toPin);
  if (!path) return null;
  const out: WireStep[] = [];
  for (const s of path) if (s.wire) out.push({ wire: s.wire, sign: s.sign });
  return out;
}
