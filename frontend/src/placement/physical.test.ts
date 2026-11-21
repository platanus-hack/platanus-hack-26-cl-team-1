/**
 * Physical-buildability rules of the placement planner: every wire end must be
 * a hole a real jumper can go into (not covered by a body, not holding a leg or
 * another wire), header pins pushed into the breadboard are reached through a
 * free hole of their column, and a new part body never sits on a used hole.
 */
import { describe, expect, it } from 'vitest';
import type { Op, ProjectModel } from '@/contracts';
import { findPartDef } from '@/catalog';
import { applyOps } from '@/store/applyOp';
import { createStarterProject } from '@/store/newProject';
import { buildOccupancy, computeNetlist, planAddPart, planConnect, planDisconnect } from '@/placement';

function apply(p: ProjectModel, ops: Op[]): ProjectModel {
  const r = applyOps(p, ops);
  if ('error' in r) throw new Error(r.error);
  return r.model;
}

const sameNet = (p: ProjectModel, a: string, b: string) => {
  const n = computeNetlist(p);
  return n.pinNet[a] !== undefined && n.pinNet[a] === n.pinNet[b];
};

function connect(p: ProjectModel, a: string, b: string) {
  const r = planConnect(p, a, b);
  expect(r.error).toBeUndefined();
  expect(r.ops).toHaveLength(1);
  return { project: apply(p, r.ops), r };
}

describe('planConnect: wire ends go into free holes', () => {
  it('reroutes a hole covered by the ESP32 body to a free hole of the same strip', () => {
    const p = createStarterProject('esp32c6');
    const occ = buildOccupancy(p);
    expect(occ.covered.has('bb1.e5')).toBe(true);
    const { project, r } = connect(p, 'bb1.e5', 'bb1.T-3');
    expect(occ.covered.has(r.from)).toBe(false);
    expect(occ.occupied.has(r.from)).toBe(false);
    expect(occ.holeByRef.get(r.from)!.strip).toBe(occ.holeByRef.get('bb1.e5')!.strip);
    expect(sameNet(project, 'bb1.e5', 'bb1.T-3')).toBe(true);
  });

  it('reroutes a hole that already holds a leg', () => {
    let p = createStarterProject('uno');
    const led = planAddPart(p, 'led');
    p = apply(p, led.ops);
    const anodeHole = led.holes!.anode;
    const { project, r } = connect(p, anodeHole, 'uno1.D13');
    const occ = buildOccupancy(p);
    expect(r.from).not.toBe(anodeHole);
    expect(occ.holeByRef.get(r.from)!.strip).toBe(occ.holeByRef.get(anodeHole)!.strip);
    expect(sameNet(project, 'led1.anode', 'uno1.D13')).toBe(true);
  });

  it('never puts two wire ends in the same hole, and disconnects symmetrically', () => {
    let p = createStarterProject('uno');
    const first = connect(p, 'uno1.5V', 'bb1.T+1');
    p = first.project;
    const second = connect(p, 'bb1.a5', 'bb1.T+1');
    expect(second.r.to).not.toBe('bb1.T+1');
    expect(second.r.to).toMatch(/^bb1\.T\+\d+$/);
    p = second.project;
    expect(sameNet(p, 'bb1.a5', 'uno1.5V')).toBe(true);
    const d = planDisconnect(p, { from: 'bb1.a5', to: 'bb1.T+1' });
    expect(d.error).toBeUndefined();
    expect(d.removed).toEqual([second.r.wireId]);
    // A single-ended query on a hole stays exact (does not sweep the whole rail).
    expect(planDisconnect(p, { from: 'bb1.T+1' }).removed).toEqual([first.r.wireId]);
  });

  it('wires an ESP32 header pin from a free hole of its column (J1) and explains when there is none (J3)', () => {
    const p = createStarterProject('esp32c6');
    const occ = buildOccupancy(p);
    const j1 = connect(p, 'esp1.GPIO4', 'bb1.T-14');
    expect(j1.r.from).toMatch(/^bb1\.[ab]15$/); // GPIO4 sits in c15; d15/e15 are under the board
    expect(occ.covered.has(j1.r.from)).toBe(false);
    expect(sameNet(j1.project, 'esp1.GPIO4', 'bb1.T-14')).toBe(true);
    const back = planDisconnect(j1.project, { from: 'esp1.GPIO4', to: 'bb1.T-14' });
    expect(back.removed).toEqual([j1.r.wireId]);

    const j3 = connect(p, 'esp1.GPIO21', 'bb1.B-25');
    expect(j3.r.from).toBe('esp1.GPIO21'); // its whole f–j column is under the board
    expect(j3.r.note).toMatch(/no tiene agujeros libres/);
  });

  it('never reroutes an Uno header socket (female) even when it lies over a breadboard hole', () => {
    let p = createStarterProject('uno');
    const d13 = findPartDef('arduino-uno')!.pins.find((x) => x.id === 'D13')!;
    const a1 = buildOccupancy(p).holeByRef.get('bb1.a1')!;
    // Move the Uno so its D13 socket sits exactly on hole a1 (female–female: not connected).
    p = apply(p, [{ op: 'part.move', id: 'uno1', x: a1.x - d13.x, y: a1.y - d13.y }]);
    expect(computeNetlist(p).pinNet['uno1.D13']).not.toBe(computeNetlist(p).pinNet['bb1.a1']);
    const r = planConnect(p, 'uno1.D13', 'bb1.B+25');
    expect(r.from).toBe('uno1.D13');
  });
});

describe('planAddPart: bodies never sit on used holes', () => {
  it('does not straddle an ESP32 over a jumper end', () => {
    let p = createStarterProject(null);
    p = apply(p, [{ op: 'wire.add', wire: { id: 'w1', from: 'bb1.d19', to: 'bb1.T-19', color: 'black' } }]);
    const r = planAddPart(p, 'esp32c6-devkit');
    expect(r.error).toBeUndefined();
    const q = apply(p, r.ops);
    expect(buildOccupancy(q).covered.has('bb1.d19')).toBe(false);
  });

  it('does not lay a part body over a leg or wire end of another strip', () => {
    for (const type of ['resistor', 'diode', 'buzzer', 'potentiometer', 'led-rgb', 'button']) {
      let p = createStarterProject('uno');
      // Wire ends on the e row of columns 2..4 (where a horizontal resistor body would lie).
      p = apply(p, [
        { op: 'wire.add', wire: { id: 'w1', from: 'bb1.e3', to: 'uno1.D13', color: 'yellow' } },
        { op: 'wire.add', wire: { id: 'w2', from: 'bb1.c9', to: 'uno1.D12', color: 'green' } },
      ]);
      const before = buildOccupancy(p);
      const used = [...before.occupied, ...before.wired];
      const r = planAddPart(p, type);
      const after = buildOccupancy(apply(p, r.ops));
      for (const h of used) expect(after.covered.has(h), `${type} covers ${h}`).toBe(false);
    }
  });
});
