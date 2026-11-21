/**
 * Pure builders of Op lists for canvas edits (the caller dispatches them).
 */
import type { Id, Op, PartDef, PartInstance, Point, ProjectModel, Wire } from '@/contracts';
import { defaultProps, findPartDef } from '@/catalog';
import { localToWorld, rotateCW, rotatePoint } from '@/lib/geometry';
import { nextId, nextLabel, nextPartId } from '@/lib/ids';
import { parsePinRef, pinRef } from '@/lib/pinref';
import { getPinIndex } from './pinIndex';
import { isBoard, partLayer, safeWorldBounds } from './partInfo';
import { rectsIntersect, type Rect } from './viewport';

export interface Selection {
  parts: Id[];
  wires: Id[];
}

/** Delete selected wires and parts in one transaction (wires first: part.remove cascades). */
export function deleteOps(project: ProjectModel, sel: Selection): Op[] {
  const ops: Op[] = [];
  const parts = new Set(sel.parts.filter((id) => project.parts.some((p) => p.id === id)));
  for (const id of sel.wires) {
    const w = project.wires.find((x) => x.id === id);
    if (!w) continue;
    // wires attached to a removed part are cascaded anyway; removing them first is harmless
    ops.push({ op: 'wire.remove', id });
  }
  for (const id of parts) ops.push({ op: 'part.remove', id });
  return ops;
}

/**
 * Local rotation pivot of a part: the point nearest to its bounds centre whose
 * coordinates are both integers or both half-integers. A 90° turn about such a
 * point maps grid points onto grid points exactly, so the new origin needs no
 * rounding and four turns bring the part back to where it started. (Turning
 * about a centre like (14, 10.5) needs rounding, and Math.round's bias made
 * boards, buttons and LDRs walk 2 holes diagonally every full turn.)
 */
export function rotationPivot(def: PartDef): Point {
  const b = def.bounds;
  const tx = (b.x + b.w / 2) * 2; // centre in half units
  const ty = (b.y + b.h / 2) * 2;
  const hx = Math.round(tx);
  const hy = Math.round(ty);
  if ((((hx - hy) % 2) + 2) % 2 === 0) return { x: hx / 2, y: hy / 2 };
  const candidates = [
    { x: hx, y: hy - 1 },
    { x: hx, y: hy + 1 },
    { x: hx - 1, y: hy },
    { x: hx + 1, y: hy },
  ];
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.x - tx) ** 2 + (c.y - ty) ** 2;
    if (d < bestD - 1e-9) {
      best = c;
      bestD = d;
    }
  }
  return { x: best.x / 2, y: best.y / 2 };
}

/** Rotate parts 90° clockwise about (almost) the centre of their bounds (origin stays on the grid, no drift). */
export function rotateOps(project: ProjectModel, ids: Id[]): Op[] {
  const ops: Op[] = [];
  for (const id of ids) {
    const part = project.parts.find((p) => p.id === id);
    const def = part && findPartDef(part.type);
    if (!part || !def) continue;
    const c = rotationPivot(def);
    const wc = localToWorld(part, c);
    const rotation = rotateCW(part.rotation);
    const rc = rotatePoint(c, rotation);
    const x = Math.round(wc.x - rc.x);
    const y = Math.round(wc.y - rc.y);
    ops.push({ op: 'part.rotate', id, rotation });
    if (x !== part.x || y !== part.y) ops.push({ op: 'part.move', id, x, y });
  }
  return ops;
}

/** Wires whose two ends both belong to `parts` (they travel rigidly with a group move). */
export function wiresWithin(project: ProjectModel, parts: ReadonlySet<Id>): Wire[] {
  return project.wires.filter((w) => parts.has(parsePinRef(w.from).part) && parts.has(parsePinRef(w.to).part));
}

export interface MoveSnapshot {
  parts: Map<Id, Point>;
  /** Waypoints of wires fully inside the moved group. */
  wires: Map<Id, Point[]>;
}

export function snapshotMove(project: ProjectModel, ids: ReadonlySet<Id>): MoveSnapshot {
  const parts = new Map<Id, Point>();
  for (const p of project.parts) if (ids.has(p.id)) parts.set(p.id, { x: p.x, y: p.y });
  const wires = new Map<Id, Point[]>();
  for (const w of wiresWithin(project, ids)) if (w.waypoints && w.waypoints.length) wires.set(w.id, w.waypoints.map((q) => ({ ...q })));
  return { parts, wires };
}

