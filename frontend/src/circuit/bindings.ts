/**
 * deriveBindings: which board GPIO drives/reads each part signal (see the
 * Binding doc in contracts/model.ts). Exactly one Binding per (part, channel).
 */
import type { Binding, Id, Netlist, ProjectModel } from '@/contracts';
import { getAnalysis, isGroundNet, isPowerNet, isSourceNet, otherTerminal, type Analysis } from './analysis';
import { getTopology, type PartRec } from './topology';

const SERIES_MODELS = new Set(['resistor', 'diode']);
const MAX_SERIES = 2;

interface Reach {
  boardPin: string;
  via: Id[];
  npn: boolean;
}

interface ReachOpts {
  /** Allow the NPN hop collector → base (loads: LED, motor, buzzer, RGB). */
  npn?: boolean;
  /** Prefer analog-capable GPIOs when a net has several. */
  analog?: boolean;
}

function pickGpio(an: Analysis, gpios: string[], analog?: boolean): string {
  if (analog && an.board) {
    const a = gpios.find((g) => an.board?.pins.get(g)?.caps?.includes('analog'));
    if (a) return a;
  }
  return gpios[0];
}

/** Walk from a part pin to a GPIO through ≤ 2 series parts (and one NPN collector→base hop). */
export function reachGpio(an: Analysis, rec: PartRec, pinId: string, opts: ReachOpts = {}): Reach | null {
  const { topo } = an;
  const visited = new Set<Id>([rec.part.id]);
  const walk = (net: number, via: Id[], series: number, usedNpn: boolean): Reach | null => {
    if (net < 0) return null;
    const info = an.nets[net];
    if (info.gpios.length) return { boardPin: pickGpio(an, info.gpios, opts.analog), via, npn: usedNpn };
    if (isPowerNet(info)) return null; // supply / ground nets are terminals, never signal paths
    if (opts.npn && !usedNpn) {
      for (const idx of info.pins) {
        const pin = topo.pins[idx];
        const q = topo.parts[pin.part];
        if (q.def.electrical.model !== 'npn' || pin.def.id !== 'c' || visited.has(q.part.id)) continue;
        visited.add(q.part.id);
        const r = walk(an.net(q.part.id, 'b'), [...via, q.part.id], 0, true);
        if (r) return r;
        visited.delete(q.part.id);
      }
    }
    if (series < MAX_SERIES) {
      for (const idx of info.pins) {
        const pin = topo.pins[idx];
        const s = topo.parts[pin.part];
        if (!SERIES_MODELS.has(s.def.electrical.model) || visited.has(s.part.id)) continue;
        const other = otherTerminal(s, pin.def.id);
        if (!other) continue;
        visited.add(s.part.id);
        const r = walk(an.net(s.part.id, other), [...via, s.part.id], series + 1, usedNpn);
        if (r) return r;
        visited.delete(s.part.id);
      }
    }
    return null;
  };
  return walk(an.net(rec.part.id, pinId), [], 0, false);
}

export type Side = 'ground' | 'supply' | 'gpio' | 'none';

/** What a pin ultimately goes to: its own net, else through one resistor (ground/supply preferred over a GPIO). */
export function sideOf(an: Analysis, rec: PartRec, pinId: string): Side {
  const direct = an.info(rec.part.id, pinId);
  if (!direct) return 'none';
  const classify = (n: (typeof an.nets)[number]): Side =>
    isGroundNet(n) ? 'ground' : isSourceNet(n) ? 'supply' : n.gpios.length ? 'gpio' : 'none';
  const d = classify(direct);
  if (d !== 'none') return d;
  let viaGpio = false;
  for (const idx of direct.pins) {
    const pin = an.topo.pins[idx];
    const s = an.topo.parts[pin.part];
    if (s === rec || s.def.electrical.model !== 'resistor') continue;
    const other = otherTerminal(s, pin.def.id);
    if (!other) continue;
    const info = an.info(s.part.id, other);
    if (!info) continue;
    const c = classify(info);
    if (c === 'ground' || c === 'supply') return c;
    if (c === 'gpio') viaGpio = true;
  }
  return viaGpio ? 'gpio' : 'none';
}

type Mode = Binding['mode'];

function binding(an: Analysis, rec: PartRec, pin: string, reach: Reach | null, mode: Mode, activeLow: boolean, extra: Partial<Binding> = {}): Binding {
  const boardPin = reach?.boardPin ?? null;
  const out: Binding = {
    part: rec.part.id,
    pin,
    boardPin,
    codeName: boardPin ? (an.board?.pins.get(boardPin)?.codeName ?? null) : null,
    activeLow,
    mode,
    via: reach?.via ?? [],
    ...extra,
  };
  if (mode === 'OUTPUT' && out.driver === undefined) out.driver = reach?.npn ? 'npn' : 'direct';
  return out;
}

/**
 * Output load: try pins in order; a sinking connection (load between + and the GPIO) is activeLow.
 * A load whose + side sits on an NPN collector and whose − side goes to GND is in PARALLEL with
 * the transistor (inverter: collector pulled up by a resistor): it is ON while the GPIO is LOW.
 */
function outputLoad(an: Analysis, rec: PartRec, plusPin: string, minusPin: string): Binding {
  const a = reachGpio(an, rec, plusPin, { npn: true });
  if (a) return binding(an, rec, plusPin, a, 'OUTPUT', a.npn && sideOf(an, rec, minusPin) === 'ground');
  const c = reachGpio(an, rec, minusPin, { npn: true });
  if (c) return binding(an, rec, minusPin, c, 'OUTPUT', !c.npn && sideOf(an, rec, plusPin) === 'supply');
  return binding(an, rec, plusPin, null, 'OUTPUT', false);
}

