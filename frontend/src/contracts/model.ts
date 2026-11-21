/**
 * CONTRACT 1 — ProjectModel
 * ---------------------------------------------------------------------------
 * The single persisted document. Everything the user builds lives here and is
 * mutated ONLY through Ops (see ops.ts) so that undo/redo and the agent share
 * one code path.
 *
 * Coordinate system: GRID UNITS. 1 unit = 0.1 inch = 2.54 mm (breadboard
 * pitch). Part origins and pin positions are integers, so pins always sit on
 * grid points. Renderers draw in grid units too (the canvas scales the SVG).
 *
 * Connectivity rule (implemented by circuit/buildNetlist):
 *   1. Overlap: a MALE pin and a FEMALE pin at the same world grid point are
 *      connected (a LED leg in a breadboard hole, a leg pushed into an Uno
 *      header socket). PinDef.contact says which is which (catalog resolves it:
 *      breadboard holes + Uno header sockets = female; component legs, battery
 *      leads, servo connector and ESP32 header pins = male). Male–male and
 *      female–female overlaps do NOT connect (two loose legs touching, a board
 *      header lying on a breadboard rail).
 *   2. A Wire connects its `from` and `to` pins (wires plug into anything).
 *   3. PartDef.internalBuses connect pins inside a part (breadboard strips,
 *      tactile-button leg pairs, all GND pins of a board).
 *   A breadboard hole whose position lies inside the body bounds of another
 *   non-breadboard part (e.g. under an ESP32 devkit) is "covered": still
 *   electrically part of its strip, but not free for new legs or wire ends.
 */

export type Id = string;
export type BoardId = 'uno' | 'esp32c6';

export interface Point {
  x: number;
  y: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export type PropValue = string | number | boolean;

/**
 * Pin reference: "<partId>.<pinId>".
 * Examples: "led1.anode", "uno1.D13", "bb1.a10" (breadboard hole), "bb1.T+3".
 * Use lib/pinref.ts helpers (pinRef / parsePinRef) instead of string ops.
 */
export type PinRef = string;

export interface PartInstance {
  id: Id; // 'led1' — unique, stable, generated from PartDef.idPrefix
  type: string; // PartDef.type, e.g. 'led'
  label: string; // human label, e.g. 'LED 1'. Codegen derives identifiers from it (LED_1)
  x: number; // integer grid position of the part origin (world)
  y: number;
  rotation: Rotation; // clockwise, about the part origin
  props: Record<string, PropValue>; // values for PartDef.props (missing => default)
}

export type WireColor =
  | 'red'
  | 'black'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'orange'
  | 'white'
  | 'purple';

export interface Wire {
  id: Id; // 'w1'
  from: PinRef;
  to: PinRef;
  color: WireColor;
  /** Optional intermediate bend points in world grid units (user-dragged). */
  waypoints?: Point[];
}

export interface ProgramModel {
  /**
   * Blockly serialization (Blockly.serialization.workspaces.save output).
   * Source of truth for the block editor. null = empty program.
   * The Block IR is DERIVED from this (program/blocks/workspaceToIR).
   */
  workspace: unknown | null;
}

export interface ProjectModel {
  version: 1;
  id: Id;
  name: string;
  /** Render/z order = array order (later = on top). */
  parts: PartInstance[];
  wires: Wire[];
  program: ProgramModel;
  meta: {
    createdAt: string; // ISO
    updatedAt: string; // ISO
    description?: string;
    exampleId?: string;
  };
}

/* ------------------------------------------------------------------------- */
/* DERIVED (never persisted) — produced by the circuit module                */
/* ------------------------------------------------------------------------- */

export type NetId = string; // 'n1', 'n2', … stable only within one netlist build

export interface Net {
  id: NetId;
  /** All pins electrically joined (after wires + internal buses + overlap). */
  pins: PinRef[];
  /**
   * Friendly name when the net touches a board/supply pin:
   * 'GND', '5V', '3V3', 'D13', 'GPIO4', 'BAT+'. Otherwise undefined.
   */
  name?: string;
  /** Wires whose both ends are in this net. */
  wires: Id[];
}

export interface Netlist {
  nets: Net[];
  /** Every pin of every part (incl. breadboard holes) → its net. */
  pinNet: Record<PinRef, NetId>;
  /** Pins of non-breadboard parts that share a grid point with a breadboard hole / other pin. */
  insertions: Array<{ pin: PinRef; into: PinRef }>;
}

/**
 * Binding: which board pin drives/reads a part's signal. Derived by
 * circuit/deriveBindings. Rules:
 *  - Exactly ONE Binding per (part, channel) (channel only for RGB LEDs).
 *    `pin` is the part pin through which the board pin is reached. Parts with
 *    signalPins but no route get a Binding with boardPin = null (so the
 *    toolbox/codegen can warn "no conectado").
 *  - Walk: part signal pin → its net; if the net has a board GPIO → done.
 *    Otherwise pass through ≤ 2 series two-terminal parts (resistor, diode),
 *    and, for a load on an NPN COLLECTOR (motor, LED, buzzer), continue from
 *    the NPN BASE (→ base resistor → GPIO). Traversed parts go in `via` in
 *    order, e.g. motor: { pin: 'b', boardPin: 'D9', via: ['q1', 'r2'], driver: 'npn' }.
 *  - Board pins are always CANONICAL ids (BoardPin.aliasOf resolved: SDA→A4).
 *  - activeLow (inputs AND outputs) = "the part is ON / active when the GPIO
 *    is LOW": true for an LED sinking into the GPIO (anode to +), a button or
 *    slide switch whose other side goes to GND (INPUT_PULLUP); false for a
 *    sourcing LED, an NPN low-side driver, a button to + with pull-down.
 *  - Slide switch: com on the GPIO; "ON" = position 'b'; activeLow when the
 *    'b' throw goes to GND.
 *  - invert (analog sensors) = raising light/knob position LOWERS the pin
 *    voltage (LDR on the bottom of the divider, pot wired a→+ / b→GND).
 */
export interface Binding {
  part: Id; // 'led1'
  pin: string; // part pin id through which the board pin is reached: 'anode', 'a1', 'wiper', 'b'…
  boardPin: string | null; // canonical BoardPin.id, e.g. 'D13', 'A0', 'GPIO4'; null = not wired to a GPIO
  /** Arduino identifier to use in C code: '13', 'A0', '4'. null when unbound. */
  codeName: string | null;
  /** The part is ON/active when the GPIO is LOW (see rules above). */
  activeLow: boolean;
  /** Analog sensors: more light / higher position reads a LOWER voltage. */
  invert?: boolean;
  /** Recommended pinMode for codegen/sim ('ANALOG' = no pinMode call). */
  mode: 'OUTPUT' | 'INPUT' | 'INPUT_PULLUP' | 'ANALOG';
  /** How an output is driven: straight from the pin or through an NPN transistor. */
  driver?: 'direct' | 'npn';
  /** Series parts traversed between the part pin and the board pin (e.g. ['r1'] or ['q1','r2']). */
  via: Id[];
  /** For channels of multi-signal parts (RGB LED: 'r' | 'g' | 'b'). */
  channel?: string;
}
