import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ProjectModel } from '@/contracts';
import { buildExampleStrict } from '@/examples';
import { computeNetlist } from '@/placement';
import { createEmptyProject, createStarterProject } from '@/store/newProject';
import { type SNode, buildSchematicGraph } from './graph';
import { layoutSchematic } from './layout';
import { edgeFlow, nodeLive, voltageColor, voltageScale } from './live';
import { SchematicSymbol } from './symbols';
import { roundedPath } from './SchematicView';

describe('buildSchematicGraph', () => {
  it('builds nodes, ports and direct edges for blink', () => {
    const { project } = buildExampleStrict('blink-uno');
    const g = buildSchematicGraph(project, computeNetlist(project));
    expect(g.nodes.map((n) => n.id).sort()).toEqual(['led1', 'r1', 'uno1']); // no breadboard
    const uno = g.nodes.find((n) => n.id === 'uno1')!;
    expect(uno.ports.map((p) => p.label).sort()).toEqual(['D13', 'GND']); // only connected board pins
    expect(g.junctions).toEqual([]);
    expect(g.edges).toHaveLength(3);
    const gnd = g.nets.find((n) => n.name === 'GND')!;
    expect(gnd.kind).toBe('ground');
    const led = g.nodes.find((n) => n.id === 'led1')!;
    expect(led.ports.find((p) => p.pin === 'anode')?.side).toBe('WEST');
  });

  it('creates a junction for nets with more than two ports', () => {
    const { project } = buildExampleStrict('traffic-light-uno');
    const g = buildSchematicGraph(project, computeNetlist(project));
    expect(g.junctions).toHaveLength(1);
    const gnd = g.nets.find((n) => n.name === 'GND')!;
    expect(gnd.ports).toHaveLength(4);
    expect(g.edges.filter((e) => e.netKey === gnd.key)).toHaveLength(4);
  });

  it('has a stable topology key and handles an empty project', () => {
    const { project } = buildExampleStrict('servo-pot-uno');
    const a = buildSchematicGraph(project, computeNetlist(project));
    const b = buildSchematicGraph({ ...project }, computeNetlist({ ...project }));
    expect(a.topologyKey).toBe(b.topologyKey);
    const empty = createStarterProject(null);
    const e = buildSchematicGraph(empty, computeNetlist(empty));
    expect(e.nodes).toEqual([]);
    expect(e.edges).toEqual([]);
  });

  it('draws a short between two terminals of the same part (battery + to −, board 5V to GND)', async () => {
    const bat = createEmptyProject();
    bat.parts.push({ id: 'bat1', type: 'battery-9v', label: 'Batería', x: 0, y: 0, rotation: 0, props: {} });
    bat.wires.push({ id: 'w1', from: 'bat1.plus', to: 'bat1.minus', color: 'red' });
    const g = buildSchematicGraph(bat, computeNetlist(bat));
    const node = g.nodes.find((n) => n.id === 'bat1')!;
    expect(node.ports.map((p) => p.pin).sort()).toEqual(['minus', 'plus']);
    expect(g.edges).toHaveLength(1);
    expect(new Set([g.edges[0].sourceRef, g.edges[0].targetRef])).toEqual(new Set(['bat1.plus', 'bat1.minus']));
    const l = await layoutSchematic(g);
    expect(l.edges[g.edges[0].id]?.length).toBeGreaterThanOrEqual(2);

    const uno = createStarterProject('uno');
    uno.wires.push({ id: 'w1', from: 'uno1.5V', to: 'uno1.GND1', color: 'red' });
    const gu = buildSchematicGraph(uno, computeNetlist(uno));
    const board = gu.nodes.find((n) => n.id === 'uno1')!;
    // 5V and GND are separate pins joined by the wire; GND1/GND2/GND3 (joined on the PCB) stay one port.
    expect(board.ports.map((p) => p.label).sort()).toEqual(['5V', 'GND']);
    expect(gu.edges).toHaveLength(1);
    await layoutSchematic(gu);
  });

  it('shows the bypass wire of a part whose two legs share a strip', () => {
    const { project } = buildExampleStrict('blink-uno');
    const p = { ...project, wires: [...project.wires, { id: 'wx', from: 'bb1.c7', to: 'bb1.c8', color: 'white' as const }] };
    const g = buildSchematicGraph(p, computeNetlist(p));
    const led = g.nodes.find((n) => n.id === 'led1')!;
    expect(led.ports.map((x) => x.pin).sort()).toEqual(['anode', 'cathode']);
    const anodeNet = led.ports.find((x) => x.pin === 'anode')!.netKey;
    expect(led.ports.find((x) => x.pin === 'cathode')!.netKey).toBe(anodeNet);
    // r1.b, led anode, led cathode and the GND side are all one net now → junction with an edge to each port.
    expect(g.edges.filter((e) => e.netKey === anodeNet).length).toBeGreaterThanOrEqual(3);
  });

  it('lays out every node and edge with ELK (cached by topology)', async () => {
    const { project } = buildExampleStrict('motor-transistor-uno');
    const g = buildSchematicGraph(project, computeNetlist(project));
    const l = await layoutSchematic(g);
    for (const n of g.nodes) expect(l.nodes[n.id]).toBeDefined();
    for (const j of g.junctions) expect(l.nodes[j.id]).toBeDefined();
    for (const e of g.edges) expect(l.edges[e.id]?.length).toBeGreaterThanOrEqual(2);
    expect(await layoutSchematic(g)).toBe(l);
    // MCU pins land below the header at a regular pitch.
    const uno = l.nodes.uno1;
    const ys = Object.values(uno.ports).map((p) => p.y).sort((x, y) => x - y);
    expect(ys[0]).toBeGreaterThan(40);
  });
});

