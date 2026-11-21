/**
 * Helpers to build small ProjectModels by hand (used by the circuit tests and
 * handy for other modules' tests). Not part of the runtime API.
 */
import type { PartInstance, Point, ProjectModel, PropValue, Rotation, Wire } from '@/contracts';
import { BB_ROW_Y, bbColX, findPartDef, parseHole } from '@/catalog';
import { rotatePoint } from '@/lib/geometry';

const RAIL_Y: Record<string, number> = { 'T+': 1, 'T-': 2, 'B+': 19, 'B-': 20 };

/** World position of a breadboard hole ('e10', 'T+3') for a breadboard at (bb.x, bb.y), rotation 0. */
export function holePos(bb: Pick<PartInstance, 'x' | 'y'>, hole: string): Point {
  const h = parseHole(hole);
  if (!h) throw new Error(`bad hole ${hole}`);
  const y = h.kind === 'main' ? BB_ROW_Y[h.row] : RAIL_Y[h.rail];
  return { x: bb.x + bbColX(h.col), y: bb.y + y };
}

/** Part placed so that `pinId` lands exactly on `pos`. */
export function placeBy(
  id: string,
  type: string,
  pinId: string,
  pos: Point,
  props: Record<string, PropValue> = {},
  rotation: Rotation = 0,
): PartInstance {
  const def = findPartDef(type);
  const pin = def?.pins.find((p) => p.id === pinId);
  if (!def || !pin) throw new Error(`unknown ${type}.${pinId}`);
  const r = rotatePoint(pin, rotation);
  return { id, type, label: `${def.defaultLabel} ${id.replace(/^\D+/, '')}`.trim(), x: pos.x - r.x, y: pos.y - r.y, rotation, props };
}

export function part(id: string, type: string, x: number, y: number, props: Record<string, PropValue> = {}, rotation: Rotation = 0): PartInstance {
  const def = findPartDef(type);
  return { id, type, label: `${def?.defaultLabel ?? type} ${id.replace(/^\D+/, '')}`.trim(), x, y, rotation, props };
}

let projectSeq = 0;

export function makeProject(parts: PartInstance[], wires: Array<[string, string]> = []): ProjectModel {
  const now = new Date(0).toISOString();
  return {
    version: 1,
    id: `test${++projectSeq}`,
    name: 'test',
    parts,
    wires: wires.map(([from, to], i): Wire => ({ id: `w${i + 1}`, from, to, color: 'red' })),
    program: { workspace: null },
    meta: { createdAt: now, updatedAt: now },
  };
}

/** Uno at (0,0) + breadboard at (34,0), like the starter project. */
export const UNO = (): PartInstance => part('uno1', 'arduino-uno', 0, 0);
export const BB = (x = 34, y = 0): PartInstance => part('bb1', 'breadboard-half', x, y);