function buttonBinding(an: Analysis, rec: PartRec): Binding {
  const groups = [
    ['a1', 'a2'],
    ['b1', 'b2'],
  ];
  for (let g = 0; g < 2; g++) {
    for (const pinId of groups[g]) {
      const r = reachGpio(an, rec, pinId);
      if (!r) continue;
      const other = groups[1 - g];
      const side = other.map((p) => sideOf(an, rec, p)).find((s) => s === 'ground' || s === 'supply') ?? 'none';
      if (side === 'supply') return binding(an, rec, pinId, r, 'INPUT', false);
      return binding(an, rec, pinId, r, 'INPUT_PULLUP', true);
    }
  }
  return binding(an, rec, 'a1', null, 'INPUT_PULLUP', true);
}

function slideBinding(an: Analysis, rec: PartRec): Binding {
  const com = reachGpio(an, rec, 'com');
  if (com) {
    const b = sideOf(an, rec, 'b');
    const a = sideOf(an, rec, 'a');
    if (b === 'ground') return binding(an, rec, 'com', com, 'INPUT_PULLUP', true);
    if (b === 'supply') return binding(an, rec, 'com', com, 'INPUT', false);
    if (a === 'ground') return binding(an, rec, 'com', com, 'INPUT_PULLUP', false);
    if (a === 'supply') return binding(an, rec, 'com', com, 'INPUT', true);
    return binding(an, rec, 'com', com, 'INPUT_PULLUP', true);
  }
  // Wired as a simple on/off switch: a throw on the GPIO, com to GND / +.
  const comSide = sideOf(an, rec, 'com');
  const b = reachGpio(an, rec, 'b');
  if (b) {
    if (comSide === 'supply') return binding(an, rec, 'b', b, 'INPUT', false);
    return binding(an, rec, 'b', b, 'INPUT_PULLUP', true);
  }
  const a = reachGpio(an, rec, 'a');
  if (a) {
    // ON = position b opens com–a.
    if (comSide === 'supply') return binding(an, rec, 'a', a, 'INPUT', true);
    return binding(an, rec, 'a', a, 'INPUT_PULLUP', false);
  }
  return binding(an, rec, 'com', null, 'INPUT_PULLUP', true);
}

function potBinding(an: Analysis, rec: PartRec): Binding {
  const r = reachGpio(an, rec, 'wiper', { analog: true });
  // Position goes a → b: raising it lowers the wiper voltage when a is the + end.
  const invert = sideOf(an, rec, 'a') === 'supply' && sideOf(an, rec, 'b') === 'ground';
  return binding(an, rec, 'wiper', r, 'ANALOG', false, { invert });
}

function ldrBinding(an: Analysis, rec: PartRec): Binding {
  for (const [t, other] of [
    ['a', 'b'],
    ['b', 'a'],
  ] as const) {
    const r = reachGpio(an, rec, t, { analog: true });
    if (!r) continue;
    // LDR on the bottom of the divider (other leg to GND): more light → lower voltage.
    return binding(an, rec, t, r, 'ANALOG', false, { invert: sideOf(an, rec, other) === 'ground' });
  }
  return binding(an, rec, 'a', null, 'ANALOG', false, { invert: false });
}

function bindingsForPart(an: Analysis, rec: PartRec): Binding[] {
  const el = rec.def.electrical;
  const signal = rec.def.signalPins ?? [];
  switch (el.model) {
    case 'led':
      return [outputLoad(an, rec, 'anode', 'cathode')];
    case 'buzzer':
      return [outputLoad(an, rec, 'plus', 'minus')];
    case 'motor':
      return [outputLoad(an, rec, 'a', 'b')];
    case 'rgb-led':
      return (['r', 'g', 'b'] as const).map((ch) =>
        binding(an, rec, ch, reachGpio(an, rec, ch, { npn: true }), 'OUTPUT', false, { channel: ch }),
      );
    case 'switch':
      return [el.kind === 'push' ? buttonBinding(an, rec) : slideBinding(an, rec)];
    case 'potentiometer':
      return [potBinding(an, rec)];
    case 'ldr':
      return [ldrBinding(an, rec)];
    case 'servo':
      return [binding(an, rec, 'signal', reachGpio(an, rec, 'signal'), 'OUTPUT', false, { driver: 'direct' })];
    default: {
      for (const pinId of signal) {
        const r = reachGpio(an, rec, pinId);
        if (r) return [binding(an, rec, pinId, r, 'OUTPUT', false)];
      }
      return [binding(an, rec, signal[0], null, 'OUTPUT', false)];
    }
  }
}

const cache = new WeakMap<Netlist, { project: ProjectModel; bindings: Binding[] }>();

export function deriveBindings(project: ProjectModel, netlist: Netlist): Binding[] {
  const hit = cache.get(netlist);
  if (hit && hit.project === project) return hit.bindings;
  const an = getAnalysis(getTopology(project));
  const out: Binding[] = [];
  for (const rec of an.topo.parts) {
    if (rec.bus || rec.board || !rec.def.signalPins?.length) continue;
    try {
      out.push(...bindingsForPart(an, rec));
    } catch {
      /* malformed part: skip rather than break every consumer */
    }
  }
  cache.set(netlist, { project, bindings: out });
  return out;
}
