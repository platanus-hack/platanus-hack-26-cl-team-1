/**
 * Schematic edge cases: every graph lays out with ELK (no rejection), every
 * node/edge gets a position and no symbol writes NaN/undefined attributes.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Op, ProjectModel } from '@/contracts';
import { buildNetlist } from '@/circuit';
import { computeNetlist, planAddPart, planConnect } from '@/placement';
import { applyOps } from '@/store/applyOp';
import { createEmptyProject, createStarterProject } from '@/store/newProject';
import { buildSchematicGraph } from './graph';
import { layoutSchematic } from './layout';
import { nodeLive } from './live';
import { SchematicSymbol } from './symbols';

const TYPES = ['led', 'resistor', 'servo-sg90', 'potentiometer', 'ldr', 'buzzer', 'switch-slide', 'button', 'npn', 'diode', 'motor-dc', 'led-rgb', 'battery-aa4'];

function apply(p: ProjectModel, ops: Op[]): ProjectModel {
  const r = applyOps(p, ops);
  if ('error' in r) throw new Error(r.error);
  return r.model;
}
function add(p: ProjectModel, type: string): ProjectModel {
  const r = planAddPart(p, type);
  if (r.error) throw new Error(r.error);
  return apply(p, r.ops);
}
function wire(p: ProjectModel, pairs: Array<[string, string]>): ProjectModel {
  for (const [a, b] of pairs) {
    const r = planConnect(p, a, b);
    if (r.error) throw new Error(r.error);
    p = apply(p, r.ops);
  }
  return p;
}

function cases(): Record<string, ProjectModel> {
  const out: Record<string, ProjectModel> = {};
  out.empty = createEmptyProject();
  out.breadboardOnly = createStarterProject(null);
  out.unconnected = TYPES.reduce(add, createStarterProject('uno'));
  let two = createStarterProject('uno');
  two = apply(two, [{ op: 'part.add', part: { id: 'esp1', type: 'esp32c6-devkit', label: 'ESP32-C6', x: -40, y: 0, rotation: 0, props: {} } }]);
  out.twoBoards = wire(two, [['uno1.D13', 'esp1.GPIO4'], ['uno1.GND1', 'esp1.GND1']]);
  out.batteryOnly = add(createEmptyProject(), 'battery-9v');
  out.batteryShorted = wire(out.batteryOnly, [['bat1.plus', 'bat1.minus']]);
  out.everything = wire(TYPES.reduce(add, createStarterProject('uno')), [
    ['uno1.D13', 'led1.anode'], ['led1.cathode', 'r1.a'], ['r1.b', 'uno1.GND1'],
    ['servo1.signal', 'uno1.D9'], ['servo1.vcc', 'uno1.5V'], ['servo1.gnd', 'uno1.GND2'],
    ['pot1.wiper', 'uno1.A0'], ['pot1.a', 'uno1.GND1'], ['pot1.b', 'uno1.5V'],
    ['btn1.a1', 'uno1.D2'], ['btn1.b2', 'uno1.GND1'],
    ['q1.b', 'uno1.D3'], ['q1.c', 'm1.b'], ['m1.a', 'bat1.plus'], ['bat1.minus', 'uno1.GND1'], ['q1.e', 'uno1.GND1'],
    ['rgb1.r', 'uno1.D5'], ['rgb1.com', 'uno1.GND1'], ['sw1.com', 'uno1.D4'], ['sw1.a', 'uno1.GND1'],
    ['ldr1.a', 'uno1.A1'], ['bz1.plus', 'uno1.D8'], ['d1.anode', 'd1.cathode'],
  ]);
  return out;
}

describe('schematic edge cases', () => {
  for (const [name, project] of Object.entries(cases())) {
    it(`${name}: lays out and renders cleanly`, async () => {
      for (const netlist of [computeNetlist(project), buildNetlist(project)]) {
        const g = buildSchematicGraph(project, netlist);
        const l = await layoutSchematic(g);
        const live = nodeLive(g, project, null, {}, {});
        for (const n of g.nodes) {
          expect(l.nodes[n.id], n.id).toBeDefined();
          const html = renderToStaticMarkup(
            <svg>
              <SchematicSymbol node={n} layout={l.nodes[n.id]} live={live[n.id] ?? {}} />
            </svg>,
          );
          expect(html, n.id).not.toMatch(/NaN|Infinity|undefined/);
        }
        for (const j of g.junctions) expect(l.nodes[j.id], j.id).toBeDefined();
        for (const e of g.edges) expect(l.edges[e.id]?.length ?? 0, e.id).toBeGreaterThanOrEqual(2);
        for (const pt of Object.values(l.edges).flat()) expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
      }
    });
  }
});
