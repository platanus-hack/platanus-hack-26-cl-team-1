/**
 * World-space model of breadboards and of what occupies them (part legs,
 * wire ends, bodies covering holes). Pure helpers shared by placement,
 * the wiring guide and the examples.
 */
import type { PartDef, PartInstance, PinRef, Point, ProjectModel } from '@/contracts';
import { findPartDef, parseHole } from '@/catalog';
import { localToWorld, partWorldBounds } from '@/lib/geometry';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HoleInfo {
  ref: PinRef; // 'bb1.e12'
  id: string; // 'e12'
  bb: string; // breadboard part id
  /** World position. */
  x: number;
  y: number;
  /** Position in the breadboard's local frame. */
  lx: number;
  ly: number;
  /** Strip key (internal bus): holes with the same strip are always connected. */
  strip: string;
  kind: 'main' | 'rail';
  row?: string; // main holes: 'a'..'j'
  rail?: string; // rail holes: 'T+' …
  col: number;
  half?: 'top' | 'bottom';
}

export interface BreadboardModel {
  part: PartInstance;
  def: PartDef;
  holes: HoleInfo[];
  byId: Map<string, HoleInfo>;
  strips: Map<string, HoleInfo[]>;
}

export const pointKey = (p: Point) => `${p.x},${p.y}`;
export const isBreadboardDef = (def: PartDef) => def.electrical.model === 'bus';
export const isBoardPartDef = (def: PartDef) => def.electrical.model === 'mcu';

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;
}

/** Inset used to decide if a hole is under a part body (pins on the bounds edge do not cover). */
const COVER_INSET = 0.3;
export function coversPoint(r: Rect, p: Point): boolean {
  return p.x > r.x + COVER_INSET && p.x < r.x + r.w - COVER_INSET && p.y > r.y + COVER_INSET && p.y < r.y + r.h - COVER_INSET;
}

const modelCache = new WeakMap<PartInstance, BreadboardModel>();

export function breadboardModel(part: PartInstance, def: PartDef): BreadboardModel {
  const cached = modelCache.get(part);
  if (cached) return cached;
  const busOf = new Map<string, number>();
  (def.internalBuses ?? []).forEach((bus, i) => bus.forEach((h) => busOf.set(h, i)));
  const holes: HoleInfo[] = [];
  for (const pin of def.pins) {
    const parsed = parseHole(pin.id);
    if (!parsed) continue;
    const w = localToWorld(part, pin);
    const bus = busOf.get(pin.id);
    const info: HoleInfo = {
      ref: `${part.id}.${pin.id}`,
      id: pin.id,
      bb: part.id,
      x: w.x,
      y: w.y,
      lx: pin.x,
      ly: pin.y,
      strip: bus === undefined ? `${part.id}.${pin.id}` : `${part.id}#${bus}`,
      kind: parsed.kind,
      col: parsed.col,
    };
    if (parsed.kind === 'main') {
      info.row = parsed.row;
      info.half = parsed.row <= 'e' ? 'top' : 'bottom';
    } else info.rail = parsed.rail;
    holes.push(info);
  }
  const byId = new Map(holes.map((h) => [h.id, h]));
  const strips = new Map<string, HoleInfo[]>();
  for (const h of holes) {
    const list = strips.get(h.strip) ?? [];
    list.push(h);
    strips.set(h.strip, list);
  }
  const model = { part, def, holes, byId, strips };
  modelCache.set(part, model);
  return model;
}

export function breadboardsOf(project: ProjectModel): BreadboardModel[] {
  const out: BreadboardModel[] = [];
  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (def && isBreadboardDef(def)) out.push(breadboardModel(part, def));
  }
  return out;
}

/** Everything that blocks new legs / wire ends on the breadboards. */
export interface Occupancy {
  boards: BreadboardModel[];
  holeAt: Map<string, HoleInfo>;
  holeByRef: Map<PinRef, HoleInfo>;
  /** Holes with a (non-breadboard) part pin on them. */
  occupied: Set<PinRef>;
  /** Holes with a wire end. */
  wired: Set<PinRef>;
  /** Holes under a non-breadboard part body. */
  covered: Set<PinRef>;
  /** Strips touched by a part pin or a wire end. */
  usedStrips: Set<string>;
  /** Strip → part ids whose pins sit in it. */
  stripParts: Map<string, Set<string>>;
  /** World bounds of every non-breadboard part. */
  partRects: Array<{ id: string; rect: Rect }>;
}

export function buildOccupancy(project: ProjectModel, excludePart?: string): Occupancy {
  const boards = breadboardsOf(project);
  const holeAt = new Map<string, HoleInfo>();
  const holeByRef = new Map<PinRef, HoleInfo>();
  for (const bb of boards) {
    for (const h of bb.holes) {
      holeAt.set(pointKey(h), h);
      holeByRef.set(h.ref, h);
    }
  }
  const occ: Occupancy = {
    boards,
    holeAt,
    holeByRef,
    occupied: new Set(),
    wired: new Set(),
    covered: new Set(),
    usedStrips: new Set(),
    stripParts: new Map(),
    partRects: [],
  };
  for (const part of project.parts) {
    if (part.id === excludePart) continue;
    const def = findPartDef(part.type);
    if (!def || isBreadboardDef(def)) continue;
    const rect = partWorldBounds(part, def);
    occ.partRects.push({ id: part.id, rect });
    for (const pin of def.pins) {
      const h = holeAt.get(pointKey(localToWorld(part, pin)));
      if (!h) continue;
      occ.occupied.add(h.ref);
      occ.usedStrips.add(h.strip);
      const set = occ.stripParts.get(h.strip) ?? new Set<string>();
      set.add(part.id);
      occ.stripParts.set(h.strip, set);
    }
    if (holeAt.size > 0) {
      for (const bb of boards) {
        for (const h of bb.holes) if (coversPoint(rect, h)) occ.covered.add(h.ref);
      }
    }
  }
  for (const w of project.wires) {
    for (const end of [w.from, w.to]) {
      const h = holeByRef.get(end);
      if (!h) continue;
      occ.wired.add(h.ref);
      occ.usedStrips.add(h.strip);
    }
  }
  return occ;
}

export const isHoleFree = (occ: Occupancy, h: HoleInfo) => !occ.occupied.has(h.ref) && !occ.wired.has(h.ref) && !occ.covered.has(h.ref);

/** Breadboard hole under a part pin (geometric), if any. */
export function holeUnderPin(project: ProjectModel, part: PartInstance, pinId: string, occ?: Occupancy): HoleInfo | undefined {
  const def = findPartDef(part.type);
  const pin = def?.pins.find((p) => p.id === pinId);
  if (!def || !pin || isBreadboardDef(def)) return undefined;
  const o = occ ?? buildOccupancy(project);
  return o.holeAt.get(pointKey(localToWorld(part, pin)));
}

/** Union of rects (null for none). */
export function unionRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
