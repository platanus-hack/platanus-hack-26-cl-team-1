/** Linear parts: resistor, potentiometer, LDR, switches, buzzer, motor, servo. */
import { effectiveProp, toBool, toNum, clamp } from '../props';
import type { PartRec } from '../topology';
import { OPEN_OHMS, term, type BuildContext, type Built, type ModelBuilder } from './types';

function addRes(out: Built, ctx: BuildContext, rec: PartRec, a: string, b: string, ohms: number, role = 'main', structural = true) {
  const ta = term(ctx, rec, a);
  const tb = term(ctx, rec, b);
  if (!ta || !tb) return;
  out.devices.push({ kind: 'res', owner: rec.part.id, role, a: ta, b: tb, ohms: Math.max(ohms, 1e-3), structural });
}

const runtimeOf = (ctx: BuildContext, rec: PartRec) => ctx.inputs.runtime?.[rec.part.id];

export const resistor: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'resistor') return;
  const ohms = toNum(effectiveProp(rec.part, rec.def, el.resistanceProp), 220);
  addRes(out, ctx, rec, 'a', 'b', ohms > 0 ? ohms : 220);
};

/** Wiper position 0..100 (% from a to b). */
export function potPosition(rec: PartRec, ctx: BuildContext): number {
  const el = rec.def.electrical;
  if (el.model !== 'potentiometer') return 50;
  return clamp(toNum(effectiveProp(rec.part, rec.def, el.positionProp, runtimeOf(ctx, rec)), 50), 0, 100);
}

export const potentiometer: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'potentiometer') return;
  const total = Math.max(1, toNum(effectiveProp(rec.part, rec.def, el.resistanceProp), 10000));
  const pos = potPosition(rec, ctx) / 100;
  addRes(out, ctx, rec, 'a', 'wiper', Math.max(1, total * pos), 'aw');
  addRes(out, ctx, rec, 'wiper', 'b', Math.max(1, total * (1 - pos)), 'wb');
};

export function ldrOhms(dark: number, bright: number, light: number): number {
  return bright * Math.pow(dark / bright, 1 - clamp(light, 0, 100) / 100);
}

export const ldr: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'ldr') return;
  const light = toNum(effectiveProp(rec.part, rec.def, el.lightProp, runtimeOf(ctx, rec)), 50);
  addRes(out, ctx, rec, 'a', 'b', ldrOhms(el.darkOhms, el.brightOhms, light));
};

/** Push: a-group ↔ b-group closed while pressed. Slide: com ↔ a or com ↔ b. */
export function switchState(rec: PartRec, ctx: BuildContext): { pressed?: boolean; position?: 'a' | 'b' } {
  const el = rec.def.electrical;
  if (el.model !== 'switch') return {};
  const v = effectiveProp(rec.part, rec.def, el.stateProp, runtimeOf(ctx, rec));
  if (el.kind === 'push') return { pressed: toBool(v) };
  return { position: v === 'b' ? 'b' : 'a' };
}

export const switchModel: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'switch') return;
  const s = switchState(rec, ctx);
  if (el.kind === 'push') {
    const on = !!s.pressed;
    addRes(out, ctx, rec, 'a1', 'b1', on ? el.onOhms : OPEN_OHMS, 'main', on);
  } else {
    const a = s.position === 'a';
    addRes(out, ctx, rec, 'com', 'a', a ? el.onOhms : OPEN_OHMS, 'ca', a);
    addRes(out, ctx, rec, 'com', 'b', a ? OPEN_OHMS : el.onOhms, 'cb', !a);
  }
};

export const buzzer: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'buzzer') return;
  addRes(out, ctx, rec, 'plus', 'minus', el.ohms);
};

export const motor: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'motor') return;
  addRes(out, ctx, rec, 'a', 'b', el.ohms);
};

/** Servo: a load between vcc and gnd; the signal pin is high impedance. */
export const servo: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'servo') return;
  addRes(out, ctx, rec, 'vcc', 'gnd', el.loadOhms);
};
