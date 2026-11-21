/**
 * Pin-level topology of a project, shared by the netlist, the solver, the
 * bindings and the checks. Memoized per (immutable) project object.
 *
 *  - `net`  : full electrical connectivity (male↔female overlap + every
 *             internal bus + wires) → what buildNetlist reports.
 *  - `node` : solver nodes. Only overlap and BREADBOARD strips are merged;
 *             wires and the internal buses of other parts (button leg pairs,
 *             board GND pins…) become tiny resistors so per-wire and per-leg
 *             currents can be reported.
 */
import type { Id, PartDef, PartInstance, PinDef, PinRef, ProjectModel, Wire } from '@/contracts';
import { findPartDef } from '@/catalog';
import { localToWorld } from '@/lib/geometry';
import { UnionFind } from './unionfind';

export interface PinRec {
  idx: number;
  ref: PinRef;
  part: number; // index into Topology.parts
  def: PinDef;
  x: number; // world grid position
  y: number;
  female: boolean;
  /** Pin of a breadboard (pure bus part). */
  hole: boolean;
}

export interface PartRec {
  index: number;
  part: PartInstance;
  def: PartDef;
  /** Breadboard-like part (electrical model 'bus'). */
  bus: boolean;
  /** Microcontroller board (electrical model 'mcu'). */
  board: boolean;
  /** pin id → pin index. */
  pins: Map<string, number>;
}

export interface WireRec {
  wire: Wire;
  /** Pin indices of both ends (-1 when the end does not exist). */
  from: number;
  to: number;
}

/** Internal bus of a non-breadboard part, modelled as a tiny resistor. */
export interface LinkRec {
  part: number;
  a: number; // pin idx
  b: number; // pin idx
}

export interface Topology {
  project: ProjectModel;
  parts: PartRec[];
  partById: Map<Id, PartRec>;
  pins: PinRec[];
  pinIndex: Map<PinRef, number>;
  /** "x,y" → pin indices at that world grid point. */
  byPoint: Map<string, number[]>;
  /** [male pin idx, female pin idx] pairs that touch (sorted by male idx). */
  insertions: Array<[number, number]>;
  wires: WireRec[];
  links: LinkRec[];
  /** pin idx → solver node. */
  node: Int32Array;
  nodeCount: number;
  nodePins: number[][];
  /** pin idx → net group (0-based, deterministic: order of first pin). */
  net: Int32Array;
  netCount: number;
  netPins: number[][];
}

export const pointKey = (x: number, y: number) => `${x},${y}`;

const cache = new WeakMap<ProjectModel, Topology>();

export function getTopology(project: ProjectModel): Topology {
  let t = cache.get(project);
  if (!t) {
    t = buildTopology(project);
    cache.set(project, t);
  }
  return t;
}

function groupsFrom(uf: UnionFind, count: number): { group: Int32Array; n: number; members: number[][] } {
  const group = new Int32Array(count);
  const rootToGroup = new Map<number, number>();
  const members: number[][] = [];
  for (let i = 0; i < count; i++) {
    const r = uf.find(i);
    let g = rootToGroup.get(r);
    if (g === undefined) {
      g = members.length;
      rootToGroup.set(r, g);
      members.push([]);
    }
    group[i] = g;
    members[g].push(i);
  }
  return { group, n: members.length, members };
}

function buildTopology(project: ProjectModel): Topology {
  const parts: PartRec[] = [];
  const partById = new Map<Id, PartRec>();
  const pins: PinRec[] = [];
  const pinIndex = new Map<PinRef, number>();
  const byPoint = new Map<string, number[]>();

  // Malformed (imported / hand-edited) projects: missing arrays or null entries are skipped, never thrown on.
  for (const part of Array.isArray(project.parts) ? project.parts : []) {
    if (!part || typeof part !== 'object') continue;
    const def = findPartDef(part.type);
    if (!def || partById.has(part.id)) continue;
    const rec: PartRec = {
      index: parts.length,
      part,
      def,
      bus: def.electrical.model === 'bus',
      board: def.electrical.model === 'mcu',
      pins: new Map(),
    };
    parts.push(rec);
    partById.set(part.id, rec);
    for (const pd of def.pins) {
      if (rec.pins.has(pd.id)) continue;
      const w = localToWorld(part, pd);
      const x = Math.round(w.x);
      const y = Math.round(w.y);
      const idx = pins.length;
      const ref = `${part.id}.${pd.id}`;
      pins.push({ idx, ref, part: rec.index, def: pd, x, y, female: pd.contact === 'female', hole: rec.bus });
      rec.pins.set(pd.id, idx);
      pinIndex.set(ref, idx);
      const key = pointKey(x, y);
      const at = byPoint.get(key);
      if (at) at.push(idx);
      else byPoint.set(key, [idx]);
    }
  }

  const n = pins.length;
  const ufNode = new UnionFind(n);
  const ufNet = new UnionFind(n);

  // 1. Overlap: only male ↔ female (different parts).
  const insertions: Array<[number, number]> = [];
  for (const at of byPoint.values()) {
    if (at.length < 2) continue;
    for (const m of at) {
      if (pins[m].female) continue;
      for (const f of at) {
        if (!pins[f].female || pins[f].part === pins[m].part) continue;
        ufNode.union(m, f);
        ufNet.union(m, f);
        insertions.push([m, f]);
      }
    }
  }
  insertions.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  // 2. Internal buses.
  const links: LinkRec[] = [];
  for (const rec of parts) {
    for (const bus of rec.def.internalBuses ?? []) {
      const idxs: number[] = [];
      for (const id of bus) {
        const i = rec.pins.get(id);
        if (i !== undefined) idxs.push(i);
      }
      for (let k = 1; k < idxs.length; k++) {
        ufNet.union(idxs[0], idxs[k]);
        if (rec.bus) ufNode.union(idxs[0], idxs[k]);
        else links.push({ part: rec.index, a: idxs[0], b: idxs[k] });
      }
    }
  }

  // 3. Wires.
  const wires: WireRec[] = [];
  for (const wire of Array.isArray(project.wires) ? project.wires : []) {
    if (!wire || typeof wire !== 'object') continue;
    const from = pinIndex.get(wire.from) ?? -1;
    const to = pinIndex.get(wire.to) ?? -1;
    wires.push({ wire, from, to });
    if (from >= 0 && to >= 0 && from !== to) ufNet.union(from, to);
  }

  const nodes = groupsFrom(ufNode, n);
  const nets = groupsFrom(ufNet, n);
  return {
    project,
    parts,
    partById,
    pins,
    pinIndex,
    byPoint,
    insertions,
    wires,
    links,
    node: nodes.group,
    nodeCount: nodes.n,
    nodePins: nodes.members,
    net: nets.group,
    netCount: nets.n,
    netPins: nets.members,
  };
}

/** Pin index of `partId.pinId`, or -1. */
export function pinIdx(topo: Topology, partId: Id, pinId: string): number {
  return topo.partById.get(partId)?.pins.get(pinId) ?? -1;
}

/** Net group of a pin index (-1 for a missing pin). */
export const netOfIdx = (topo: Topology, idx: number) => (idx >= 0 ? topo.net[idx] : -1);
