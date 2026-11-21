import { describe, expect, it } from 'vitest';
import type { Op, ProjectModel } from '@/contracts';
import { findPartDef } from '@/catalog';
import { localToWorld, partWorldBounds } from '@/lib/geometry';
import { applyOps } from '@/store/applyOp';
import { createEmptyProject, createStarterProject } from '@/store/newProject';
import { buildOccupancy, computeNetlist, coveredHoles, findFreeSpot, planAddPart, planConnect, planDisconnect } from '@/placement';

function apply(p: ProjectModel, ops: Op[]): ProjectModel {
  const r = applyOps(p, ops);
  if ('error' in r) throw new Error(r.error);
  return r.model;
}

function add(p: ProjectModel, type: string, opts = {}) {
  const r = planAddPart(p, type, opts);
  expect(r.error).toBeUndefined();
  return { project: apply(p, r.ops), r };
}

function connect(p: ProjectModel, a: string, b: string) {
  const r = planConnect(p, a, b);
  expect(r.error).toBeUndefined();
  return { project: apply(p, r.ops), r };
}

const sameNet = (p: ProjectModel, a: string, b: string) => {
  const n = computeNetlist(p);
  return n.pinNet[a] !== undefined && n.pinNet[a] === n.pinNet[b];
};

describe('planAddPart', () => {
  it('puts a resistor and a LED on distinct, unused breadboard strips', () => {
    let p = createStarterProject('uno');
    ({ project: p } = add(p, 'resistor', { props: { resistance: 220 } }));
    const { project, r: led } = add(p, 'led', { props: { color: 'green' } });
    p = project;
    expect(led.id).toBe('led1');
    expect(led.label).toBe('LED 1');
    expect(led.holes).toBeDefined();

    const occ = buildOccupancy(p);
    const strips = new Map<string, string>();
    for (const part of p.parts) {
      const def = findPartDef(part.type)!;
      if (def.electrical.model === 'bus' || def.electrical.model === 'mcu') continue;
      for (const pin of def.pins) {
        const h = occ.holeAt.get(`${localToWorld(part, pin).x},${localToWorld(part, pin).y}`);
        expect(h, `${part.id}.${pin.id} should be in a hole`).toBeDefined();
        expect(h!.kind).toBe('main');
        expect(strips.has(h!.strip), `strip of ${part.id}.${pin.id} already used by ${strips.get(h!.strip)}`).toBe(false);
        strips.set(h!.strip, `${part.id}.${pin.id}`);
      }
    }
    // Nothing is accidentally connected: LED legs and resistor legs are all in different nets.
    const n = computeNetlist(p);
    const nets = new Set(['r1.a', 'r1.b', 'led1.anode', 'led1.cathode'].map((x) => n.pinNet[x]));
    expect(nets.size).toBe(4);
    // Preferred layout: horizontal on row e of the top half.
    expect(led.holes!.anode).toMatch(/^bb1\.e\d+$/);
    expect(led.holes!.cathode).toMatch(/^bb1\.e\d+$/);
    // Bodies do not overlap.
    const r1 = partWorldBounds(p.parts.find((x) => x.id === 'r1')!);
    const l1 = partWorldBounds(p.parts.find((x) => x.id === 'led1')!);
    expect(r1.x + r1.w <= l1.x || l1.x + l1.w <= r1.x || r1.y + r1.h <= l1.y || l1.y + l1.h <= r1.y).toBe(true);
  });

  it('makes a push button straddle the centre channel (rows e/f)', () => {
    const { r } = add(createStarterProject('uno'), 'button');
    expect(r.holes!.a1).toMatch(/^bb1\.e\d+$/);
    expect(r.holes!.a2).toMatch(/^bb1\.f\d+$/);
  });

  it('rejects a second board with a Spanish error', () => {
    const r = planAddPart(createStarterProject('uno'), 'esp32c6-devkit');
    expect(r.ops).toEqual([]);
    expect(r.error).toMatch(/ya tiene una placa/);
  });

  it('straddles an ESP32-C6 like the starter project and keeps parts off its columns', () => {
    let p = createStarterProject(null);
    const esp = add(p, 'esp32c6-devkit');
    p = esp.project;
    expect(esp.r.holes!.GPIO4).toMatch(/^bb1\.c\d+$/);
    expect(esp.r.holes!.GND2).toMatch(/^bb1\.j\d+$/);
    const covered = coveredHoles(p);
    expect(covered.has('bb1.e5')).toBe(true);
    expect(covered.has('bb1.a5')).toBe(false);
    const led = add(p, 'led').r;
    const col = Number(/\d+$/.exec(led.holes!.anode)![0]);
    expect(col).toBeGreaterThanOrEqual(21);
  });

  it('places bulky parts and boards in free space without overlaps', () => {
    let p = createEmptyProject();
    ({ project: p } = add(p, 'breadboard-half'));
    const uno = add(p, 'arduino-uno');
    p = uno.project;
    const bb = partWorldBounds(p.parts[0]);
    const board = partWorldBounds(p.parts[1]);
    expect(board.x + board.w).toBeLessThanOrEqual(bb.x); // left of the breadboard
    const servo = add(p, 'servo-sg90');
    expect(servo.r.holes).toBeUndefined();
    p = servo.project;
    const rects = p.parts.map((x) => partWorldBounds(x));
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    const spot = findFreeSpot(p, 'motor-dc');
    const m = partWorldBounds({ id: 'm', type: 'motor-dc', label: '', x: spot.x, y: spot.y, rotation: 0, props: {} });
    for (const r of rects) expect(m.x < r.x + r.w && r.x < m.x + m.w && m.y < r.y + r.h && r.y < m.y + m.h).toBe(false);
  });
});

