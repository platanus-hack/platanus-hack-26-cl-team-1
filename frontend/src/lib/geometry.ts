import type { PartDef, PartInstance, Point, ProjectModel, Rotation } from '@/contracts';
import { findPartDef, getPartDef } from '@/catalog';

/** Grid unit → CSS pixels at zoom 1 (the canvas multiplies by its zoom). */
export const GRID_PX = 16;

/** Rotate a local point clockwise by `rot` degrees about the origin (y axis points down). */
export function rotatePoint(p: Point, rot: Rotation): Point {
  switch (rot) {
    case 90:
      return { x: -p.y, y: p.x };
    case 180:
      return { x: -p.x, y: -p.y };
    case 270:
      return { x: p.y, y: -p.x };
    default:
      return { x: p.x, y: p.y };
  }
}

/** Local (part) coordinates → world grid coordinates. */
export function localToWorld(part: Pick<PartInstance, 'x' | 'y' | 'rotation'>, p: Point): Point {
  const r = rotatePoint(p, part.rotation);
  return { x: part.x + r.x, y: part.y + r.y };
}

/** World pin position of `pinId` on `part`, or null if the pin does not exist. */
export function pinWorldPosition(part: PartInstance, pinId: string, def: PartDef = getPartDef(part.type)): Point | null {
  const pin = def.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  return localToWorld(part, pin);
}

/** Axis-aligned world bounds of a part (after rotation). */
export function partWorldBounds(part: PartInstance, def: PartDef = getPartDef(part.type)) {
  const b = def.bounds;
  const corners = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x, y: b.y + b.h },
    { x: b.x + b.w, y: b.y + b.h },
  ].map((c) => localToWorld(part, c));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** Bounds of everything in the project (grid units), with padding. */
export function projectBounds(project: ProjectModel, pad = 4) {
  if (project.parts.length === 0) return { x: -pad, y: -pad, w: 60 + 2 * pad, h: 30 + 2 * pad };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (!def) continue; // unknown type (old/imported file): skip instead of throwing
    const b = partWorldBounds(part, def);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
}

export const snap = (v: number) => Math.round(v);

export const rotateCW = (r: Rotation): Rotation => (((r + 90) % 360) as Rotation);
