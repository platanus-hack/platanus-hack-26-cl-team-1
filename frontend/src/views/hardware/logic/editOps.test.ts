import { describe, expect, it } from 'vitest';
import type { Op } from '@/contracts';
import { allPartDefs, getPartDef } from '@/catalog';
import { applyOps } from '@/store/applyOp';
import {
  deleteOps,
  duplicateOps,
  findClearSpot,
  ghostOrigin,
  insertIndexFor,
  moveOps,
  newPartInstance,
  partsInRect,
  pruneSelection,
  rotateOps,
  snapshotMove,
  wiresInRect,
} from './editOps';
import { safeWorldBounds } from './partInfo';
import { part, project, unoAndBreadboard } from './fixtures';

const base = () =>
  project(
    [...unoAndBreadboard(), part('led1', 'led', 45, 6), part('r1', 'resistor', 46, 9)],
    [
      { id: 'w1', from: 'uno1.D13', to: 'bb1.a10', color: 'yellow' },
      { id: 'w2', from: 'led1.anode', to: 'r1.a', color: 'green', waypoints: [{ x: 50, y: 30 }] },
    ],
  );

const ok = (p: ReturnType<typeof base>, ops: Op[]) => {
  const r = applyOps(p, ops);
  if ('error' in r) throw new Error(r.error);
  return r.model;
};

describe('deleteOps', () => {
  it('puts wire.remove before part.remove and applies cleanly', () => {
    const p = base();
    const ops = deleteOps(p, { parts: ['led1'], wires: ['w2', 'w1'] });
    expect(ops.map((o) => o.op)).toEqual(['wire.remove', 'wire.remove', 'part.remove']);
    const m = ok(p, ops);
    expect(m.parts.map((x) => x.id)).toEqual(['uno1', 'bb1', 'r1']);
    expect(m.wires).toEqual([]);
  });

  it('ignores ids that do not exist', () => {
    expect(deleteOps(base(), { parts: ['ghost'], wires: ['w9'] })).toEqual([]);
  });
});