describe('planConnect', () => {
  function ledCircuit() {
    let p = createStarterProject('uno');
    ({ project: p } = add(p, 'resistor'));
    ({ project: p } = add(p, 'led'));
    return p;
  }

  it('wires inserted legs from free holes of the same strip', () => {
    const p0 = ledCircuit();
    const occ = buildOccupancy(p0);
    const { project, r } = connect(p0, 'r1.b', 'led1.anode');
    const holeOfR = occ.holeAt.get(`${localToWorld(p0.parts.find((x) => x.id === 'r1')!, { x: 4, y: 0 }).x},${localToWorld(p0.parts.find((x) => x.id === 'r1')!, { x: 4, y: 0 }).y}`)!;
    expect(r.from).toMatch(/^bb1\./);
    expect(r.to).toMatch(/^bb1\./);
    expect(occ.holeByRef.get(r.from)!.strip).toBe(holeOfR.strip);
    expect(occ.occupied.has(r.from)).toBe(false);
    expect(occ.covered.has(r.from)).toBe(false);
    expect(occ.occupied.has(r.to)).toBe(false);
    expect(sameNet(project, 'r1.b', 'led1.anode')).toBe(true);
    expect(r.ops[0]).toMatchObject({ op: 'wire.add', wire: { id: 'w1', color: 'yellow' } });
  });

  it('uses board pins directly and picks black for GND, red for 5V', () => {
    const p0 = ledCircuit();
    const g = connect(p0, 'led1.cathode', 'uno1.GND1');
    expect(g.r.to).toBe('uno1.GND1');
    expect(g.r.ops[0]).toMatchObject({ wire: { color: 'black' } });
    const v = connect(g.project, 'uno1.5V', 'bb1.T+1');
    expect(v.r.ops[0]).toMatchObject({ wire: { from: 'uno1.5V', to: 'bb1.T+1', color: 'red' } });
  });

  it('returns no ops when the pins are already connected', () => {
    const { project } = connect(ledCircuit(), 'r1.b', 'led1.anode');
    const again = planConnect(project, 'led1.anode', 'r1.b');
    expect(again.ops).toEqual([]);
    expect(again.note).toBe('Ya estaban conectados');
  });

  it('explains unknown pins in Spanish', () => {
    const p = ledCircuit();
    expect(planConnect(p, 'led9.anode', 'uno1.D13').error).toMatch(/No existe el componente/);
    expect(planConnect(p, 'led1.pata', 'uno1.D13').error).toMatch(/no tiene un pin/);
  });
});

describe('planDisconnect', () => {
  it('removes wires by id or by the pins they join (matching rerouted strip holes)', () => {
    let p = createStarterProject('uno');
    ({ project: p } = add(p, 'resistor'));
    ({ project: p } = add(p, 'led'));
    const c = connect(p, 'r1.b', 'led1.anode');
    p = c.project;
    const byPins = planDisconnect(p, { from: 'led1.anode', to: 'r1.b' });
    expect(byPins.error).toBeUndefined();
    expect(byPins.removed).toEqual([c.r.wireId]);
    expect(planDisconnect(p, { wireId: c.r.wireId }).ops).toEqual([{ op: 'wire.remove', id: c.r.wireId }]);
    expect(planDisconnect(p, { wireId: 'w99' }).error).toMatch(/No existe el cable/);
    expect(planDisconnect(p, { from: 'led1.cathode', to: 'uno1.GND1' }).error).toMatch(/No encontré cables/);
  });
});
