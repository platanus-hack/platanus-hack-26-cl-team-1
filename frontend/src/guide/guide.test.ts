import { describe, expect, it } from 'vitest';
import { findPartDef } from '@/catalog';
import { EXAMPLES, buildExampleStrict } from '@/examples';
import { computeNetlist, netlistFor } from '@/placement';
import { createStarterProject } from '@/store/newProject';
import { buildWiringGuide } from './build';
import { resistorBands } from './text';

function pinExists(project: ReturnType<typeof createStarterProject>, ref: string): boolean {
  const i = ref.indexOf('.');
  const part = project.parts.find((p) => p.id === ref.slice(0, i));
  return !!part && !!findPartDef(part.type)?.pins.some((p) => p.id === ref.slice(i + 1));
}

describe('buildWiringGuide', () => {
  for (const e of EXAMPLES) {
    it(`${e.id}: steps reference existing parts, wires and holes`, () => {
      const { project } = buildExampleStrict(e.id);
      const steps = buildWiringGuide(project, netlistFor(project));
      expect(steps.length).toBeGreaterThan(3);
      steps.forEach((s, i) => expect(s.index).toBe(i + 1));
      const ids = new Set(steps.map((s) => s.id));
      expect(ids.size).toBe(steps.length);
      for (const s of steps) {
        for (const t of s.highlight) {
          const ok = project.parts.some((p) => p.id === t) || project.wires.some((w) => w.id === t) || pinExists(project, t);
          expect(ok, `${s.id} highlights unknown target ${t}`).toBe(true);
        }
        // Every hole mentioned in the text exists on the breadboard.
        for (const m of s.detail.matchAll(/\b([a-j]\d{1,2})\b/g)) expect(pinExists(project, `bb1.${m[1]}`), `${s.id}: ${m[1]}`).toBe(true);
      }
      // Every part leg and every wire gets its own step.
      for (const part of project.parts) {
        const def = findPartDef(part.type)!;
        if (def.electrical.model === 'bus') continue;
        expect(ids.has(`part-${part.id}`) || ids.has(`board-${part.id}`)).toBe(true);
      }
      for (const w of project.wires) expect(ids.has(`wire-${w.id}`)).toBe(true);
      // Order: board/breadboard → parts → power wires → signal wires → check → program.
      const order = ['board', 'breadboard', 'part', 'power', 'wire', 'check', 'program'];
      const firstPart = steps.findIndex((s) => s.kind === 'part');
      expect(steps.slice(0, firstPart).every((s) => s.kind === 'board' || s.kind === 'breadboard')).toBe(true);
      const lastPower = steps.map((s) => s.kind).lastIndexOf('power');
      const firstSignal = steps.findIndex((s) => s.kind === 'wire');
      if (lastPower >= 0 && firstSignal >= 0) expect(lastPower).toBeLessThan(firstSignal);
      expect(order.indexOf(steps[steps.length - 1].kind)).toBeGreaterThanOrEqual(order.indexOf('check'));
      expect(steps.some((s) => s.kind === 'program')).toBe(project.program.workspace !== null);
    });
  }

  it('gives polarity hints with exact holes for LEDs', () => {
    const { project } = buildExampleStrict('blink-uno');
    const steps = buildWiringGuide(project, computeNetlist(project));
    const led = steps.find((s) => s.id === 'part-led1')!;
    expect(led.title).toBe('Coloca el LED rojo');
    expect(led.detail).toMatch(/pata larga \(ánodo, \+\) en e\d+/i);
    expect(led.detail).toMatch(/pata corta \(cátodo, −\) en e\d+/);
    const d13 = steps.find((s) => s.kind === 'wire' && s.detail.includes('pin 13 del Arduino'));
    expect(d13?.detail).toMatch(/^Cable amarillo: desde el pin 13 del Arduino hasta [a-e]\d+/);
  });

  it('returns only the setup steps for an empty breadboard', () => {
    const p = createStarterProject(null);
    const steps = buildWiringGuide(p, computeNetlist(p));
    expect(steps.map((s) => s.kind)).toEqual(['breadboard']);
  });

  it('names a leg pushed into a rail with its article ("en el riel …")', () => {
    const p = createStarterProject('uno');
    const bb = p.parts.find((x) => x.id === 'bb1')!;
    // Standing resistor: leg a in the top − rail (column 3, y=2), leg b in b3 (y=6).
    p.parts.push({ id: 'r1', type: 'resistor', label: 'R1', x: bb.x + 4, y: bb.y + 2, rotation: 90, props: {} });
    const steps = buildWiringGuide(p, computeNetlist(p));
    const r = steps.find((s) => s.id === 'part-r1')!;
    expect(r.detail).toBe('Una pata en el riel − superior (columna 3) y la otra pata en b3.');
  });

  it('does not ask to load a program when the blocks are only the empty hats', () => {
    const p = createStarterProject('uno');
    p.program.workspace = {
      blocks: { languageVersion: 0, blocks: [{ type: 'cv_setup', id: 's', x: 40, y: 40 }, { type: 'cv_loop', id: 'l', x: 40, y: 200 }] },
    };
    const steps = buildWiringGuide(p, computeNetlist(p));
    expect(steps.some((s) => s.kind === 'program')).toBe(false);
  });

  it('reads a wire from the board side when it starts in a board pin column (ESP32 on the breadboard)', () => {
    const { project } = buildExampleStrict('rgb-esp32c6');
    const steps = buildWiringGuide(project, computeNetlist(project));
    const gnd = steps.find((s) => s.kind === 'power' && /pin GND/.test(s.detail))!;
    expect(gnd.detail).toMatch(/^Cable negro: desde [ab]\d+ \(columna del pin GND\) hasta el riel −/);
    for (const s of steps.filter((x) => /columna del pin GPIO/.test(x.detail))) {
      expect(s.detail, s.detail).toMatch(/desde [ab]\d+ \(columna del pin GPIO\d+\)/);
    }
  });

  it('computes resistor colour bands', () => {
    expect(resistorBands(220)).toEqual(['rojo', 'rojo', 'café', 'dorado']);
    expect(resistorBands(1000)).toEqual(['café', 'negro', 'rojo', 'dorado']);
    expect(resistorBands(4700)).toEqual(['amarillo', 'violeta', 'rojo', 'dorado']);
    expect(resistorBands(5)).toBeNull();
  });
});
