/**
 * Lightweight connectivity (union-find) used as a FALLBACK while the circuit
 * module's buildNetlist is not available, and by tests. Follows the contract
 * rules in contracts/model.ts: male↔female overlap, wires, internal buses.
 */
import type { Net, Netlist, PinRef, ProjectModel } from '@/contracts';
import { canonicalBoardPin, findPartDef, projectBoard } from '@/catalog';
import { localToWorld } from '@/lib/geometry';
import { getNetlist } from '@/store/derived';

class UnionFind {
  private parent: number[] = [];
  add(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r];
    while (this.parent[i] !== r) {
      const n = this.parent[i];
      this.parent[i] = r;
      i = n;
    }
    return r;
  }
  union(a: number, b: number): void {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

interface PinEntry {
  ref: PinRef;
  idx: number;
  partId: string;
  contact: 'male' | 'female';
  isBreadboard: boolean;
}

export function computeNetlist(project: ProjectModel): Netlist {
  const uf = new UnionFind();
  const index = new Map<PinRef, number>();
  const refs: PinRef[] = [];
  const byPoint = new Map<string, PinEntry[]>();

  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (!def) continue;
    const isBreadboard = def.electrical.model === 'bus';
    for (const pin of def.pins) {
      const ref = `${part.id}.${pin.id}`;
      const idx = uf.add();
      index.set(ref, idx);
      refs.push(ref);
      const w = localToWorld(part, pin);
      const key = `${w.x},${w.y}`;
      const list = byPoint.get(key) ?? [];
      list.push({ ref, idx, partId: part.id, contact: pin.contact ?? 'male', isBreadboard });
      byPoint.set(key, list);
    }
    for (const bus of def.internalBuses ?? []) {
      const first = index.get(`${part.id}.${bus[0]}`);
      if (first === undefined) continue;
      for (const p of bus.slice(1)) {
        const i = index.get(`${part.id}.${p}`);
        if (i !== undefined) uf.union(first, i);
      }
    }
  }

  const insertions: Netlist['insertions'] = [];
  for (const list of byPoint.values()) {
    if (list.length < 2) continue;
    for (const m of list) {
      if (m.contact !== 'male') continue;
      const females = list.filter((f) => f.contact === 'female' && f.partId !== m.partId);
      for (const f of females) uf.union(m.idx, f.idx);
      if (!m.isBreadboard && females.length > 0) {
        const into = females.find((f) => f.isBreadboard) ?? females[0];
        insertions.push({ pin: m.ref, into: into.ref });
      }
    }
  }

  for (const w of project.wires) {
    const a = index.get(w.from), b = index.get(w.to);
    if (a !== undefined && b !== undefined) uf.union(a, b);
  }

  const rootToNet = new Map<number, Net>();
  const pinNet: Record<PinRef, string> = {};
  const nets: Net[] = [];
  for (const ref of refs) {
    const root = uf.find(index.get(ref)!);
    let net = rootToNet.get(root);
    if (!net) {
      net = { id: `n${nets.length + 1}`, pins: [], wires: [] };
      rootToNet.set(root, net);
      nets.push(net);
    }
    net.pins.push(ref);
    pinNet[ref] = net.id;
  }
  for (const w of project.wires) {
    const id = pinNet[w.from];
    if (id && id === pinNet[w.to]) nets.find((n) => n.id === id)?.wires.push(w.id);
  }

  // Friendly names from the active board, else battery terminals.
  const board = projectBoard(project);
  for (const net of nets) {
    let name: string | undefined;
    let rank = 99;
    for (const ref of net.pins) {
      const dot = ref.indexOf('.');
      const partId = ref.slice(0, dot), pinId = ref.slice(dot + 1);
      if (board && partId === board.part.id) {
        const bp = board.profile.pins.find((p) => p.id === pinId);
        if (!bp) continue;
        const r = bp.kind === 'ground' ? 0 : bp.kind === 'power' ? 1 : bp.kind === 'gpio' ? 2 : 9;
        if (r < rank) {
          rank = r;
          name = bp.kind === 'ground' ? 'GND' : canonicalBoardPin(board.profile, bp.id);
        }
      } else {
        const part = project.parts.find((p) => p.id === partId);
        if (part && findPartDef(part.type)?.electrical.model === 'battery' && rank > 5) {
          rank = 5;
          name = pinId === 'plus' ? 'BAT+' : 'BAT−';
        }
      }
    }
    if (name) net.name = name;
  }

  return { nets, pinNet, insertions };
}

const fallbackCache = new WeakMap<ProjectModel, Netlist>();

/**
 * The project's netlist: the circuit module's (memoized) one when available,
 * otherwise the local fallback above.
 */
export function netlistFor(project: ProjectModel): Netlist {
  let n: Netlist | null = null;
  try {
    n = getNetlist(project);
  } catch {
    n = null;
  }
  const hasPins = project.parts.some((p) => (findPartDef(p.type)?.pins.length ?? 0) > 0);
  if (n && (n.nets.length > 0 || !hasPins)) return n;
  let f = fallbackCache.get(project);
  if (!f) {
    f = computeNetlist(project);
    fallbackCache.set(project, f);
  }
  return f;
}
