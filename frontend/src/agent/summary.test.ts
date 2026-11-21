import { describe, expect, it } from 'vitest';
import type { CheckIssue, PartInstance, ProgramIR, ProjectModel } from '@/contracts';
import { BB_ROW_Y, bbColX, findPartDef } from '@/catalog';
import { buildNetlist, deriveBindings } from '@/circuit';
import { createStarterProject } from '@/store/newProject';
import { buildProjectSummary, stripIds } from './summary';

/** Part whose pin `pinId` sits in breadboard hole row+col of bb1 at (34, 0). */
function inHole(id: string, type: string, label: string, pinId: string, row: string, col: number, props = {}): PartInstance {
  const pin = findPartDef(type)!.pins.find((p) => p.id === pinId)!;
  const x = 34 + bbColX(col) - pin.x;
  const y = 0 + BB_ROW_Y[row] - pin.y;
  return { id, type, label, x, y, rotation: 0, props };
}

/** Uno + breadboard; R1 on e5–e9, LED anode e10 / cathode e11; D13 → a5, a9 bridge → a10?, cathode strip → GND. */
function blinkProject(): ProjectModel {
  const p = createStarterProject('uno');
  p.parts.push(inHole('r1', 'resistor', 'R1', 'a', 'e', 5, { resistance: 220 }));
  p.parts.push(inHole('led1', 'led', 'LED rojo', 'anode', 'e', 9));
  p.wires.push({ id: 'w1', from: 'uno1.D13', to: 'bb1.a5', color: 'yellow' });
  p.wires.push({ id: 'w2', from: 'bb1.a10', to: 'uno1.GND1', color: 'black' });
  return p;
}

const IR: ProgramIR = {
  version: 1,
  board: 'uno',
  variables: [],
  setup: [],
  loop: [{ k: 'led', id: 'blk-1', part: 'led1', on: { k: 'bool', id: 'blk-2', v: true } }],
  functions: [],
};

const ISSUE: CheckIssue = { id: 'x', code: 'floating-input', severity: 'warning', title: 't', message: 'm', parts: ['led1'], nets: ['n3'] };

describe('buildProjectSummary', () => {
  const project = blinkProject();
  const netlist = buildNetlist(project);
  const summary = buildProjectSummary({
    project,
    netlist,
    bindings: deriveBindings(project, netlist),
    issues: [ISSUE],
    program: IR,
    programErrors: [],
    view: 'hardware',
  });
  const part = (id: string) => summary.parts.find((p) => p.id === id)!;

  it('never lists breadboard holes as pins', () => {
    expect(part('bb1').pins).toEqual([]);
    for (const p of summary.parts) for (const pin of p.pins) for (const c of pin.connectedTo) expect(c.startsWith('bb1.')).toBe(false);
  });

  it('lists part pins with nets, insertions and connections', () => {
    const r = part('r1');
    const a = r.pins.find((p) => p.id === 'a')!;
    expect(a.inserted).toBe('bb1.e5');
    expect(a.net).toBe('D13');
    expect(a.connectedTo).toEqual(['uno1.D13']);
    const b = r.pins.find((p) => p.id === 'b')!;
    expect(b.inserted).toBe('bb1.e9');
    expect(b.connectedTo).toEqual(['led1.anode']);
    expect(b.net).toBe('nodo led1.anode');
    const anode = part('led1').pins.find((p) => p.id === 'anode')!;
    expect(anode.net).toBe(b.net);
    const cathode = part('led1').pins.find((p) => p.id === 'cathode')!;
    expect(cathode.net).toBe('GND');
    expect(cathode.connectedTo).toEqual(expect.arrayContaining(['uno1.GND1']));
  });

  it('lists board pins only when connected', () => {
    const ids = part('uno1').pins.map((p) => p.id);
    expect(ids).toContain('D13');
    expect(ids).toContain('GND1');
    expect(ids).not.toContain('D2');
    expect(ids).not.toContain('A0');
    const gnd = part('uno1').pins.find((p) => p.id === 'GND1')!;
    expect(gnd.connectedTo).not.toContain('uno1.GND2'); // own pins are excluded
  });

  it('includes effective props, wires, bindings, issues and an id-free program', () => {
    expect(summary.board).toBe('uno');
    expect(part('led1').props).toEqual({ color: 'red' }); // default merged
    expect(summary.wires).toHaveLength(2);
    const binding = summary.bindings.find((b) => b.part === 'led1');
    expect(binding).toMatchObject({ boardPin: 'D13', via: ['r1'], activeLow: false });
    expect(summary.issues[0]).not.toHaveProperty('nets');
    expect(JSON.stringify(summary.program)).not.toContain('"id"');
    expect(summary.program?.loop[0]).toEqual({ k: 'led', part: 'led1', on: { k: 'bool', v: true } });
    expect(summary.view).toBe('hardware');
  });

  it('returns null program for an empty IR and survives an empty project', () => {
    const empty: ProjectModel = { ...project, parts: [], wires: [] };
    const s = buildProjectSummary({
      project: empty,
      netlist: buildNetlist(empty),
      bindings: [],
      issues: [],
      program: { ...IR, loop: [] },
      programErrors: [],
      view: 'software',
    });
    expect(s).toMatchObject({ board: null, parts: [], wires: [], program: null });
  });

  it('stripIds removes nested ids only', () => {
    expect(stripIds({ id: 'a', k: 'x', b: [{ id: 'c', v: 1 }] })).toEqual({ k: 'x', b: [{ v: 1 }] });
  });
});
