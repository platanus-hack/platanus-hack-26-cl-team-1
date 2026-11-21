/** Semiconductors: LED, RGB LED (common cathode), diode, NPN transistor. */
import { effectiveProp } from '../props';
import type { PartRec } from '../topology';
import { NPN_RBE, NPN_RSAT, term, type BuildContext, type Built, type ModelBuilder } from './types';

function addDiode(out: Built, ctx: BuildContext, rec: PartRec, a: string, c: string, vf: number, ron: number, role = 'main') {
  const ta = term(ctx, rec, a);
  const tc = term(ctx, rec, c);
  if (!ta || !tc) return;
  out.devices.push({ kind: 'diode', owner: rec.part.id, role, a: ta, c: tc, vf, ron: Math.max(ron, 0.05), on: false });
}

/** Forward voltage of a single-colour LED. */
export function ledVf(rec: PartRec): number {
  const el = rec.def.electrical;
  if (el.model !== 'led') return 2;
  const color = String(effectiveProp(rec.part, rec.def, el.colorProp) ?? '');
  return el.vf[color] ?? Object.values(el.vf)[0] ?? 2;
}

export const led: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'led') return;
  addDiode(out, ctx, rec, 'anode', 'cathode', ledVf(rec), el.seriesOhms);
};

export const RGB_CHANNELS = ['r', 'g', 'b'] as const;

export const rgbLed: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'rgb-led') return;
  for (const ch of RGB_CHANNELS) addDiode(out, ctx, rec, ch, 'com', el.vf[ch], el.seriesOhms, ch);
};

export const diode: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'diode') return;
  addDiode(out, ctx, rec, 'anode', 'cathode', el.vf, el.seriesOhms);
};

export const npn: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'npn') return;
  const c = term(ctx, rec, 'c');
  const b = term(ctx, rec, 'b');
  const e = term(ctx, rec, 'e');
  if (!c || !b || !e) return;
  out.devices.push({
    kind: 'npn',
    owner: rec.part.id,
    role: 'main',
    c,
    b,
    e,
    beta: el.beta,
    vbe: el.vbe,
    vceSat: el.vceSat,
    rbe: NPN_RBE,
    rsat: NPN_RSAT,
    state: 'off',
  });
};
