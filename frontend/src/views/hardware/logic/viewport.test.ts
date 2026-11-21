import { describe, expect, it } from 'vitest';
import { GRID_PX } from '@/lib/geometry';
import {
  centerOn,
  fitViewport,
  MAX_FIT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  rectContains,
  rectFromPoints,
  screenToWorld,
  visibleWorld,
  wheelZoomFactor,
  worldToScreen,
  zoomAt,
} from './viewport';

describe('viewport math', () => {
  const vp = { scale: 20, tx: 100, ty: 50 };

  it('screen ↔ world are inverses', () => {
    const w = screenToWorld(vp, 340, 210);
    expect(w).toEqual({ x: 12, y: 8 });
    expect(worldToScreen(vp, w.x, w.y)).toEqual({ x: 340, y: 210 });
  });

  it('zoomAt keeps the world point under the cursor fixed', () => {
    const before = screenToWorld(vp, 300, 200);
    const z = zoomAt(vp, 300, 200, 1.7);
    const after = screenToWorld(z, 300, 200);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(z.scale).toBeCloseTo(34);
  });

  it('zoom is clamped', () => {
    expect(zoomAt(vp, 0, 0, 1000).scale).toBe(MAX_SCALE);
    expect(zoomAt(vp, 0, 0, 0.0001).scale).toBe(MIN_SCALE);
  });

  it('fitViewport centres the bounds and never over-zooms', () => {
    const b = { x: 0, y: 0, w: 60, h: 20 };
    const f = fitViewport(b, 1000, 600, 40);
    const c = worldToScreen(f, 30, 10);
    expect(c.x).toBeCloseTo(500);
    expect(c.y).toBeCloseTo(300);
    expect(f.scale).toBeLessThanOrEqual(MAX_FIT_SCALE);
    expect(rectContains(visibleWorld(f, 1000, 600), b)).toBe(true);
    const tiny = fitViewport({ x: 0, y: 0, w: 2, h: 2 }, 1000, 600);
    expect(tiny.scale).toBe(MAX_FIT_SCALE);
    expect(MAX_FIT_SCALE).toBeGreaterThan(GRID_PX);
  });

  it('centerOn keeps the zoom', () => {
    const c = centerOn(vp, { x: 10, y: 10 }, 800, 400);
    expect(c.scale).toBe(vp.scale);
    expect(worldToScreen(c, 10, 10)).toEqual({ x: 400, y: 200 });
  });

  it('wheel zooms in for negative deltas, pinch is more sensitive per unit', () => {
    expect(wheelZoomFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelZoomFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelZoomFactor(-10, 0, true)).toBeGreaterThan(wheelZoomFactor(-10, 0, false));
    expect(wheelZoomFactor(-1, 1, false)).toBeGreaterThan(wheelZoomFactor(-1, 0, false));
  });

  it('rectFromPoints normalises corners', () => {
    expect(rectFromPoints({ x: 5, y: 1 }, { x: 2, y: 4 })).toEqual({ x: 2, y: 1, w: 3, h: 3 });
  });
});
