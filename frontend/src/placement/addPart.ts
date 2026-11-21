/**
 * planAddPart: chooses an id, label and position for a new part and returns
 * the `part.add` op. Insertable parts are pushed into the breadboard so that
 * every leg lands in its own, still unused strip (no accidental connections).
 */
import type { PartDef, PartInstance, PinRef, Point, ProjectModel, PropValue, Rotation } from '@/contracts';
import { BB_ROW_Y, defaultProps, findPartDef, projectBoard } from '@/catalog';
import { localToWorld, partWorldBounds, rotatePoint } from '@/lib/geometry';
import { nextLabel, nextPartId } from '@/lib/ids';
import type { PlanAddPartOptions, PlanAddPartResult } from './types';
import { FREE_GAP, findFreeSpot, localRect } from './freeSpot';
import {
  type BreadboardModel,
  type HoleInfo,
  type Occupancy,
  buildOccupancy,
  coversPoint,
  isBoardPartDef,
  isBreadboardDef,
  pointKey,
  rectsOverlap,
} from './space';

/** Parts this big (grid units²) sit next to the breadboard in 'auto' mode and are wired with jumpers. */
const BULKY_AREA = 60;
const ROTATIONS: Rotation[] = [0, 180, 90, 270];

export interface BreadboardSpot {
  x: number;
  y: number;
  rotation: Rotation;
  holes: Record<string, PinRef>;
  bb: string;
  cost: number;
}

const isBulky = (def: PartDef) => def.bounds.w * def.bounds.h > BULKY_AREA && !isBoardPartDef(def);

function stripNeighbours(bb: BreadboardModel, h: HoleInfo): string[] {
  if (h.kind !== 'main' || !h.row) return [];
  const out: string[] = [];
  for (const dc of [-1, 1]) {
    const n = bb.byId.get(`${h.row}${h.col + dc}`);
    if (n) out.push(n.strip);
  }
  return out;
}

/**
 * Best breadboard position for `part` (its type/props), or null. Rules:
 * every pin on a main hole, all strips distinct and unused, no rail holes,
 * holes not covered, body not overlapping other parts nor sitting on a hole
 * that holds a leg or a wire end. Preferences (cost):
 * rotation 0, topmost pins on row e (top half), an empty column on each side,
 * left to right, away from columns covered by a board, close to `at`.
 */
export function findBreadboardSpot(
  project: ProjectModel,
  part: PartInstance,
  def: PartDef,
  opts: { at?: Point; rotation?: Rotation; bb?: string; occ?: Occupancy; near?: Point } = {},
): BreadboardSpot | null {
  if (def.pins.length === 0) return null;
  const occ = opts.occ ?? buildOccupancy(project, part.id);
  const boards = opts.bb ? occ.boards.filter((b) => b.part.id === opts.bb) : occ.boards;
  // Columns that have holes under a board body (ESP32 devkit): avoid.
  const boardIds = new Set(
    project.parts
      .filter((p) => {
        const d = findPartDef(p.type);
        return p.id !== part.id && !!d && isBoardPartDef(d);
      })
      .map((p) => p.id),
  );
  const coveredCols = new Set<string>();
  for (const r of occ.partRects) {
    if (!boardIds.has(r.id)) continue;
    for (const bb of boards) for (const h of bb.holes) if (coversPoint(r.rect, h)) coveredCols.add(`${h.bb}:${h.col}`);
  }

  // Holes holding a leg or a wire end: the new body must not sit on them.
  const usedHoles = [...occ.occupied, ...occ.wired].map((ref) => occ.holeByRef.get(ref)).filter((h): h is HoleInfo => !!h);

  let best: BreadboardSpot | null = null;
  for (const bb of boards) {
    for (const rotation of opts.rotation !== undefined ? [opts.rotation] : ROTATIONS) {
      const offs = def.pins.map((p) => rotatePoint(p, rotation));
      const o0 = offs[0];
      for (const anchor of bb.holes) {
        if (anchor.kind !== 'main') continue;
        const x = anchor.x - o0.x, y = anchor.y - o0.y;
        if (!Number.isInteger(x) || !Number.isInteger(y)) continue;
        const holes: HoleInfo[] = [];
        let ok = true;
        const strips = new Set<string>();
        for (const o of offs) {
          const h = occ.holeAt.get(pointKey({ x: x + o.x, y: y + o.y }));
          if (!h || h.bb !== bb.part.id || h.kind !== 'main' || strips.has(h.strip) || occ.usedStrips.has(h.strip) || occ.covered.has(h.ref) || occ.occupied.has(h.ref)) {
            ok = false;
            break;
          }
          strips.add(h.strip);
          holes.push(h);
        }
        if (!ok) continue;
        const rect = partWorldBounds({ ...part, x, y, rotation }, def);
        if (occ.partRects.some((r) => r.id !== part.id && rectsOverlap(rect, r.rect))) continue;
        if (usedHoles.some((h) => coversPoint(rect, h))) continue;

        let cost = rotation === 0 ? 0 : rotation === 180 ? 30 : 45;
        const topLy = Math.min(...holes.map((h) => h.ly));
        cost += Math.abs(topLy - BB_ROW_Y.e) * 30;
        if (holes.every((h) => h.half === 'bottom')) cost += 20;
        for (const h of holes) {
          for (const n of stripNeighbours(bb, h)) {
            if (strips.has(n)) continue;
            const owners = occ.stripParts.get(n);
            if (owners && [...owners].some((id) => !boardIds.has(id))) cost += 25;
            else if (occ.usedStrips.has(n)) cost += 8;
          }
          if (coveredCols.has(`${h.bb}:${h.col}`)) cost += 200;
        }
        cost += Math.min(...holes.map((h) => h.col));
        if (opts.at) cost += (Math.abs(x - opts.at.x) + Math.abs(y - opts.at.y)) * 60;
        if (opts.near) cost += Math.abs(rect.x + rect.w / 2 - opts.near.x) * 3 + Math.abs(rect.y + rect.h / 2 - opts.near.y);

        if (!best || cost < best.cost) {
          const map: Record<string, PinRef> = {};
          def.pins.forEach((p, i) => (map[p.id] = holes[i].ref));
          best = { x, y, rotation, holes: map, bb: bb.part.id, cost };
        }
      }
    }
  }
  return best;
}

