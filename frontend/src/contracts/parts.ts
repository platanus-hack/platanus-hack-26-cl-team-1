/**
 * CONTRACT 5 — Parts library entry format
 * ---------------------------------------------------------------------------
 * One JSON file per part in /shared/parts/<type>.json (read by the frontend
 * via catalog/ and by the Python agent for its prompt). Visual renderers live
 * in frontend/src/parts/** keyed by `type`.
 *
 * Geometry: grid units (1 = 0.1in). `bounds` and pin x/y are relative to the
 * part origin in the UNROTATED orientation. Pin coordinates MUST be integers.
 * The renderer must draw each leg/header so it ends exactly on its pin point.
 *
 * Pin id conventions per electrical model (FIXED — solver/codegen rely on them):
 *   resistor: a, b              diode: anode, cathode        led: anode, cathode
 *   rgb-led: r, g, b, com       potentiometer: a, wiper, b   ldr: a, b
 *   battery: plus, minus        button (push): a1, a2, b1, b2 (a1–a2 and b1–b2 always joined)
 *   switch (slide): a, com, b   buzzer: plus, minus          motor: a, b
 *   npn: c, b, e                servo: gnd, vcc, signal      mcu: BoardPin ids
 *   breadboard: generated hole ids (see catalog/breadboard.ts)
 */
import type { BoardId, PropValue } from './model';

export type PartCategory =
  | 'boards'
  | 'power'
  | 'passive'
  | 'output'
  | 'input'
  | 'semiconductor'
  | 'prototyping';

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  boards: 'Placas',
  power: 'Energía',
  passive: 'Pasivos',
  output: 'Salidas',
  input: 'Entradas',
  semiconductor: 'Semiconductores',
  prototyping: 'Prototipado',
};

export interface PinDef {
  id: string;
  label: string; // Spanish, e.g. 'Ánodo (+)'
  x: number; // integer, grid units, unrotated, relative to origin
  y: number;
  kind: 'terminal' | 'power' | 'ground' | 'gpio' | 'reset' | 'nc' | 'hole';
  /** Overlap connectivity: only male↔female overlaps connect. Resolved by catalog (default 'male'). */
  contact?: 'male' | 'female';
  polarity?: '+' | '-';
  hint?: string; // e.g. 'Pata larga'
}

export interface PropOption {
  value: string | number;
  label: string;
}

export interface PropDef {
  key: string;
  label: string; // Spanish
  type: 'enum' | 'number' | 'boolean';
  options?: PropOption[];
  default: PropValue;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /**
   * Runtime props change while simulating (button pressed, knob position,
   * light level, switch position). The sim store keeps live overrides for
   * them; the persisted value is the initial state.
   */
  runtime?: boolean;
}

export type ElectricalModel =
  | { model: 'none' }
  | { model: 'bus' } // breadboard: connectivity only (internalBuses)
  | { model: 'resistor'; resistanceProp: string }
  | { model: 'potentiometer'; resistanceProp: string; positionProp: string } // position 0..100 (% from a to b)
  | { model: 'ldr'; darkOhms: number; brightOhms: number; lightProp: string } // light 0..100, log interpolation
  | {
      model: 'led';
      colorProp: string;
      vf: Record<string, number>; // forward voltage per color value
      seriesOhms: number; // dynamic resistance above Vf
      ratedmA: number; // full brightness
      maxmA: number; // above this the LED burns (after a short grace time)
    }
  | {
      model: 'rgb-led';
      common: 'cathode';
      vf: { r: number; g: number; b: number };
      seriesOhms: number;
      ratedmA: number;
      maxmA: number;
    }
  | { model: 'diode'; vf: number; seriesOhms: number; maxmA: number }
  | { model: 'battery'; voltage: number; internalOhms: number; capacitymAh: number }
  /**
   * push : stateProp boolean 'pressed' → closed joins the a-group (a1,a2) with the b-group (b1,b2).
   * slide: stateProp 'position' 'a' → com↔a closed, 'b' → com↔b closed.
   */
  | { model: 'switch'; kind: 'push' | 'slide'; stateProp: string; onOhms: number }
  /**
   * passive: sounds ONLY while its driving pin has toneHz (tone()); DC just clicks (silent).
   * active : sounds at fixedHz whenever |V| ≥ minVolts.
   */
  | { model: 'buzzer'; kind: 'passive' | 'active'; ohms: number; minVolts: number; fixedHz?: number }
  | { model: 'motor'; ohms: number; minVolts: number; ratedVolts: number; stallmA: number }
  | { model: 'npn'; beta: number; vbe: number; vceSat: number; maxmA: number }
  | { model: 'servo'; loadOhms: number; minVolts: number }
  | { model: 'mcu'; board: BoardId };

export type ElectricalModelName = ElectricalModel['model'];

export type SchematicSymbol =
  | 'mcu'
  | 'resistor'
  | 'potentiometer'
  | 'ldr'
  | 'led'
  | 'rgb-led'
  | 'diode'
  | 'battery'
  | 'push-button'
  | 'slide-switch'
  | 'buzzer'
  | 'motor'
  | 'npn'
  | 'servo'
  | 'none';

export interface PartDef {
  type: string; // 'led'
  name: string; // Spanish display name: 'LED'
  category: PartCategory;
  description: string; // one-line Spanish summary for the palette
  idPrefix: string; // 'led' → ids 'led1', 'led2'
  defaultLabel: string; // 'LED' → labels 'LED 1', 'LED 2'
  bounds: { x: number; y: number; w: number; h: number };
  /** Static pins. Empty when `generator` is set (pins are generated in catalog/). */
  pins: PinDef[];
  generator?: 'breadboard-half' | 'board-profile';
  /** For generator 'board-profile'. */
  board?: BoardId;
  /** Pin groups that are always connected inside the part. */
  internalBuses?: string[][];
  props: PropDef[];
  electrical: ElectricalModel;
  /** How the user interacts with it while the simulation is live. */
  interactive?: 'press' | 'toggle' | 'knob' | 'light';
  /** Pins that normally go to a board GPIO (used to derive Bindings). */
  signalPins?: string[];
  /** IR part-level node kinds this part enables in the block toolbox. */
  blocks?: string[];
  schematic: { symbol: SchematicSymbol };
  breadboard: { insertable: boolean };
  education: {
    summary: string; // 1–2 sentences, Spanish
    howItWorks: string; // short paragraph
    tips: string[];
    warnings?: string[];
  };
  kitQty?: number;
}
