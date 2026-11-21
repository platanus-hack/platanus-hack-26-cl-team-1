/**
 * Visual QA harness for the board / power renderers with LIVE states
 * (the shared gallery only renders the default, unpowered state).
 *   RENDER_BOARDS=1 BOARDS_OUT=/abs/dir npx vitest run src/parts/boards/render-boards.test.tsx
 * Writes <type>__<state>.svg (red crosses = pin positions) plus small thumbnails.
 */
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartInstance, PartSimState } from '@/contracts';
import { defaultProps, getPartDef } from '@/catalog';
import { SharedDefs } from '../defs';
import { boardRenderers } from './index';

type State = { name: string; sim?: Partial<PartSimState>; selected?: boolean };

const STATES: Record<string, State[]> = {
  'arduino-uno': [{ name: 'off' }, { name: 'on-l', sim: { onboard: { power: true, led: 1 } } }, { name: 'selected', selected: true, sim: { onboard: { power: true, led: 0.3 } } }],
  'esp32c6-devkit': [{ name: 'off' }, { name: 'rgb-purple', sim: { onboard: { power: true, rgb: [0.8, 0.1, 1] } } }, { name: 'rgb-green-dim', sim: { onboard: { power: true, rgb: [0, 0.25, 0.05] } } }],
  'breadboard-half': [{ name: 'default' }, { name: 'selected', selected: true }],
  'battery-9v': [{ name: 'default' }],
  'battery-aa4': [{ name: 'default' }],
};

function render(type: string, st: State, thumbnail: boolean, scale: number): string {
  const def = getPartDef(type);
  const R = boardRenderers[type];
  const props = defaultProps(def);
  const part: PartInstance = { id: `qa-${type}`, type, label: def.name, x: 0, y: 0, rotation: 0, props };
  const b = def.bounds;
  const pad = thumbnail ? Math.max(b.w, b.h) * 0.08 + 0.4 : 1.5;
  const vb = { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
  const crosses = thumbnail
    ? null
    : def.pins.slice(0, 500).map((p) => (
        <g key={p.id} stroke="#ff2d55" strokeWidth={0.04} opacity={0.9}>
          <line x1={p.x - 0.18} y1={p.y} x2={p.x + 0.18} y2={p.y} />
          <line x1={p.x} y1={p.y - 0.18} x2={p.x} y2={p.y + 0.18} />
        </g>
      ));
  return renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={vb.w * scale} height={vb.h * scale} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}>
      <SharedDefs />
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#0b0f14" />
      <R part={part} def={def} runtime={props} sim={st.sim as PartSimState | undefined} selected={st.selected} thumbnail={thumbnail} />
      {crosses}
    </svg>,
  );
}

describe.runIf(process.env.RENDER_BOARDS === '1')('render board gallery', () => {
  it('writes SVGs', () => {
    const out = process.env.BOARDS_OUT;
    if (!out) throw new Error('BOARDS_OUT is required');
    mkdirSync(out, { recursive: true });
    for (const [type, states] of Object.entries(STATES)) {
      for (const st of states) writeFileSync(join(out, `${type}__${st.name}.svg`), render(type, st, false, 48));
      writeFileSync(join(out, `${type}__thumb.svg`), render(type, states[states.length > 1 ? 1 : 0], true, 6));
    }
  });
});