function fail(error: string): PlanAddPartResult {
  return { ops: [], id: '', label: '', error };
}

function freeFits(project: ProjectModel, def: PartDef, p: Point, rotation: Rotation): boolean {
  const rect = partWorldBounds({ id: '_', type: def.type, label: '', x: p.x, y: p.y, rotation, props: {} }, def);
  return !project.parts.some((o) => {
    const d = findPartDef(o.type);
    return d ? rectsOverlap(rect, partWorldBounds(o, d), FREE_GAP - 0.01) : false;
  });
}

function boardSpot(project: ProjectModel, def: PartDef): Point {
  const bb = project.parts.find((p) => findPartDef(p.type)?.electrical.model === 'bus');
  if (!bb) {
    if (project.parts.length === 0) return { x: 0, y: 0 };
    return findFreeSpot(project, def.type);
  }
  const bbRect = partWorldBounds(bb);
  const local = localRect(def);
  const cand = { x: Math.round(bbRect.x - 6 - local.w - local.x), y: Math.round(bbRect.y - local.y) };
  return freeFits(project, def, cand, 0) ? cand : findFreeSpot(project, def.type, bb.id);
}

function breadboardSpotForBreadboard(project: ProjectModel, def: PartDef): Point {
  if (project.parts.length === 0) return { x: 0, y: 0 };
  const board = projectBoard(project);
  if (board && project.parts.length === 1) {
    const r = partWorldBounds(board.part);
    const cand = { x: Math.round(r.x + r.w + 6 - def.bounds.x), y: Math.round(r.y - def.bounds.y) };
    if (freeFits(project, def, cand, 0)) return cand;
  }
  return findFreeSpot(project, def.type, board?.part.id);
}

/** Validate / normalise user props against the PartDef (Spanish error for bad enum values). */
export function normalizeProps(def: PartDef, props: Record<string, PropValue> = {}): { props: Record<string, PropValue>; error?: string } {
  const out: Record<string, PropValue> = { ...defaultProps(def) };
  for (const [key, raw] of Object.entries(props)) {
    const pd = def.props.find((p) => p.key === key);
    if (!pd) {
      const keys = def.props.map((p) => p.key).join(', ');
      return { props: out, error: `${def.name} no tiene la propiedad «${key}»${keys ? ` (propiedades: ${keys})` : ''}.` };
    }
    if (pd.type === 'enum' && pd.options) {
      const opt = pd.options.find((o) => String(o.value) === String(raw));
      if (!opt) return { props: out, error: `Valor inválido para ${pd.label}: «${raw}». Opciones: ${pd.options.map((o) => o.value).join(', ')}.` };
      out[key] = opt.value;
    } else if (pd.type === 'number') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { props: out, error: `${pd.label} debe ser un número.` };
      out[key] = Math.min(pd.max ?? Infinity, Math.max(pd.min ?? -Infinity, n));
    } else if (pd.type === 'boolean') out[key] = raw === true || raw === 'true';
    else out[key] = raw;
  }
  return { props: out };
}

