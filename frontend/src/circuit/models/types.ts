/**
 * Solver device primitives. Every element is expressed as conductances and
 * Norton current sources (each source has a series resistance), so a plain
 * nodal matrix is enough — no extra MNA rows for voltage sources.
 */
import type { CircuitInputs, Id } from '@/contracts';
import type { ActiveBoard } from '../board';
import type { PartRec, Topology } from '../topology';

/** Conductance of an "open" element (off diode, open switch). */
export const G_OFF = 1e-9;
/** Conductance from every node to its reference (keeps the matrix regular). */
export const G_MIN = 1e-9;
export const WIRE_OHMS = 0.02;
export const LINK_OHMS = 0.01;
export const OPEN_OHMS = 1 / G_OFF;
/** NPN: base-emitter on-resistance and collector-emitter saturation resistance. */
export const NPN_RBE = 10;
export const NPN_RSAT = 0.3;
/** Max dissipation of the kit's small TO-92 NPN (2N2222A / PN2222A datasheets: 625 mW). */
export const NPN_MAX_W = 0.625;
/** Battery current limit used for the overload flag. */
export const BATTERY_LIMIT_A = 2;

/** A device terminal: solver node + the part pin it enters through (-1 = none, e.g. wire ends). */
export interface Term {
  node: number;
  pin: number;
}

export type NpnState = 'off' | 'active' | 'sat';

interface DeviceBase {
  /** Part id, or wire id for wires. */
  owner: Id;
  /** 'main', 'aw'/'wb' (pot), 'r'|'g'|'b' (rgb), 'ca'/'cb' (slide), 'link', 'wire', 'rail:5V', 'gpio:D13'… */
  role: string;
}

/** Linear resistor. `structural` = false for open switches (ignored when grouping components). */
export interface ResDevice extends DeviceBase {
  kind: 'res';
  a: Term;
  b: Term;
  ohms: number;
  structural: boolean;
}

/** Voltage source `volts` (+ at p) in series with `ohms`. Current p→n through it = (Vp−Vn−volts)/ohms. */
export interface SourceDevice extends DeviceBase {
  kind: 'vsrc';
  p: Term;
  n: Term;
  volts: number;
  ohms: number;
}

/** Piecewise-linear diode: off = G_OFF, on = vf + ron. */
export interface DiodeDevice extends DeviceBase {
  kind: 'diode';
  a: Term;
  c: Term;
  vf: number;
  ron: number;
  on: boolean;
}

/** Piecewise-linear NPN (cutoff / active Ic = β·Ib / saturation Vce = vceSat). */
export interface NpnDevice extends DeviceBase {
  kind: 'npn';
  c: Term;
  b: Term;
  e: Term;
  beta: number;
  vbe: number;
  vceSat: number;
  rbe: number;
  rsat: number;
  state: NpnState;
}

export type Device = ResDevice | SourceDevice | DiodeDevice | NpnDevice;

/** A supply that may feed the circuit (board rail or battery). */
export interface SupplyInfo {
  id: string; // 'uno1:5V' | 'bat1'
  part: Id;
  label: string;
  kind: 'rail' | 'battery';
  nominal: number;
  ohms: number;
  limitA: number;
  plusPin: number; // pin idx
  minusPin: number; // pin idx
  /** null when + and − are in the same net (shorted and removed from the solve). */
  device: SourceDevice | null;
}

export interface BuildContext {
  topo: Topology;
  board: ActiveBoard | null;
  inputs: CircuitInputs;
  /** Board pin id (canonical) → forced level for PWM pins (true = HIGH). */
  pwmLevel: (pin: string) => boolean | undefined;
}

export interface Built {
  devices: Device[];
  supplies: SupplyInfo[];
  /** Canonical GPIO id → its driver device (output / pull-up). */
  gpio: Map<string, SourceDevice>;
  /** Preferred reference nodes, in priority order (board GND, then battery minus). */
  refPriority: number[];
}

export type ModelBuilder = (rec: PartRec, ctx: BuildContext, out: Built) => void;

/** Terminal for `pinId` of a part, or null if the pin does not exist. */
export function term(ctx: BuildContext, rec: PartRec, pinId: string): Term | null {
  const pin = rec.pins.get(pinId);
  if (pin === undefined) return null;
  return { node: ctx.topo.node[pin], pin };
}
