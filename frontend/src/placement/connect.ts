/**
 * planConnect / planDisconnect: jumper wires like a real build. A part leg or
 * board header pin pushed into the breadboard is wired from a FREE hole of its
 * strip; a breadboard hole that is not free (covered by a body, holding a leg
 * or another wire end) is swapped for a free hole of the same strip. Off-board
 * pins (Uno sockets, loose parts) and free holes are used as given.
 */
import type { Id, Netlist, PartDef, PartInstance, PinDef, PinRef, Point, ProjectModel, Wire, WireColor } from '@/contracts';
import { findPartDef } from '@/catalog';
import { localToWorld } from '@/lib/geometry';
import { nextWireId } from '@/lib/ids';
import { parsePinRef } from '@/lib/pinref';
import type { PlanConnectResult, PlanDisconnectResult } from './types';
import { netlistFor } from './connectivity';
import { type HoleInfo, type Occupancy, buildOccupancy, isBoardPartDef, isBreadboardDef, isHoleFree, pointKey } from './space';

export const SIGNAL_COLORS: WireColor[] = ['yellow', 'green', 'blue', 'orange', 'white', 'purple'];

interface Endpoint {
  ref: PinRef;
  part: PartInstance;
  def: PartDef;
  pin: PinDef;
  pos: Point;
}

function resolveRef(project: ProjectModel, ref: PinRef): Endpoint | string {
  const { part: partId, pin: pinId } = parsePinRef(ref);
  if (!pinId) return `«${ref}» no es un pin válido: usa el formato componente.pin (por ejemplo led1.anode o uno1.D13).`;
  const part = project.parts.find((p) => p.id === partId);
  if (!part) return `No existe el componente «${partId}» (pin ${ref}).`;
  const def = findPartDef(part.type);
  const pin = def?.pins.find((p) => p.id === pinId);
  if (!def || !pin) {
    const sample = def?.pins.slice(0, 6).map((p) => p.id).join(', ');
    return `${part.label} no tiene un pin «${pinId}»${sample ? ` (algunos pines: ${sample}…)` : ''}.`;
  }
  return { ref, part, def, pin, pos: localToWorld(part, pin) };
}

/**
 * Breadboard hole a (non-breadboard) part pin is inserted into. The geometric
 * fallback only applies to male pins: a female socket (Uno header) lying over
 * a hole is NOT connected to it.
 */
function insertionHole(net: Netlist, occ: Occupancy, ep: Endpoint): HoleInfo | undefined {
  for (const ins of net.insertions) {
    if (ins.pin !== ep.ref) continue;
    const h = occ.holeByRef.get(ins.into);
    if (h) return h;
  }
  if ((ep.pin.contact ?? 'male') !== 'male') return undefined;
  return occ.holeAt.get(pointKey(ep.pos));
}

/** Free hole of a strip closest to `toward` (null when the strip is full or covered). */
export function freeHoleInStrip(occ: Occupancy, strip: string, toward: Point, exclude?: PinRef): HoleInfo | null {
  let best: HoleInfo | null = null;
  let bestD = Infinity;
  for (const bb of occ.boards) {
    const holes = bb.strips.get(strip);
    if (!holes) continue;
    for (const h of holes) {
      if (h.ref === exclude || !isHoleFree(occ, h)) continue;
      const d = Math.hypot(h.x - toward.x, h.y - toward.y);
      if (d < bestD - 1e-9) {
        best = h;
        bestD = d;
      }
    }
  }
  return best;
}

interface Resolved {
  ref: PinRef;
  pos: Point;
  note?: string;
}

function resolveEnd(net: Netlist, occ: Occupancy, ep: Endpoint, toward: Point, exclude?: PinRef): Resolved {
  if (isBreadboardDef(ep.def)) {
    const hole = occ.holeByRef.get(ep.ref);
    if (!hole || (isHoleFree(occ, hole) && hole.ref !== exclude)) return { ref: ep.ref, pos: ep.pos };
    const free = freeHoleInStrip(occ, hole.strip, toward, exclude);
    if (free) return { ref: free.ref, pos: free };
    return { ref: ep.ref, pos: ep.pos, note: `El agujero ${hole.id} no está libre y su columna no tiene otro agujero libre: el cable va igual a ${hole.id}.` };
  }
  const hole = insertionHole(net, occ, ep);
  if (!hole) return { ref: ep.ref, pos: ep.pos };
  const free = freeHoleInStrip(occ, hole.strip, toward, exclude);
  if (free) return { ref: free.ref, pos: free };
  const what = isBoardPartDef(ep.def) ? `del pin ${ep.pin.label} de ${ep.part.label}` : `de ${ep.part.label}`;
  const target = isBoardPartDef(ep.def) ? 'al pin' : 'a su pata';
  return {
    ref: ep.ref,
    pos: ep.pos,
    note: `La columna ${what} (${hole.id}) no tiene agujeros libres: el cable va directo ${target}.`,
  };
}

type NetKind = 'ground' | 'supply' | null;

function pinKind(project: ProjectModel, ref: PinRef): NetKind {
  const { part: partId, pin: pinId } = parsePinRef(ref);
  const part = project.parts.find((p) => p.id === partId);
  const def = part && findPartDef(part.type);
  if (!def) return null;
  if (isBreadboardDef(def)) {
    if (/^[TB]-/.test(pinId)) return 'ground';
    if (/^[TB]\+/.test(pinId)) return 'supply';
    return null;
  }
  const pin = def.pins.find((p) => p.id === pinId);
  if (!pin) return null;
  if (pin.kind === 'ground') return 'ground';
  if (pin.kind === 'power') return 'supply';
  if (def.electrical.model === 'battery') return pinId === 'minus' ? 'ground' : 'supply';
  return null;
}

