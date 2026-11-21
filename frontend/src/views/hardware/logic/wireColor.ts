/**
 * Automatic jumper colour, following the hobbyist convention:
 * black = ground, red = power, otherwise cycle through signal colours.
 */
import type { Netlist, PinRef, ProjectModel, Wire, WireColor } from '@/contracts';
import { findPartDef } from '@/catalog';
import { parsePinRef } from '@/lib/pinref';

export type EndClass = 'ground' | 'power' | 'signal';

export const SIGNAL_CYCLE: WireColor[] = ['yellow', 'green', 'blue', 'orange', 'white', 'purple'];

export const WIRE_COLORS: Array<{ value: WireColor; label: string }> = [
  { value: 'red', label: 'Rojo' },
  { value: 'black', label: 'Negro' },
  { value: 'yellow', label: 'Amarillo' },
  { value: 'green', label: 'Verde' },
  { value: 'blue', label: 'Azul' },
  { value: 'orange', label: 'Naranjo' },
  { value: 'white', label: 'Blanco' },
  { value: 'purple', label: 'Morado' },
];

export const wireColorLabel = (c: WireColor) => WIRE_COLORS.find((w) => w.value === c)?.label ?? c;

const GROUND_NAME = /^(GND\d*|BAT[-−]|[TB][-−]|0V|VSS)$/i;
const POWER_NAME = /^(5V|3V3|3\.3V|VIN|VCC|VBUS|IOREF|BAT\+|[TB]\+)$/i;
const RAIL_GROUND_HOLE = /^[TB]-\d+$/;
const RAIL_POWER_HOLE = /^[TB]\+\d+$/;

/** Classify a single pin by its own definition (no net information). */
export function classifyPin(project: ProjectModel, ref: PinRef): EndClass {
  const { part: partId, pin: pinId } = parsePinRef(ref);
  const part = project.parts.find((p) => p.id === partId);
  const def = part ? findPartDef(part.type) : undefined;
  const pin = def?.pins.find((p) => p.id === pinId);
  if (!pin) return 'signal';
  if (pin.kind === 'ground') return 'ground';
  if (pin.kind === 'power') return 'power';
  // Polarity counts for rails / supplies only (an LED anode is not "power").
  if (pin.kind === 'hole' && pin.polarity === '-') return 'ground';
  if (pin.kind === 'hole' && pin.polarity === '+') return 'power';
  if (def?.electrical.model === 'battery') return pin.polarity === '-' ? 'ground' : pin.polarity === '+' ? 'power' : 'signal';
  return 'signal';
}

/** Classify an endpoint using its pin and, when available, its net (name / rail holes). */
export function classifyEndpoint(project: ProjectModel, netlist: Netlist | null, ref: PinRef): EndClass {
  const own = classifyPin(project, ref);
  if (own !== 'signal') return own;
  if (!netlist) return 'signal';
  const netId = netlist.pinNet[ref];
  if (!netId) return 'signal';
  const net = netlist.nets.find((n) => n.id === netId);
  if (!net) return 'signal';
  if (net.name && GROUND_NAME.test(net.name)) return 'ground';
  if (net.name && POWER_NAME.test(net.name)) return 'power';
  let ground = false;
  let power = false;
  for (const p of net.pins) {
    const pin = parsePinRef(p).pin;
    if (RAIL_GROUND_HOLE.test(pin)) ground = true;
    else if (RAIL_POWER_HOLE.test(pin)) power = true;
    else {
      const c = classifyPin(project, p);
      if (c === 'ground') ground = true;
      else if (c === 'power') power = true;
    }
  }
  if (ground) return 'ground';
  if (power) return 'power';
  return 'signal';
}

/** Colour for a new wire between two endpoint classes. */
export function autoWireColor(a: EndClass, b: EndClass, existing: readonly Wire[]): WireColor {
  if (a === 'ground' || b === 'ground') return 'black';
  if (a === 'power' || b === 'power') return 'red';
  const n = existing.filter((w) => SIGNAL_CYCLE.includes(w.color)).length;
  return SIGNAL_CYCLE[n % SIGNAL_CYCLE.length];
}