/** part.move (+ waypoint translation) ops for a snapshot offset by (dx, dy). */
export function moveOps(snap: MoveSnapshot, dx: number, dy: number): Op[] {
  const ops: Op[] = [];
  for (const [id, o] of snap.parts) ops.push({ op: 'part.move', id, x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
  for (const [id, wps] of snap.wires) {
    ops.push({ op: 'wire.update', id, patch: { waypoints: wps.map((q) => ({ x: Math.round(q.x + dx), y: Math.round(q.y + dy) })) } });
  }
  return ops;
}

/** Index where a new part should be inserted to keep breadboards < boards < components in z. */
export function insertIndexFor(project: ProjectModel, def: PartDef): number | undefined {
  const layer = partLayer(def);
  if (layer === 2) return undefined;
  let idx = 0;
  project.parts.forEach((p, i) => {
    const d = findPartDef(p.type);
    if (d && partLayer(d) <= layer) idx = i + 1;
  });
  return idx;
}

/** Integer origin that puts the part's bounds centre under the world point `p`. */
export function ghostOrigin(def: PartDef, p: Point): Point {
  const b = def.bounds;
  return { x: Math.round(p.x - (b.x + b.w / 2)), y: Math.round(p.y - (b.y + b.h / 2)) };
}

/** A new part instance ready for part.add. */
export function newPartInstance(project: ProjectModel, def: PartDef, origin: Point): PartInstance {
  return {
    id: nextPartId(project, def.idPrefix),
    type: def.type,
    label: nextLabel(project, def.defaultLabel),
    x: Math.round(origin.x),
    y: Math.round(origin.y),
    rotation: 0,
    props: defaultProps(def),
  };
}

export interface DuplicateResult {
  ops: Op[];
  parts: Id[];
  wires: Id[];
  skippedBoard: boolean;
}

/**
 * Copies of `partIds` offset by `offset`, plus the wires among them (and
 * explicitly selected wires whose ends are both copied). A board is never
 * duplicated (only one per project).
 */
export function duplicateOps(project: ProjectModel, partIds: Id[], wireIds: Id[] = [], offset: Point = { x: 2, y: 2 }): DuplicateResult {
  const ops: Op[] = [];
  const takenIds = new Set(project.parts.map((p) => p.id));
  const takenLabels = new Set(project.parts.map((p) => p.label));
  const map = new Map<Id, Id>();
  const newParts: Id[] = [];
  let skippedBoard = false;
  const wanted = new Set(partIds);
  for (const part of project.parts) {
    if (!wanted.has(part.id)) continue;
    const def = findPartDef(part.type);
    if (!def) continue;
    if (isBoard(def)) {
      skippedBoard = true;
      continue;
    }
    const id = nextId(def.idPrefix, takenIds);
    takenIds.add(id);
    let n = 1;
    while (takenLabels.has(`${def.defaultLabel} ${n}`)) n++;
    const label = `${def.defaultLabel} ${n}`;
    takenLabels.add(label);
    map.set(part.id, id);
    newParts.push(id);
    ops.push({
      op: 'part.add',
      part: { ...part, id, label, x: part.x + offset.x, y: part.y + offset.y, props: { ...part.props } },
      index: insertIndexFor(project, def),
    });
  }
  const takenWires = new Set(project.wires.map((w) => w.id));
  const newWires: Id[] = [];
  const explicit = new Set(wireIds);
  for (const w of project.wires) {
    const a = parsePinRef(w.from);
    const b = parsePinRef(w.to);
    const ma = map.get(a.part);
    const mb = map.get(b.part);
    if (!ma || !mb) continue;
    if (!explicit.has(w.id) && !(wanted.has(a.part) && wanted.has(b.part))) continue;
    const id = nextId('w', takenWires);
    takenWires.add(id);
    newWires.push(id);
    const wire: Wire = { id, from: pinRef(ma, a.pin), to: pinRef(mb, b.pin), color: w.color };
    if (w.waypoints?.length) wire.waypoints = w.waypoints.map((q) => ({ x: q.x + offset.x, y: q.y + offset.y }));
    ops.push({ op: 'wire.add', wire });
  }
  return { ops, parts: newParts, wires: newWires, skippedBoard };
}

/** Parts whose world bounds intersect `rect`. */
export function partsInRect(project: ProjectModel, rect: Rect): Id[] {
  const out: Id[] = [];
  for (const p of project.parts) {
    const b = safeWorldBounds(p);
    if (b && rectsIntersect(rect, b)) out.push(p.id);
  }
  return out;
}

/** Wires with at least one end or waypoint inside `rect`. */
export function wiresInRect(project: ProjectModel, rect: Rect): Id[] {
  const idx = getPinIndex(project);
  const inside = (q: Point) => q.x >= rect.x && q.x <= rect.x + rect.w && q.y >= rect.y && q.y <= rect.y + rect.h;
  const out: Id[] = [];
  for (const w of project.wires) {
    const a = idx.byRef.get(w.from);
    const b = idx.byRef.get(w.to);
    const pts: Point[] = [...(a ? [a] : []), ...(w.waypoints ?? []), ...(b ? [b] : [])];
    if (pts.some(inside)) out.push(w.id);
  }
  return out;
}

/** Selection with ids that no longer exist removed. */
export function pruneSelection(project: ProjectModel, sel: Selection): Selection {
  return {
    parts: sel.parts.filter((id) => project.parts.some((p) => p.id === id)),
    wires: sel.wires.filter((id) => project.wires.some((w) => w.id === id)),
  };
}

const strictlyOverlap = (a: Rect, b: Rect, margin: number) =>
  a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin;

/**
 * Integer origin closest to `center` (part centred there) where the new part
 * does not overlap other parts. Components may sit on a breadboard (that is
 * where they belong) but never on a board or another component; boards and
 * breadboards avoid everything. Spiral search, falls back to the centre.
 */
export function findClearSpot(project: ProjectModel, def: PartDef, center: Point, maxRadius = 40): Point {
  const start = ghostOrigin(def, center);
  const placingComponent = partLayer(def) === 2;
  const obstacles: Rect[] = [];
  for (const p of project.parts) {
    const d = findPartDef(p.type);
    if (!d) continue;
    if (placingComponent && partLayer(d) === 0) continue;
    const b = safeWorldBounds(p);
    if (b) obstacles.push(b);
  }
  const b = def.bounds;
  const fits = (o: Point) => {
    const r = { x: o.x + b.x, y: o.y + b.y, w: b.w, h: b.h };
    return !obstacles.some((ob) => strictlyOverlap(r, ob, 0.4));
  };
  if (fits(start)) return start;
  for (let radius = 1; radius <= maxRadius; radius++) {
    let best: Point | null = null;
    let bestD = Infinity;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const o = { x: start.x + dx, y: start.y + dy };
        const d = dx * dx + dy * dy;
        if (d < bestD && fits(o)) {
          best = o;
          bestD = d;
        }
      }
    }
    if (best) return best;
  }
  return start;
}