/** 'ground' / 'supply' when a net touches GND/−/rail − or a supply/+/rail + (ground wins). */
export function netKindOf(project: ProjectModel, net: Netlist, refs: PinRef[]): NetKind {
  let kind: NetKind = null;
  const seen = new Set<string>();
  for (const ref of refs) {
    const netId = net.pinNet[ref];
    const pins = netId ? (net.nets.find((n) => n.id === netId)?.pins ?? [ref]) : [ref];
    if (netId && seen.has(netId)) continue;
    if (netId) seen.add(netId);
    const name = netId ? net.nets.find((n) => n.id === netId)?.name : undefined;
    if (name === 'GND' || /BAT[-−]$/.test(name ?? '')) return 'ground';
    if (name === '5V' || name === '3V3' || name === 'VIN' || /BAT\+$/.test(name ?? '')) kind = 'supply';
    for (const p of pins) {
      const k = pinKind(project, p);
      if (k === 'ground') return 'ground';
      if (k === 'supply') kind = 'supply';
    }
  }
  return kind;
}

export function autoWireColor(project: ProjectModel, net: Netlist, refs: PinRef[]): WireColor {
  const kind = netKindOf(project, net, refs);
  if (kind === 'ground') return 'black';
  if (kind === 'supply') return 'red';
  const signals = project.wires.filter((w) => w.color !== 'red' && w.color !== 'black').length;
  return SIGNAL_COLORS[signals % SIGNAL_COLORS.length];
}

export function planConnect(project: ProjectModel, from: PinRef, to: PinRef, color?: WireColor): PlanConnectResult {
  const a = resolveRef(project, from);
  if (typeof a === 'string') return { ops: [], wireId: '', from, to, error: a };
  const b = resolveRef(project, to);
  if (typeof b === 'string') return { ops: [], wireId: '', from, to, error: b };
  if (from === to) return { ops: [], wireId: '', from, to, error: 'Un cable necesita dos pines distintos.' };

  const net = netlistFor(project);
  const na = net.pinNet[from];
  if (na && na === net.pinNet[to]) return { ops: [], wireId: '', from, to, note: 'Ya estaban conectados' };

  const occ = buildOccupancy(project);
  const ra = resolveEnd(net, occ, a, b.pos);
  const rb = resolveEnd(net, occ, b, ra.pos, ra.ref);
  if (ra.ref === rb.ref) return { ops: [], wireId: '', from, to, note: 'Ya estaban conectados' };
  const wireColor = color ?? autoWireColor(project, net, [from, to]);
  const wire: Wire = { id: nextWireId(project), from: ra.ref, to: rb.ref, color: wireColor };
  const notes = [ra.note, rb.note].filter(Boolean);
  return {
    ops: [{ op: 'wire.add', wire }],
    wireId: wire.id,
    from: ra.ref,
    to: rb.ref,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/**
 * Matcher: a wire end "is" pin P when it equals P or is a hole of the strip P
 * is inserted into. A breadboard hole matches only itself, unless `strip`
 * (both ends given): then any hole of its strip, since planConnect may have
 * swapped a busy hole for a free one of the same strip.
 */
function endMatcher(project: ProjectModel, net: Netlist, occ: Occupancy, ref: PinRef, strip: boolean): (end: PinRef) => boolean {
  const ep = resolveRef(project, ref);
  if (typeof ep === 'string') return (end) => end === ref;
  const hole = isBreadboardDef(ep.def) ? (strip ? occ.holeByRef.get(ref) : undefined) : insertionHole(net, occ, ep);
  if (!hole) return (end) => end === ref;
  return (end) => end === ref || occ.holeByRef.get(end)?.strip === hole.strip;
}

export function planDisconnect(project: ProjectModel, q: { wireId?: Id; from?: PinRef; to?: PinRef }): PlanDisconnectResult {
  if (q.wireId) {
    const w = project.wires.find((x) => x.id === q.wireId);
    if (!w) return { ops: [], removed: [], error: `No existe el cable «${q.wireId}».` };
    return { ops: [{ op: 'wire.remove', id: w.id }], removed: [w.id] };
  }
  if (!q.from && !q.to) return { ops: [], removed: [], error: 'Indica el id del cable o los pines que une (from y to).' };
  for (const ref of [q.from, q.to]) {
    if (!ref) continue;
    const r = resolveRef(project, ref);
    if (typeof r === 'string') return { ops: [], removed: [], error: r };
  }
  const net = netlistFor(project);
  const occ = buildOccupancy(project);
  const both = !!q.from && !!q.to;
  const mf = q.from ? endMatcher(project, net, occ, q.from, both) : () => true;
  const mt = q.to ? endMatcher(project, net, occ, q.to, both) : () => true;
  const hits = project.wires.filter((w) => (mf(w.from) && mt(w.to)) || (mf(w.to) && mt(w.from)));
  if (hits.length === 0) {
    const what = q.from && q.to ? `entre ${q.from} y ${q.to}` : `en ${q.from ?? q.to}`;
    return { ops: [], removed: [], error: `No encontré cables ${what}.` };
  }
  return { ops: hits.map((w) => ({ op: 'wire.remove' as const, id: w.id })), removed: hits.map((w) => w.id) };
}
