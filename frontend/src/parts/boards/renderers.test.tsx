import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartDef, PartInstance, PartSimState } from '@/contracts';
import { defaultProps, getPartDef } from '@/catalog';
import { boardRenderers } from './index';

const TYPES = ['arduino-uno', 'esp32c6-devkit', 'breadboard-half', 'battery-9v', 'battery-aa4'];

function render(def: PartDef, opts: { sim?: PartSimState; selected?: boolean; thumbnail?: boolean; id?: string } = {}) {
  const R = boardRenderers[def.type];
  const props = defaultProps(def);
  const part: PartInstance = { id: opts.id ?? `t-${def.type}`, type: def.type, label: def.name, x: 0, y: 0, rotation: 0, props };
  return renderToStaticMarkup(
    <svg>
      <R part={part} def={def} runtime={props} sim={opts.sim} selected={opts.selected} thumbnail={opts.thumbnail} />
    </svg>,
  );
}

const sim = (onboard: PartSimState['onboard']): PartSimState => ({ currentA: 0, voltage: 0, onboard });

describe('board renderers', () => {
  it('registers all five types', () => {
    expect(Object.keys(boardRenderers).sort()).toEqual([...TYPES].sort());
  });

  it.each(TYPES)('%s renders in every state without throwing', (type) => {
    const def = getPartDef(type);
    for (const o of [{}, { thumbnail: true }, { selected: true }, { sim: sim({ power: true, led: 1, rgb: [1, 0, 0] }) }]) {
      expect(render(def, o).length).toBeGreaterThan(200);
    }
  });

  it.each(TYPES)('%s survives a def with no pins (edge state)', (type) => {
    const def = { ...getPartDef(type), pins: [] };
    expect(() => render(def)).not.toThrow();
  });

  it('Uno: ON / L indicators only glow when the sim says so', () => {
    const def = getPartDef('arduino-uno');
    const glows = (svg: string) => ({ on: /id="[^"]+-on"/.test(svg), l: /id="[^"]+-l"/.test(svg) });
    expect(glows(render(def))).toEqual({ on: false, l: false });
    expect(glows(render(def, { sim: sim({ power: true, led: 1 }) }))).toEqual({ on: true, l: true });
    expect(glows(render(def, { sim: sim({ power: true, led: 0 }) }))).toEqual({ on: true, l: false });
    expect(glows(render(def, { sim: sim({ power: false, led: 0.5 }) }))).toEqual({ on: false, l: true });
  });

  it('ESP32-C6: the RGB LED shows the commanded colour, unlit when undefined/black', () => {
    const def = getPartDef('esp32c6-devkit');
    expect(render(def)).not.toContain('rgbglow');
    expect(render(def, { sim: sim({ power: true, rgb: [0, 0, 0] }) })).not.toContain('rgbglow');
    const lit = render(def, { sim: sim({ power: true, rgb: [0, 0.5, 0] }) });
    expect(lit).toContain('rgbglow');
    expect(lit).toContain('#00ff00');
  });

  it('defs ids are prefixed with the (sanitised) part id and unique per instance', () => {
    const def = getPartDef('arduino-uno');
    const a = render(def, { id: 'uno 1' });
    expect(a).toContain('id="uno_1-');
    const both = renderToStaticMarkup(
      <svg>
        {['x', 'x'].map((id, i) => {
          const R = boardRenderers['battery-9v'];
          const d = getPartDef('battery-9v');
          const part: PartInstance = { id, type: d.type, label: '', x: 0, y: 0, rotation: 0, props: {} };
          return <R key={i} part={part} def={d} runtime={{}} />;
        })}
      </svg>,
    );
    const ids = [...both.matchAll(/id="([^"]+)-case"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});