describe('live helpers', () => {
  it('maps voltages to colours and current direction', () => {
    expect(voltageColor(0, 5)).not.toBe(voltageColor(5, 5));
    expect(voltageScale([0.1, 3.2], 3.3)).toBe(3.3);
    expect(voltageScale([9], undefined)).toBe(9);
    const fake = { pinCurrents: { 'r1.b': 0.01, 'uno1.D13': -0.01 } } as never;
    expect(edgeFlow({ id: 'e', netKey: 'k', source: { node: 'uno1' }, target: { node: 'r1' }, sourceRef: 'uno1.D13', targetRef: 'r1.b' }, fake)).toEqual({ amps: 0.01, forward: true });
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toMatch(/^M 0 0 L .* Q 10 0 .* L 10 10$/);
  });
});

describe('symbols', () => {
  const nodeFor = (project: ProjectModel, id: string) => {
    const g = buildSchematicGraph(project, computeNetlist(project));
    return { g, node: g.nodes.find((n) => n.id === id)! };
  };
  const layoutStub = (node: SNode) => ({ id: node.id, x: 0, y: 0, w: node.w, h: node.h, ports: {} });
  const hornEnd = (markup: string) => {
    const m = /<line class="sch-line sch-accent-stroke" x1="([-\d.]+)" y1="[-\d.]+" x2="([-\d.]+)"/.exec(markup)!;
    return { hub: Number(m[1]), tip: Number(m[2]) };
  };

  it('turns the servo horn like the breadboard drawing (0° → right, 180° → left)', () => {
    const p = createEmptyProject();
    p.parts.push({ id: 'servo1', type: 'servo-sg90', label: 'Servo', x: 0, y: 0, rotation: 0, props: {} });
    const { node } = nodeFor(p, 'servo1');
    const at = (angle: number) => hornEnd(renderToStaticMarkup(<svg><SchematicSymbol node={node} layout={layoutStub(node)} live={{ angle }} /></svg>));
    const a0 = at(0), a180 = at(180), a90 = at(90);
    expect(a0.tip).toBeGreaterThan(a0.hub + 5);
    expect(a180.tip).toBeLessThan(a180.hub - 5);
    expect(a90.tip).toBeCloseTo(a90.hub, 5);
  });

  it('never writes NaN for odd prop values (knob position, light level)', () => {
    const p = createEmptyProject();
    p.parts.push({ id: 'pot1', type: 'potentiometer', label: 'Perilla', x: 0, y: 0, rotation: 0, props: { position: 'abc' } });
    p.parts.push({ id: 'ldr1', type: 'ldr', label: 'LDR', x: 10, y: 0, rotation: 0, props: { light: 'mucha' } });
    const g = buildSchematicGraph(p, computeNetlist(p));
    const live = nodeLive(g, p, null, { pot1: { position: Number.NaN } }, {});
    for (const node of g.nodes) {
      const html = renderToStaticMarkup(<svg><SchematicSymbol node={node} layout={layoutStub(node)} live={live[node.id]} /></svg>);
      expect(html, node.id).not.toMatch(/NaN|Infinity/);
    }
  });
});
