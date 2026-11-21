/**
 * Pan/zoom math. A viewport maps world grid units to canvas pixels:
 *   screen = world * scale + (tx, ty)
 * `scale` = CSS px per grid unit (GRID_PX at zoom 100 %).
 */
import type { Point } from '@/contracts';
import { GRID_PX } from '@/lib/geometry';

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_SCALE = GRID_PX * 0.2;
export const MAX_SCALE = GRID_PX * 6;
/** Fit never zooms in further than this (keeps tiny projects readable but not huge). */
export const MAX_FIT_SCALE = GRID_PX * 2.4;

export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function screenToWorld(vp: Viewport, sx: number, sy: number): Point {
  return { x: (sx - vp.tx) / vp.scale, y: (sy - vp.ty) / vp.scale };
}

export function worldToScreen(vp: Viewport, x: number, y: number): Point {
  return { x: x * vp.scale + vp.tx, y: y * vp.scale + vp.ty };
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed. */
export function zoomAt(vp: Viewport, sx: number, sy: number, factor: number): Viewport {
  const scale = clampScale(vp.scale * factor);
  const k = scale / vp.scale;
  return { scale, tx: sx - (sx - vp.tx) * k, ty: sy - (sy - vp.ty) * k };
}

/** Viewport that shows `bounds` centred in a `width`×`height` canvas with `margin` px around. */
export function fitViewport(bounds: Rect, width: number, height: number, margin = 48): Viewport {
  const w = Math.max(1, width - margin * 2);
  const h = Math.max(1, height - margin * 2);
  const raw = Math.min(w / Math.max(1, bounds.w), h / Math.max(1, bounds.h));
  const scale = Math.min(MAX_FIT_SCALE, clampScale(raw));
  const cx = bounds.x + bounds.w / 2;
  const cy = bounds.y + bounds.h / 2;
  return { scale, tx: width / 2 - cx * scale, ty: height / 2 - cy * scale };
}

/** Centre the viewport on a world point without changing the zoom. */
export function centerOn(vp: Viewport, p: Point, width: number, height: number): Viewport {
  return { scale: vp.scale, tx: width / 2 - p.x * vp.scale, ty: height / 2 - p.y * vp.scale };
}

/** Multiplicative zoom factor for a wheel event (pinch gestures arrive as ctrl+wheel with small deltas). */
export function wheelZoomFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  let dy = deltaY;
  if (deltaMode === 1) dy *= 16; // lines
  else if (deltaMode === 2) dy *= 400; // pages
  const k = ctrlKey ? 0.01 : 0.0018;
  const clamped = Math.max(-120, Math.min(120, dy));
  return Math.exp(-clamped * k);
}

/** Visible world rectangle. */
export function visibleWorld(vp: Viewport, width: number, height: number): Rect {
  const a = screenToWorld(vp, 0, 0);
  return { x: a.x, y: a.y, w: width / vp.scale, h: height / vp.scale };
}

export const rectContains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const rectsIntersect = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;

/** Normalised rectangle from two corners. */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}
