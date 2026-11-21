import type { Id, PartDef, Point, ProjectModel, Rotation } from '@/contracts';
import { findPartDef } from '@/catalog';
import { partWorldBounds } from '@/lib/geometry';
import { type Rect, rectsOverlap, unionRect } from './space';

/** Clearance (grid units) kept between part bodies in free space. */
export const FREE_GAP = 3;

const FALLBACK_BOUNDS = { x: 0, y: 0, w: 10, h: 10 };

/** Bounds of a part of `def` at origin (0,0) with the given rotation. */
export function localRect(def: PartDef | undefined, rotation: Rotation = 0): Rect {
  if (!def) return FALLBACK_BOUNDS;
  return partWorldBounds({ id: '_', type: def.type, label: '', x: 0, y: 0, rotation, props: {} }, def);
}

interface Candidate {
  rect: Rect;
  cost: number;
}

/**
 * Free top-left spot (returned as the part ORIGIN) for a part of `type`,
 * not overlapping any other part (with FREE_GAP clearance). Prefers the
 * right of / below the `near` part (or of everything when no `near`).
 */
export function findFreeSpot(project: ProjectModel, type: string, near?: Id, rotation: Rotation = 0): Point {
  const def = findPartDef(type);
  const local = localRect(def, rotation);
  const rects = project.parts.map((p) => {
    const d = findPartDef(p.type);
    return { id: p.id, rect: d ? partWorldBounds(p, d) : { x: p.x, y: p.y, w: 1, h: 1 } };
  });
  const toOrigin = (r: Rect): Point => ({ x: Math.round(r.x - local.x), y: Math.round(r.y - local.y) });
  if (rects.length === 0) return toOrigin({ x: 0, y: 0, w: local.w, h: local.h });

  const nearRect = near ? rects.find((r) => r.id === near)?.rect : undefined;
  const all = unionRect(rects.map((r) => r.rect))!;
  const anchor = nearRect ?? all;
  const fits = (r: Rect) => !rects.some((o) => rectsOverlap(r, o.rect, FREE_GAP - 0.01));
  const at = (x: number, y: number): Rect => ({ x: Math.ceil(x), y: Math.ceil(y), w: local.w, h: local.h });

  const best: Candidate[] = [];
  const scan = (make: (k: number) => Rect, base: number, steps: number) => {
    for (let k = 0; k <= steps; k++) {
      const r = make(k);
      if (fits(r)) {
        best.push({ rect: r, cost: base + k });
        return;
      }
    }
  };
  const right = anchor.x + anchor.w + FREE_GAP;
  const below = anchor.y + anchor.h + FREE_GAP;
  scan((k) => at(right, anchor.y + k), 0, 80);
  scan((k) => at(anchor.x + k, below), 1, 120);
  if (nearRect) {
    scan((k) => at(anchor.x - FREE_GAP - local.w, anchor.y + k), 25, 60);
    scan((k) => at(anchor.x + k, anchor.y - FREE_GAP - local.h), 35, 60);
  }
  if (best.length === 0) return toOrigin(at(all.x + all.w + FREE_GAP, all.y));

  // Without `near`, keep the whole layout close to a 16:10 viewport.
  const scored = best.map((c) => {
    if (nearRect) return c;
    const u = unionRect([all, c.rect])!;
    const aspect = u.w / Math.max(1, u.h);
    return { ...c, cost: c.cost + Math.abs(Math.log(aspect / 1.6)) * 20 };
  });
  scored.sort((a, b) => a.cost - b.cost);
  return toOrigin(scored[0].rect);
}
