import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartDef, PartInstance, PartSimState, PropValue } from '@/contracts';
import { defaultProps, findPartDef } from '@/catalog';
import { componentRenderers } from './index';

const TYPES = ['led', 'led-rgb', 'resistor', 'diode', 'button', 'switch-slide', 'potentiometer', 'ldr', 'buzzer', 'motor-dc', 'npn', 'servo-sg90'];

function render(def: PartDef, props: Record<string, PropValue> = {}, sim?: Partial<PartSimState>, thumbnail = false): string {
  const R = componentRenderers[def.type];
  const merged = { ...defaultProps(def), ...props };
  const part: PartInstance = { id: `t-${def.type}`, type: def.type, label: def.name, x: 0, y: 0, rotation: 0, props: merged };
  return renderToStaticMarkup(
    <svg>
      <R part={part} def={def} runtime={merged} sim={sim as PartSimState | undefined} thumbnail={thumbnail} />
    </svg>,
  );
}

/** Last point of every `<path data-lead="pin" d="...">`. */
function leadEnds(markup: string): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  for (const tag of markup.match(/<path [^>]*data-lead="[^"]+"[^>]*>/g) ?? []) {
    const pin = /data-lead="([^"]+)"/.exec(tag)![1];
    const d = /\sd="([^"]+)"/.exec(tag)![1];
    const nums = d.match(/-?\d*\.?\d+/g)!.map(Number);
    out.set(pin, [nums[nums.length - 2], nums[nums.length - 1]]);
  }
  return out;
}

const EDGE_STATES: Array<{ props?: Record<string, PropValue>; sim?: Partial<PartSimState> }> = [
  {},
  { sim: { currentA: 0, voltage: 0 } },
  { sim: { currentA: Number.NaN, voltage: Number.NaN, brightness: Number.NaN, speed: Number.NaN, angle: Number.NaN, rgb: [Number.NaN, 2, -1] } },
  { sim: { currentA: 0.02, voltage: 2, brightness: 1, rgb: [1, 0.2, 0.6], speed: -1, angle: 180, sounding: true, toneHz: 880, powered: true } },
  { sim: { currentA: 0.2, voltage: 5, overloaded: true, brightness: 1 } },
  { sim: { currentA: 0, voltage: 0, burned: true } },
  { props: { color: 'nope', cap: 'nope', position: 'zzz', resistance: 'abc', light: -50, pressed: 'true' } },
  { props: { position: 1e9, light: 1e9, resistance: 0 } },
];

describe('component renderers', () => {
  it('registers every component type', () => {
    for (const t of TYPES) expect(componentRenderers[t], t).toBeTypeOf('object');
  });

  for (const type of TYPES) {
    describe(type, () => {
      const def = findPartDef(type)!;

      it('every leg ends exactly on its pin', () => {
        const ends = leadEnds(render(def));
        for (const pin of def.pins) {
          const end = ends.get(pin.id);
          expect(end, `${type}.${pin.id} has a lead`).toBeDefined();
          expect(end![0]).toBeCloseTo(pin.x, 6);
          expect(end![1]).toBeCloseTo(pin.y, 6);
        }
      });

      it('renders edge states and thumbnails without throwing', () => {
        for (const st of EDGE_STATES) {
          expect(() => render(def, st.props, st.sim)).not.toThrow();
          expect(() => render(def, st.props, st.sim, true)).not.toThrow();
        }
        expect(render(def)).not.toMatch(/NaN|undefined|Infinity/);
        expect(render(def, EDGE_STATES[2].props, EDGE_STATES[2].sim)).not.toMatch(/NaN|Infinity/);
      });
    });
  }

  it('tags the actuators the canvas drives', () => {
    expect(render(findPartDef('button')!)).toContain('data-actuator="pressed"');
    expect(render(findPartDef('potentiometer')!)).toContain('data-actuator="position"');
    expect(render(findPartDef('switch-slide')!)).toContain('data-actuator="position"');
    expect(render(findPartDef('ldr')!)).toContain('data-actuator="light"');
  });

  it('svg ids are prefixed by the part id', () => {
    const ids = [...render(findPartDef('led')!, {}, { brightness: 1, currentA: 0.01, voltage: 2 }).matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id.startsWith('t-led')).toBe(true);
  });

  it('motor spins only when speed ≠ 0, with direction from the sign', () => {
    const def = findPartDef('motor-dc')!;
    expect(render(def)).not.toContain('cv-part-spin');
    const fwd = render(def, {}, { currentA: 0.1, voltage: 5, speed: 1 });
    expect(fwd).toContain('cv-part-spin');
    expect(fwd).toContain('animation-duration:0.15s');
    expect(render(def, {}, { currentA: 0.1, voltage: 5, speed: -0.5 })).toContain('animation-direction:reverse');
  });

  it('buzzer draws sound waves only while sounding', () => {
    const def = findPartDef('buzzer')!;
    expect(render(def)).not.toContain('cv-part-wave');
    expect(render(def, {}, { currentA: 0.01, voltage: 5, sounding: true, toneHz: 440 })).toContain('cv-part-wave');
  });

  it('LED glows with brightness and smokes when burned', () => {
    const def = findPartDef('led')!;
    expect(render(def)).not.toContain('cv-part-glow');
    expect(render(def, {}, { currentA: 0.02, voltage: 2, brightness: 0.8 })).toContain('cv-part-glow');
    const burned = render(def, {}, { currentA: 0, voltage: 0, burned: true, brightness: 1 });
    expect(burned).toContain('cv-part-smoke');
    expect(burned).not.toContain('cv-part-glow');
    expect(render(def, {}, { currentA: 0.05, voltage: 2.5, brightness: 1, overloaded: true })).toContain('cv-part-flicker');
  });
});
