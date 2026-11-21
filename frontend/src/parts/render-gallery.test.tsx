/**
 * Visual QA harness for part renderers (not a real test).
 *   RENDER_PARTS=1 npx vitest run src/parts/render-gallery.test.tsx
 *   → writes frontend/.renders/<type>__<state>.svg  (scripts/render-parts.sh also makes PNGs)
 * Red crosses mark the PinDef positions: every leg/header must end exactly on them.
 */
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartInstance, PartSimState, PropValue } from '@/contracts';
import { allPartDefs, defaultProps } from '@/catalog';
import { getRenderer } from './registry';
import { SharedDefs } from './defs';

type State = { name: string; props?: Record<string, PropValue>; sim?: Partial<PartSimState> };

const STATES: Record<string, State[]> = {
  led: [
    { name: 'red-off', props: { color: 'red' } },
    { name: 'red-on', props: { color: 'red' }, sim: { brightness: 1, currentA: 0.018 } },
    { name: 'green-on', props: { color: 'green' }, sim: { brightness: 0.6 } },
    { name: 'blue-on', props: { color: 'blue' }, sim: { brightness: 1 } },
    { name: 'yellow-off', props: { color: 'yellow' } },
    { name: 'burned', props: { color: 'red' }, sim: { burned: true } },
    { name: 'overloaded', props: { color: 'red' }, sim: { brightness: 1, overloaded: true } },
  ],
  'led-rgb': [{ name: 'off' }, { name: 'purple', sim: { rgb: [0.8, 0.1, 1] } }, { name: 'burned', sim: { burned: true } }],
  diode: [{ name: 'default' }, { name: 'overloaded', sim: { overloaded: true } }],
  resistor: [{ name: '220', props: { resistance: 220 } }, { name: '10k', props: { resistance: 10000 } }, { name: '4k7', props: { resistance: 4700 } }],
  button: [{ name: 'up' }, { name: 'pressed', props: { pressed: true, cap: 'red' } }],
  'switch-slide': [{ name: 'a' }, { name: 'b', props: { position: 'b' } }],
  potentiometer: [{ name: 'p0', props: { position: 0 } }, { name: 'p50' }, { name: 'p100', props: { position: 100 } }],
  ldr: [{ name: 'dark', props: { light: 5 } }, { name: 'bright', props: { light: 95 } }],
  buzzer: [{ name: 'idle' }, { name: 'sounding', sim: { sounding: true, toneHz: 440 } }],
  'motor-dc': [{ name: 'stopped' }, { name: 'spinning', sim: { speed: 0.8 } }, { name: 'reverse', sim: { speed: -0.6 } }],
  'servo-sg90': [{ name: 'a0', sim: { angle: 0, powered: true } }, { name: 'a90', sim: { angle: 90, powered: true } }, { name: 'a180', sim: { angle: 180, powered: true } }],
};

function svgFor(type: string, st: State): string {
  const def = allPartDefs().find((d) => d.type === type)!;
  const R = getRenderer(type);
  const props = { ...defaultProps(def), ...(st.props ?? {}) };
  const part: PartInstance = { id: `g-${type}`, type, label: def.name, x: 0, y: 0, rotation: 0, props };
  const b = def.bounds;
  const pad = 1.5;
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const scale = 40; // px per grid unit
  const crosses = def.pins.slice(0, 500).map((p) => (
    <g key={p.id} stroke="#ff2d55" strokeWidth={0.04} opacity={0.9}>
      <line x1={p.x - 0.18} y1={p.y} x2={p.x + 0.18} y2={p.y} />
      <line x1={p.x} y1={p.y - 0.18} x2={p.x} y2={p.y + 0.18} />
    </g>
  ));
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={vb.w * scale} height={vb.h * scale} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
      <SharedDefs />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#0b0f14" />
      <R part={part} def={def} runtime={props} sim={st.sim as PartSimState | undefined} />
      {crosses}
    </svg>,
  );
  return markup;
}

describe.runIf(process.env.RENDER_PARTS === '1')('render parts gallery', () => {
  it('writes SVGs', () => {
    const dir = process.env.RENDER_OUT ?? '.renders';
    const out = new URL(`../../${dir.replace(/\/?$/, '/')}`, import.meta.url);
    mkdirSync(out, { recursive: true });
    const only = process.env.ONLY?.split(',').filter(Boolean);
    for (const def of allPartDefs()) {
      if (only && !only.includes(def.type)) continue;
      const states = STATES[def.type] ?? [{ name: 'default' }];
      for (const st of states) writeFileSync(new URL(`${def.type}__${st.name}.svg`, out), svgFor(def.type, st));
    }
  });
});
