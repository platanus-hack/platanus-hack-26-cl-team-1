import { describe, expect, it, vi } from 'vitest';
import agentTools from '../../../shared/agent-tools.json';
import { buildNetlist, deriveBindings, idleInputs, runChecks, solveCircuit } from '@/circuit';
import { EXAMPLES, buildExample, buildExampleStrict, getExampleProgram } from '@/examples';
import { buildOccupancy, computeNetlist } from '@/placement';
import { RECIPES } from './recipes';

const IDS = ['battery-led', 'blink-uno', 'traffic-light-uno', 'button-led-uno', 'servo-pot-uno', 'motor-transistor-uno', 'rgb-esp32c6'];

describe('examples', () => {
  it('keeps the 7 ids (matching the load_example enum)', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(IDS);
    const tool = (agentTools as unknown as Array<{ name: string; input_schema: { properties: Record<string, { enum?: string[] }> } }>).find((t) => t.name === 'load_example');
    expect([...(tool?.input_schema.properties.example_id.enum ?? [])].sort()).toEqual([...IDS].sort());
  });

  for (const id of IDS) {
    it(`${id} builds without op errors and passes the circuit checks`, () => {
      const { project, ir } = buildExampleStrict(id); // throws on any op error
      expect(project.meta.exampleId).toBe(id);
      const info = EXAMPLES.find((e) => e.id === id)!;
      expect(project.name).toBe(info.name);
      const netlist = buildNetlist(project);
      const issues = runChecks(project, netlist, solveCircuit(project, netlist, idleInputs()));
      expect(issues.filter((i) => i.severity === 'error').map((i) => `${i.code}: ${i.message}`)).toEqual([]);
      if (id === 'battery-led') {
        expect(ir).toBeNull();
        expect(project.program.workspace).toBeNull();
      } else {
        expect(ir?.loop.length).toBeGreaterThan(0);
      }
    });
  }

  it('wires inputs/outputs the way the programs expect', () => {
    const binding = (id: string, part: string) => {
      const p = buildExampleStrict(id).project;
      return deriveBindings(p, buildNetlist(p)).find((b) => b.part === part);
    };
    expect(binding('blink-uno', 'led1')).toMatchObject({ boardPin: 'D13', activeLow: false });
    expect(binding('button-led-uno', 'btn1')).toMatchObject({ boardPin: 'D2', mode: 'INPUT_PULLUP', activeLow: true });
    expect(binding('servo-pot-uno', 'servo1')).toMatchObject({ boardPin: 'D9' });
    expect(binding('servo-pot-uno', 'pot1')).toMatchObject({ boardPin: 'A0' });
    expect(binding('motor-transistor-uno', 'm1')).toMatchObject({ boardPin: 'D9', driver: 'npn' });
  });

  for (const id of IDS) {
    it(`${id} can be built for real: every wire end goes into a free hole or an off-board pin`, () => {
      const { project } = buildExampleStrict(id);
      const occ = buildOccupancy(project);
      const inserted = new Set(computeNetlist(project).insertions.filter((i) => occ.holeByRef.has(i.into)).map((i) => i.pin));
      const ends = new Map<string, number>();
      for (const w of project.wires) for (const e of [w.from, w.to]) ends.set(e, (ends.get(e) ?? 0) + 1);
      for (const [end, n] of ends) {
        if (occ.holeByRef.has(end)) {
          expect(occ.covered.has(end), `${end} is under a part body`).toBe(false);
          expect(occ.occupied.has(end), `${end} already holds a leg`).toBe(false);
          expect(n, `${end} holds ${n} wire ends`).toBe(1);
        } else {
          expect(inserted.has(end), `${end} is pushed into the breadboard: wire it from a free hole of its column`).toBe(false);
        }
      }
    });
  }

  it('rgb-esp32c6: each colour lights visibly at full duty, balanced, within the GPIO rating', () => {
    // 100 Ω on green/blue (Vf ≈ 2.8–2.9 V leaves little headroom at 3.3 V) and 220 Ω on red:
    // 100 Ω on red too would make red ~2× brighter than blue and skew every mixed colour.
    const p = buildExampleStrict('rgb-esp32c6').project;
    const nl = buildNetlist(p);
    const channels = deriveBindings(p, nl).filter((b) => b.part === 'rgb1');
    expect(channels.map((b) => b.channel).sort()).toEqual(['b', 'g', 'r']);
    const lit = channels.map((b) => {
      const r = solveCircuit(p, nl, { ...idleInputs(), drives: { [b.boardPin!]: { mode: 'output', level: 1 } } });
      return { v: r.parts.rgb1.rgb![['r', 'g', 'b'].indexOf(b.channel!)], mA: r.boardPins[b.boardPin!].currentA * 1000 };
    });
    for (const l of lit) {
      expect(l.v).toBeGreaterThan(0.25);
      expect(l.mA).toBeLessThan(20);
    }
    const v = lit.map((l) => l.v);
    expect(Math.max(...v) / Math.min(...v)).toBeLessThan(1.6);
  });

  it('lights the LED of battery-led without any program', () => {
    const p = buildExampleStrict('battery-led').project;
    const r = solveCircuit(p, buildNetlist(p), idleInputs());
    expect(r.parts.led1.brightness ?? 0).toBeGreaterThan(0.3);
    expect(r.parts.led1.overloaded).toBeFalsy();
  });

  it('falls back to a starter project with the example board (none for battery-led) when a build fails', () => {
    const original = RECIPES['battery-led'];
    RECIPES['battery-led'] = () => {
      throw new Error('fallo simulado');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const p = buildExample('battery-led');
      expect(p.meta.exampleId).toBe('battery-led');
      expect(p.parts.map((x) => x.type)).toEqual(['breadboard-half']);
    } finally {
      RECIPES['battery-led'] = original;
      spy.mockRestore();
    }
  });

  it('falls back gracefully for unknown ids', () => {
    expect(buildExample('nope').parts.length).toBeGreaterThan(0);
    expect(getExampleProgram('nope')).toBeNull();
  });
});
