/** Sources: batteries and the ACTIVE board (rails + GPIO drivers). */
import type { PinDrive } from '@/contracts';
import { canonicalGpios, type ActiveBoard } from '../board';
import {
  BATTERY_LIMIT_A,
  term,
  type BuildContext,
  type ModelBuilder,
  type SourceDevice,
} from './types';

export const battery: ModelBuilder = (rec, ctx, out) => {
  const el = rec.def.electrical;
  if (el.model !== 'battery') return;
  const p = term(ctx, rec, 'plus');
  const n = term(ctx, rec, 'minus');
  if (!p || !n) return;
  const ohms = Math.max(el.internalOhms, 1e-3);
  const shorted = ctx.topo.net[p.pin] === ctx.topo.net[n.pin];
  const device: SourceDevice | null = shorted
    ? null
    : { kind: 'vsrc', owner: rec.part.id, role: 'main', p, n, volts: el.voltage, ohms };
  if (device) out.devices.push(device);
  out.refPriority.push(n.node);
  out.supplies.push({
    id: rec.part.id,
    part: rec.part.id,
    label: rec.part.label || rec.def.name,
    kind: 'battery',
    nominal: el.voltage,
    ohms,
    limitA: BATTERY_LIMIT_A,
    plusPin: p.pin,
    minusPin: n.pin,
    device,
  });
};

/** Drives keyed by CANONICAL pin id (an alias key is accepted; the canonical key wins). */
export function canonicalDrives(board: ActiveBoard, drives: Record<string, PinDrive> | undefined): Map<string, PinDrive> {
  const out = new Map<string, PinDrive>();
  if (!drives) return out;
  for (const [key, drive] of Object.entries(drives)) {
    if (!drive) continue;
    const id = board.canonical(key);
    if (!board.pins.has(id)) continue;
    if (key === id || !out.has(id)) out.set(id, drive);
  }
  return out;
}

/** Electrical level of an output drive: PWM/tone pins are solved HIGH. */
export function driveIsHigh(drive: PinDrive): boolean {
  return drive.duty !== undefined ? drive.duty > 0 : drive.level === 1;
}

export const mcu: ModelBuilder = (rec, ctx: BuildContext, out) => {
  const board = ctx.board;
  if (!board || board.rec !== rec || !board.gndPin) return; // other boards are unpowered
  const gnd = term(ctx, rec, board.gndPin);
  if (!gnd) return;
  out.refPriority.unshift(gnd.node);
  const { profile } = board;

  for (const rail of profile.supply.rails) {
    const pinId = board.canonical(rail.pin);
    const p = term(ctx, rec, pinId);
    if (!p) continue;
    const ohms = Math.max(rail.sourceOhms, 1e-3);
    const shorted = ctx.topo.net[p.pin] === ctx.topo.net[gnd.pin];
    const device: SourceDevice | null = shorted
      ? null
      : { kind: 'vsrc', owner: rec.part.id, role: `rail:${pinId}`, p, n: gnd, volts: rail.volts, ohms };
    if (device) out.devices.push(device);
    const limitmA = pinId === '5V' ? Math.min(rail.maxmA, profile.supply.usbMaxmA) : rail.maxmA;
    out.supplies.push({
      id: `${rec.part.id}:${pinId}`,
      part: rec.part.id,
      label: rail.label,
      kind: 'rail',
      nominal: rail.volts,
      ohms,
      limitA: limitmA / 1000,
      plusPin: p.pin,
      minusPin: gnd.pin,
      device,
    });
  }

  const drives = canonicalDrives(board, ctx.inputs.drives);
  for (const bp of canonicalGpios(profile)) {
    const drive = drives.get(bp.id);
    if (!drive) continue;
    const p = term(ctx, rec, bp.id);
    if (!p) continue;
    let volts: number;
    let ohms: number;
    if (drive.mode === 'output') {
      const high = ctx.pwmLevel(bp.id) ?? driveIsHigh(drive);
      volts = high ? profile.logicVoltage : 0;
      ohms = profile.outputOhms;
    } else if (drive.mode === 'input_pullup') {
      volts = profile.logicVoltage;
      ohms = profile.pullupOhms;
    } else continue;
    const device: SourceDevice = { kind: 'vsrc', owner: rec.part.id, role: `gpio:${bp.id}`, p, n: gnd, volts, ohms: Math.max(ohms, 1e-3) };
    out.devices.push(device);
    out.gpio.set(bp.id, device);
  }
};
