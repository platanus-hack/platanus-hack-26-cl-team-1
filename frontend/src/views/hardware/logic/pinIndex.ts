/**
 * Spatial index of every pin's world position (pins sit on integer grid
 * points), used for O(1) pin hit-testing, drop-preview insertion detection
 * (male pin on a female hole) and "carry inserted parts" when dragging.
 */
import type { Id, Netlist, PartDef, PinDef, PinRef, Point, ProjectModel, Rotation } from '@/contracts';
import { findPartDef } from '@/catalog';
import { localToWorld } from '@/lib/geometry';
import { parsePinRef, pinRef } from '@/lib/pinref';

export interface PinEntry {
  ref: PinRef;
  partId: Id;
  pinId: string;
  /** Render order of the owning part (higher = on top). */
  z: number;
  x: number;
  y: number;
  contact: 'male' | 'female';
  pin: PinDef;
  isHole: boolean;
}

export interface PinIndex {
  byPoint: Map<string, PinEntry[]>;
  byRef: Map<PinRef, PinEntry>;
  byPart: Map<Id, PinEntry[]>;
}

export const pointKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;

const cache = new WeakMap<ProjectModel, PinIndex>();

export function buildPinIndex(project: ProjectModel): PinIndex {
  const byPoint = new Map<string, PinEntry[]>();
  const byRef = new Map<PinRef, PinEntry>();
  const byPart = new Map<Id, PinEntry[]>();
  project.parts.forEach((part, z) => {
    const def = findPartDef(part.type);
    if (!def) return;
    const list: PinEntry[] = [];
    for (const pin of def.pins) {
      const w = localToWorld(part, pin);
      const e: PinEntry = {
        ref: pinRef(part.id, pin.id),
        partId: part.id,
        pinId: pin.id,
        z,
        x: w.x,
        y: w.y,
        contact: pin.contact ?? 'male',
        pin,
        isHole: pin.kind === 'hole',
      };
      list.push(e);
      byRef.set(e.ref, e);
      const k = pointKey(w.x, w.y);
      const arr = byPoint.get(k);
      if (arr) arr.push(e);
      else byPoint.set(k, [e]);
    }
    byPart.set(part.id, list);
  });
  return { byPoint, byRef, byPart };
}

/** Memoized per immutable project object. */
export function getPinIndex(project: ProjectModel): PinIndex {
  let idx = cache.get(project);
  if (!idx) {
    idx = buildPinIndex(project);
    cache.set(project, idx);
  }
  return idx;
}

/**
 * Topmost pin within `radius` grid units of `p` that passes `allowed`.
 * Ties at the same point are broken by z (the part drawn on top wins).
 */
export function pinAt(index: PinIndex, p: Point, radius: number, allowed?: (e: PinEntry) => boolean): PinEntry | null {
  let best: PinEntry | null = null;
  let bestD = Infinity;
  const r = Math.max(0.05, radius);
  const reach = Math.ceil(r);
  const cx = Math.round(p.x);
  const cy = Math.round(p.y);
  for (let dx = -reach; dx <= reach; dx++) {
    for (let dy = -reach; dy <= reach; dy++) {
      const arr = index.byPoint.get(`${cx + dx},${cy + dy}`);
      if (!arr) continue;
      for (const e of arr) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d > r) continue;
        if (allowed && !allowed(e)) continue;
        if (d < bestD - 1e-6 || (Math.abs(d - bestD) <= 1e-6 && best !== null && e.z > best.z)) {
          best = e;
          bestD = d;
        }
      }
    }
  }
  return best;
}

export interface Insertion {
  /** Pin of the moving / dropped part. */
  pin: string;
  /** Pin of an existing part it lands on (opposite contact type). */
  into: PinRef;
  x: number;
  y: number;
}

/**
 * Which pins of a part placed at `origin`/`rotation` would plug into existing
 * pins: a MALE pin on a FEMALE pin (leg into a hole / socket) or a FEMALE pin
 * landing under a MALE one (breadboard dropped under loose legs).
 */
export function insertionsFor(
  def: PartDef,
  origin: Point,
  rotation: Rotation,
  index: PinIndex,
  exclude: ReadonlySet<Id> = new Set(),
): Insertion[] {
  const out: Insertion[] = [];
  const frame = { x: origin.x, y: origin.y, rotation };
  for (const pin of def.pins) {
    const w = localToWorld(frame, pin);
    const arr = index.byPoint.get(pointKey(w.x, w.y));
    if (!arr) continue;
    const mine = pin.contact ?? 'male';
    let target: PinEntry | null = null;
    for (const e of arr) {
      if (exclude.has(e.partId) || e.contact === mine) continue;
      if (!target || e.z > target.z) target = e;
    }
    if (target) out.push({ pin: pin.id, into: target.ref, x: w.x, y: w.y });
  }
  return out;
}

/**
 * Parts carried along when `moving` parts are dragged: every other part with
 * a MALE pin plugged into a FEMALE pin of a moving part (legs in a dragged
 * breadboard, an ESP32 devkit on it…). One level, plus `netlist.insertions`.
 */
export function carriedParts(project: ProjectModel, moving: ReadonlySet<Id>, netlist?: Netlist): Set<Id> {
  const index = getPinIndex(project);
  const out = new Set<Id>();
  for (const id of moving) {
    for (const e of index.byPart.get(id) ?? []) {
      if (e.contact !== 'female') continue;
      for (const other of index.byPoint.get(pointKey(e.x, e.y)) ?? []) {
        if (other.contact === 'male' && !moving.has(other.partId)) out.add(other.partId);
      }
    }
  }
  if (netlist) {
    for (const ins of netlist.insertions) {
      const into = parsePinRef(ins.into).part;
      const from = parsePinRef(ins.pin).part;
      if (moving.has(into) && !moving.has(from) && project.parts.some((p) => p.id === from)) out.add(from);
    }
  }
  return out;
}