export function planAddPart(project: ProjectModel, type: string, opts: PlanAddPartOptions = {}): PlanAddPartResult {
  const def = findPartDef(type);
  if (!def) return fail(`No conozco el componente «${type}». Revisa el nombre del tipo en la biblioteca.`);
  const norm = normalizeProps(def, opts.props);
  if (norm.error) return fail(norm.error);
  const placement = opts.placement ?? 'auto';
  const id = nextPartId(project, def.idPrefix);
  const label = opts.label?.trim() || nextLabel(project, def.defaultLabel);
  const rotation: Rotation = opts.rotation ?? 0;
  const part: PartInstance = { id, type, label, x: 0, y: 0, rotation, props: norm.props };
  const done = (p: Point, rot: Rotation, extra: Partial<PlanAddPartResult> = {}): PlanAddPartResult => ({
    ops: [{ op: 'part.add', part: { ...part, x: Math.round(p.x), y: Math.round(p.y), rotation: rot } }],
    id,
    label,
    ...extra,
  });

  if (isBoardPartDef(def)) {
    const existing = projectBoard(project);
    if (existing) {
      return fail(`El proyecto ya tiene una placa (${existing.part.label}). Solo se admite una placa por proyecto: elimínala primero si quieres cambiarla.`);
    }
    if (placement === 'free' && opts.at) return done(opts.at, rotation);
    if (def.breadboard.insertable && placement !== 'free') {
      const bb = project.parts.find((p) => findPartDef(p.type)?.electrical.model === 'bus');
      if (bb) {
        // Straddle the centre channel like createStarterProject('esp32c6'): J1 on row c, J3 on row j.
        const at = opts.at ?? localToWorld(bb, { x: 0, y: 6 });
        const spot = findBreadboardSpot(project, part, def, { at, rotation: opts.rotation ?? bb.rotation, bb: bb.id });
        if (spot) return done(spot, spot.rotation, { holes: spot.holes });
        return done(boardSpot(project, def), rotation, { note: 'No había columnas libres para montar la placa sobre la protoboard: la dejé al lado.' });
      }
    }
    return done(boardSpot(project, def), rotation);
  }

  if (isBreadboardDef(def)) {
    return done(opts.at && placement === 'free' ? opts.at : breadboardSpotForBreadboard(project, def), rotation);
  }

  const hasBreadboard = project.parts.some((p) => findPartDef(p.type)?.electrical.model === 'bus');
  const wantsBreadboard =
    def.breadboard.insertable && hasBreadboard && (placement === 'breadboard' || (placement === 'auto' && !isBulky(def)));
  if (wantsBreadboard) {
    const nearPart = opts.near ? project.parts.find((p) => p.id === opts.near) : undefined;
    const nearRect = nearPart && findPartDef(nearPart.type)?.electrical.model !== 'bus' ? partWorldBounds(nearPart) : undefined;
    const nearPoint = nearRect ? { x: nearRect.x + nearRect.w / 2, y: nearRect.y + nearRect.h / 2 } : undefined;
    const spot = findBreadboardSpot(project, part, def, { at: opts.at, rotation: opts.rotation, near: nearPoint });
    if (spot) return done(spot, spot.rotation, { holes: spot.holes });
    const bbId = project.parts.find((p) => findPartDef(p.type)?.electrical.model === 'bus')?.id;
    return done(findFreeSpot(project, type, opts.near ?? bbId, rotation), rotation, {
      note: 'No encontré columnas libres en la protoboard: dejé el componente al lado. Conéctalo con cables.',
    });
  }
  if (placement === 'free' && opts.at) return done(opts.at, rotation);
  let near = opts.near;
  if (!near && def.breadboard.insertable) near = project.parts.find((p) => findPartDef(p.type)?.electrical.model === 'bus')?.id;
  const note =
    placement !== 'free' && def.breadboard.insertable && hasBreadboard
      ? 'Lo dejé junto a la protoboard porque es grande: conecta sus terminales con cables.'
      : placement === 'breadboard' && !hasBreadboard
        ? 'No hay protoboard en el proyecto: lo dejé en un espacio libre.'
        : undefined;
  return done(findFreeSpot(project, type, near, rotation), rotation, note ? { note } : {});
}