describe('rotateOps', () => {
  it('rotates 90° about the bounds centre, keeping the origin on the grid', () => {
    const p = base();
    const before = safeWorldBounds(p.parts.find((x) => x.id === 'r1')!)!;
    const m = ok(p, rotateOps(p, ['r1']));
    const r1 = m.parts.find((x) => x.id === 'r1')!;
    expect(r1.rotation).toBe(90);
    expect(Number.isInteger(r1.x) && Number.isInteger(r1.y)).toBe(true);
    const after = safeWorldBounds(r1)!;
    const c = (b: typeof before) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    expect(Math.abs(c(after).x - c(before).x)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(c(after).y - c(before).y)).toBeLessThanOrEqual(0.5);
  });

  it('four rotations return EXACTLY to the start for every part type (no drift)', () => {
    for (const def of allPartDefs()) {
      let p = project([part('x1', def.type, 10, 10)]);
      for (let i = 0; i < 4; i++) {
        p = ok(p, rotateOps(p, ['x1']));
        const x = p.parts[0];
        expect(Number.isInteger(x.x) && Number.isInteger(x.y)).toBe(true);
      }
      const x = p.parts[0];
      expect({ type: def.type, x: x.x, y: x.y, r: x.rotation }).toEqual({ type: def.type, x: 10, y: 10, r: 0 });
    }
  });

  it('each rotation keeps the bounds centre within half a hole', () => {
    for (const def of allPartDefs()) {
      let p = project([part('x1', def.type, 10, 10)]);
      for (let i = 0; i < 4; i++) {
        const before = safeWorldBounds(p.parts[0])!;
        p = ok(p, rotateOps(p, ['x1']));
        const after = safeWorldBounds(p.parts[0])!;
        expect(Math.abs(after.x + after.w / 2 - (before.x + before.w / 2))).toBeLessThanOrEqual(0.5);
        expect(Math.abs(after.y + after.h / 2 - (before.y + before.h / 2))).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it('four rotations return to the start', () => {
    let p = base();
    for (let i = 0; i < 4; i++) p = ok(p, rotateOps(p, ['led1']));
    const led = p.parts.find((x) => x.id === 'led1')!;
    expect(led.rotation).toBe(0);
    expect(Math.abs(led.x - 45) + Math.abs(led.y - 6)).toBeLessThanOrEqual(2);
  });
});

describe('moveOps', () => {
  it('moves parts and translates waypoints of wires inside the group', () => {
    const p = base();
    const snap = snapshotMove(p, new Set(['led1', 'r1']));
    expect([...snap.wires.keys()]).toEqual(['w2']);
    const m = ok(p, moveOps(snap, 3, -2));
    expect(m.parts.find((x) => x.id === 'led1')).toMatchObject({ x: 48, y: 4 });
    expect(m.wires.find((w) => w.id === 'w2')!.waypoints).toEqual([{ x: 53, y: 28 }]);
  });

  it('offset 0 restores the snapshot', () => {
    const p = base();
    const snap = snapshotMove(p, new Set(['bb1']));
    const moved = ok(p, moveOps(snap, 5, 5));
    const back = ok(moved, moveOps(snap, 0, 0));
    expect(back.parts.find((x) => x.id === 'bb1')).toMatchObject({ x: 34, y: 0 });
  });
});

describe('duplicateOps', () => {
  it('copies parts with fresh ids/labels and the wires among them', () => {
    const p = base();
    const r = duplicateOps(p, ['led1', 'r1']);
    expect(r.parts).toEqual(['led2', 'r2']);
    expect(r.wires).toEqual(['w3']);
    const m = ok(p, r.ops);
    const w3 = m.wires.find((w) => w.id === 'w3')!;
    expect(w3).toMatchObject({ from: 'led2.anode', to: 'r2.a', color: 'green', waypoints: [{ x: 52, y: 32 }] });
    expect(m.parts.find((x) => x.id === 'led2')).toMatchObject({ x: 47, y: 8, label: 'LED 1' });
  });

  it('never duplicates a board', () => {
    const r = duplicateOps(base(), ['uno1', 'led1']);
    expect(r.skippedBoard).toBe(true);
    expect(r.parts).toEqual(['led2']);
  });

  it('keeps breadboard copies below components', () => {
    const p = base();
    const r = duplicateOps(p, ['bb1']);
    const add = r.ops[0] as Extract<Op, { op: 'part.add' }>;
    expect(add.index).toBe(2);
  });
});

describe('insertIndexFor / newPartInstance / ghostOrigin', () => {
  it('inserts breadboards after other breadboards, boards after boards, components on top', () => {
    const p = base();
    expect(insertIndexFor(p, getPartDef('breadboard-half'))).toBe(2);
    expect(insertIndexFor(p, getPartDef('led'))).toBeUndefined();
    const onlyLed = project([part('led1', 'led', 0, 0)]);
    expect(insertIndexFor(onlyLed, getPartDef('breadboard-half'))).toBe(0);
  });

  it('creates ids, labels and default props', () => {
    const p = base();
    const inst = newPartInstance(p, getPartDef('led'), { x: 3.4, y: 7.6 });
    expect(inst).toMatchObject({ id: 'led2', label: 'LED 1', x: 3, y: 8, rotation: 0, props: { color: 'red' } });
  });

  it('centres the part bounds on the cursor, snapped to integers', () => {
    const led = getPartDef('led'); // bounds x -0.5 w 2 → centre 0.5; y 0 h 3 → 1.5
    expect(ghostOrigin(led, { x: 10.4, y: 10.2 })).toEqual({ x: 10, y: 9 });
  });
});

describe('selection helpers', () => {
  it('finds parts and wires in a marquee', () => {
    const p = base();
    expect(partsInRect(p, { x: 44, y: 5, w: 3, h: 3 }).sort()).toEqual(['bb1', 'led1', 'r1']);
    expect(partsInRect(p, { x: -10, y: -10, w: 2, h: 2 })).toEqual([]);
    expect(wiresInRect(p, { x: 49, y: 29, w: 2, h: 2 })).toEqual(['w2']);
  });

  it('prunes stale ids', () => {
    expect(pruneSelection(base(), { parts: ['led1', 'x'], wires: ['w1', 'w7'] })).toEqual({ parts: ['led1'], wires: ['w1'] });
  });
});

describe('findClearSpot', () => {
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it('keeps the centre when it is free (components may sit on a breadboard)', () => {
    const p = project(unoAndBreadboard());
    const led = getPartDef('led');
    expect(findClearSpot(p, led, { x: 45, y: 7.5 })).toEqual(ghostOrigin(led, { x: 45, y: 7.5 }));
  });

  it('moves a component off a board', () => {
    const p = project(unoAndBreadboard());
    const btn = getPartDef('button');
    const o = findClearSpot(p, btn, { x: 14, y: 10 }); // middle of the Uno
    const r = { x: o.x + btn.bounds.x, y: o.y + btn.bounds.y, w: btn.bounds.w, h: btn.bounds.h };
    expect(overlaps(r, safeWorldBounds(p.parts[0])!)).toBe(false);
  });

  it('a breadboard avoids everything', () => {
    const p = project(unoAndBreadboard());
    const bb = getPartDef('breadboard-half');
    const o = findClearSpot(p, bb, { x: 40, y: 10 });
    const r = { x: o.x, y: o.y, w: bb.bounds.w, h: bb.bounds.h };
    for (const part of p.parts) expect(overlaps(r, safeWorldBounds(part)!)).toBe(false);
  });
});
