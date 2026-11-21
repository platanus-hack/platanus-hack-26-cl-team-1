/** Static reachability helpers for the design-rule checks. */
import type { Id } from '@/contracts';
import { isGroundNet, isSourceNet, type Analysis, type NetInfo } from '../analysis';

export interface NetReach {
  /** Reached a supply + (board rail or battery +). */
  source: boolean;
  /** Reached board GND or a battery −. */
  ground: boolean;
  gpio: boolean;
  nets: NetInfo[];
}

/**
 * Nets reachable from `start` WITHOUT crossing anything that limits current:
 * conductors, switches/buttons (any state — they may be closed), diodes and an
 * NPN collector↔emitter. Resistors and loads stop the walk.
 */
export function reachUnlimited(an: Analysis, start: number, exclude: Id): NetReach {
  const out: NetReach = { source: false, ground: false, gpio: false, nets: [] };
  if (start < 0) return out;
  const seen = new Set<number>([start]);
  const queue = [start];
  for (let q = 0; q < queue.length && q < 64; q++) {
    const info = an.nets[queue[q]];
    out.nets.push(info);
    if (isSourceNet(info)) out.source = true;
    if (isGroundNet(info)) out.ground = true;
    if (info.gpios.length) out.gpio = true;
    for (const idx of info.pins) {
      const pin = an.topo.pins[idx];
      const rec = an.topo.parts[pin.part];
      if (rec.part.id === exclude) continue;
      const model = rec.def.electrical.model;
      let next: string[] = [];
      if (model === 'switch') next = rec.def.pins.map((p) => p.id).filter((p) => p !== pin.def.id);
      else if (model === 'diode') next = [pin.def.id === 'anode' ? 'cathode' : 'anode'];
      else if (model === 'npn' && (pin.def.id === 'c' || pin.def.id === 'e')) next = [pin.def.id === 'c' ? 'e' : 'c'];
      for (const p of next) {
        const n = an.net(rec.part.id, p);
        if (n >= 0 && !seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }
  return out;
}

/** Spanish name of what a net is: '5V', 'GND', 'el pin D13', 'la batería'. */
export function describeNet(info: NetInfo | undefined, prefer: 'source' | 'ground'): string {
  if (!info) return 'otro punto';
  if (prefer === 'source') {
    if (info.rails.length) return `el pin ${info.rails[0]}`;
    if (info.batPlus.length) return 'el polo + de la batería';
  } else {
    if (info.ground) return 'GND';
    if (info.batMinus.length) return 'el polo − de la batería';
  }
  if (info.gpios.length) return `el pin ${info.gpios[0]}`;
  if (info.rails.length) return `el pin ${info.rails[0]}`;
  if (info.ground) return 'GND';
  return 'otro punto del circuito';
}

export function firstNet(r: NetReach, pred: (n: NetInfo) => boolean): NetInfo | undefined {
  return r.nets.find(pred);
}
