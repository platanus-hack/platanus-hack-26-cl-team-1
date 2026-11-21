/** Builds the solver device list for a project + inputs. */
import type { ElectricalModelName } from '@/contracts';
import { buzzer, ldr, motor, potentiometer, resistor, servo, switchModel } from './passive';
import { battery, mcu } from './power';
import { diode, led, npn, rgbLed } from './semis';
import { LINK_OHMS, WIRE_OHMS, type BuildContext, type Built, type ModelBuilder } from './types';

export * from './types';
export { canonicalDrives, driveIsHigh } from './power';
export { ldrOhms, potPosition, switchState } from './passive';
export { ledVf, RGB_CHANNELS } from './semis';

const BUILDERS: Partial<Record<ElectricalModelName, ModelBuilder>> = {
  resistor,
  potentiometer,
  ldr,
  switch: switchModel,
  buzzer,
  motor,
  servo,
  led,
  'rgb-led': rgbLed,
  diode,
  npn,
  battery,
  mcu,
};

export function buildDevices(ctx: BuildContext): Built {
  const out: Built = { devices: [], supplies: [], gpio: new Map(), refPriority: [] };
  const burned = new Set(ctx.inputs.burned ?? []);
  const { topo } = ctx;

  for (const rec of topo.parts) {
    if (burned.has(rec.part.id)) continue; // destroyed = open circuit
    BUILDERS[rec.def.electrical.model]?.(rec, ctx, out);
  }
  // Internal buses of non-breadboard parts (button leg pairs, board GND pins…).
  for (const link of topo.links) {
    const owner = topo.parts[link.part].part.id;
    out.devices.push({
      kind: 'res',
      owner,
      role: 'link',
      a: { node: topo.node[link.a], pin: link.a },
      b: { node: topo.node[link.b], pin: link.b },
      ohms: LINK_OHMS,
      structural: true,
    });
  }
  // Wires (ends inside the same solver node carry no current: skipped).
  for (const w of topo.wires) {
    if (w.from < 0 || w.to < 0) continue;
    const a = topo.node[w.from];
    const b = topo.node[w.to];
    if (a === b) continue;
    out.devices.push({
      kind: 'res',
      owner: w.wire.id,
      role: 'wire',
      a: { node: a, pin: -1 },
      b: { node: b, pin: -1 },
      ohms: WIRE_OHMS,
      structural: true,
    });
  }
  return out;
}
