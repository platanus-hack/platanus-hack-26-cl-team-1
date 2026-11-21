/**
 * Netlist → schematic graph (pure, testable).
 *  - nodes: every part except the breadboard (symbol 'none' is skipped)
 *  - ports: one per (part, net, internal pin group) for nets touching ≥ 2
 *    parts, or ≥ 2 separate pins of one part (a battery or board shorted by a
 *    wire, a bypassed LED); pins joined inside the part (internalBuses: the
 *    button pairs, the board GNDs, SDA=A4) share a port
 *  - nets with 2 ports → one direct edge; more → a junction node + edges
 * Keys use pin refs (stable) instead of NetIds (only stable per build).
 */
import type { BoardProfile, Netlist, PartDef, PinRef, ProjectModel, SchematicSymbol } from '@/contracts';
import { canonicalBoardPin, findPartDef, projectBoard } from '@/catalog';
import { formatOhms } from '@/lib/format';
import { netKindOf } from '@/placement';
import { MCU_W, type PortGeom, type Side, isFlippable, mcuHeight, symbolGeometry, symbolValue, textWidth } from './geometry';

export type NetKind = 'ground' | 'supply' | 'signal';

export interface SPort {
  id: string; // `${nodeId}::${pin}`
  node: string;
  pin: string; // representative pin id
  pins: string[]; // all pins of the part in this net
  ref: PinRef; // representative pin ref
  netKey: string;
  label: string; // board pins: 'D13', 'GND', '5V'
  side: Side;
  /** Fixed position (discrete symbols); undefined for MCU ports (ELK places them). */
  x?: number;
  y?: number;
}

export interface SNode {
  id: string; // part id
  type: string;
  symbol: SchematicSymbol;
  label: string;
  value?: string;
  w: number;
  h: number;
  flipped: boolean;
  labelPos: 'top' | 'right';
  ports: SPort[];
  /** Every pin drawn by the symbol → its geometry (also unconnected ones). */
  terminals: Record<string, PortGeom>;
  boardName?: string;
  /** MCU subtitle, e.g. 'ATmega328P · 5 V'. */
  boardSub?: string;
}

export interface SJunction {
  id: string; // `j::${netKey}`
  netKey: string;
}

export interface SEdge {
  id: string;
  netKey: string;
  source: { node: string; port?: string };
  target: { node: string; port?: string };
  /** Pin refs at the source / target end (for live current lookups). */
  sourceRef?: PinRef;
  targetRef?: PinRef;
}

export interface SNet {
  key: string;
  name?: string;
  kind: NetKind;
  /** All pin refs of the net (incl. breadboard holes) — pick any for voltages. */
  refs: PinRef[];
  ports: SPort[];
  wires: string[];
  junction?: string;
}

export interface SchematicGraph {
  nodes: SNode[];
  junctions: SJunction[];
  edges: SEdge[];
  nets: SNet[];
  topologyKey: string;
}

function boardPinLabel(profile: BoardProfile, pinId: string): string {
  const p = profile.pins.find((x) => x.id === pinId);
  if (!p) return pinId;
  if (p.kind === 'ground') return 'GND';
  return canonicalBoardPin(profile, pinId);
}

const BOARD_PIN_ORDER: Record<string, number> = { power: 0, gpio: 1, reset: 2, aref: 2, nc: 3, ground: 4 };

/** A part's pins of one net, split into groups that are joined inside the part (internalBuses). */
function pinGroups(def: PartDef, pins: string[]): string[][] {
  const busOf = new Map<string, number>();
  (def.internalBuses ?? []).forEach((bus, i) => bus.forEach((p) => busOf.set(p, i)));
  const groups = new Map<string, string[]>();
  for (const p of pins) {
    const k = busOf.has(p) ? `#${busOf.get(p)}` : p;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups.values()];
}

export function buildSchematicGraph(project: ProjectModel, netlist: Netlist): SchematicGraph {
  const board = projectBoard(project);
  const parts = new Map<string, { def: PartDef; part: ProjectModel['parts'][number] }>();
  for (const part of project.parts) {
    const def = findPartDef(part.type);
    if (!def || def.electrical.model === 'bus' || def.schematic.symbol === 'none') continue;
    parts.set(part.id, { def, part });
  }

  // ---- nets with ≥ 2 parts
  interface RawNet {
    netKey: string;
    name?: string;
    refs: PinRef[];
    byPart: Map<string, string[]>;
    /** byPart split into internally-joined pin groups (one port each). */
    groups: Map<string, string[][]>;
    wires: string[];
  }
  const rawNets: RawNet[] = [];
  for (const net of netlist.nets) {
    const byPart = new Map<string, string[]>();
    for (const ref of net.pins) {
      const dot = ref.indexOf('.');
      const pid = ref.slice(0, dot);
      if (!parts.has(pid)) continue;
      byPart.set(pid, [...(byPart.get(pid) ?? []), ref.slice(dot + 1)]);
    }
    const groups = new Map([...byPart].map(([pid, pins]) => [pid, pinGroups(parts.get(pid)!.def, pins)] as const));
    const portCount = [...groups.values()].reduce((n, g) => n + g.length, 0);
    if (byPart.size < 2 && portCount < 2) continue;
    const memberRefs = [...byPart.entries()].flatMap(([pid, pins]) => pins.map((p) => `${pid}.${p}`)).sort();
    rawNets.push({ netKey: memberRefs[0], name: net.name, refs: net.pins, byPart, groups, wires: net.wires });
  }

  // ---- depth from sources (boards, batteries) for edge direction / flips
  const adjacency = new Map<string, Set<string>>();
  for (const n of rawNets) {
    const ids = [...n.byPart.keys()];
    for (const a of ids) for (const b of ids) if (a !== b) (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, { def }] of parts) {
    if (def.electrical.model === 'mcu' || def.electrical.model === 'battery') {
      depth.set(id, 0);
      queue.push(id);
    }
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adjacency.get(id) ?? []) {
      if (depth.has(n)) continue;
      depth.set(n, depth.get(id)! + 1);
      queue.push(n);
    }
  }
  const depthOf = (id: string) => depth.get(id) ?? 50;
  const netDepthFor = (net: RawNet, self: string) => Math.min(99, ...[...net.byPart.keys()].filter((p) => p !== self).map(depthOf));

  // ---- nodes
  const nodes: SNode[] = [];
  const nodeById = new Map<string, SNode>();
  const netsOfPart = new Map<string, RawNet[]>();
  for (const n of rawNets) for (const pid of n.byPart.keys()) netsOfPart.set(pid, [...(netsOfPart.get(pid) ?? []), n]);

  for (const [id, { def, part }] of parts) {
    const symbol = def.schematic.symbol;
    const label = part.label;
    if (symbol === 'mcu') {
      const profile = board && board.part.id === id ? board.profile : null;
      const pinNets = (netsOfPart.get(id) ?? []).flatMap((n) => n.groups.get(id)!.map((pins) => ({ n, pins })));
      const ports: SPort[] = pinNets.map(({ n, pins }) => {
        const sorted = [...pins].sort((a, b) => {
          const pa = profile?.pins.find((p) => p.id === a), pb = profile?.pins.find((p) => p.id === b);
          return Number(!!pa?.aliasOf) - Number(!!pb?.aliasOf);
        });
        const pin = sorted[0];
        return {
          id: `${id}::${pin}`,
          node: id,
          pin,
          pins,
          ref: `${id}.${pin}`,
          netKey: n.netKey,
          label: profile ? boardPinLabel(profile, pin) : pin,
          side: 'EAST' as const,
        };
      });
      ports.sort((a, b) => {
        const ka = profile?.pins.find((p) => p.id === a.pin)?.kind ?? 'gpio';
        const kb = profile?.pins.find((p) => p.id === b.pin)?.kind ?? 'gpio';
        return (BOARD_PIN_ORDER[ka] ?? 1) - (BOARD_PIN_ORDER[kb] ?? 1) || a.label.localeCompare(b.label, 'es', { numeric: true });
      });
      const boardName = profile?.name ?? def.name;
      const boardSub = profile ? `${profile.mcu.split(' (')[0]} · ${String(profile.logicVoltage).replace('.', ',')} V` : label;
      const longestPin = Math.max(0, ...ports.map((p) => p.label.length));
      const node: SNode = {
        id,
        type: part.type,
        symbol,
        label,
        w: Math.max(MCU_W, textWidth(boardName, 12.5) + 34, longestPin * 7 + 72),
        h: mcuHeight(ports.length),
        flipped: false,
        labelPos: 'top',
        ports,
        terminals: {},
        boardName,
        boardSub,
      };
      nodes.push(node);
      nodeById.set(id, node);
      continue;
    }

    const value = symbolValue(def, part.props, formatOhms);
    // Flip non-polar 2-terminal parts so the side closer to the source faces WEST.
    let flip = false;
    if (isFlippable(symbol)) {
      const base = symbolGeometry(symbol, label, value, false);
      const westPins = base ? Object.entries(base.ports).filter(([, p]) => p.side === 'WEST').map(([k]) => k) : [];
      const eastPins = base ? Object.entries(base.ports).filter(([, p]) => p.side === 'EAST').map(([k]) => k) : [];
      const sideDepth = (pins: string[]) =>
        Math.min(99, ...(netsOfPart.get(id) ?? []).filter((n) => n.byPart.get(id)!.some((p) => pins.includes(p))).map((n) => netDepthFor(n, id)));
      flip = sideDepth(eastPins) < sideDepth(westPins);
    }
    const geom = symbolGeometry(symbol, label, value, flip);
    if (!geom) continue;
    const ports: SPort[] = (netsOfPart.get(id) ?? []).flatMap((n) =>
      n.groups.get(id)!.map((pins) => {
        const pin = pins.find((p) => geom.ports[p]) ?? pins[0];
        const g = geom.ports[pin] ?? { side: 'WEST' as const, x: 0, y: geom.h / 2 };
        return { id: `${id}::${pin}`, node: id, pin, pins, ref: `${id}.${pin}`, netKey: n.netKey, label: pin, side: g.side, x: g.x, y: g.y };
      }),
    );
    const node: SNode = { id, type: part.type, symbol, label, value, w: geom.w, h: geom.h, flipped: geom.flipped, labelPos: geom.labelPos, ports, terminals: geom.ports };
    nodes.push(node);
    nodeById.set(id, node);
  }

  // ---- nets, junctions, edges
  const nets: SNet[] = [];
  const junctions: SJunction[] = [];
  const edges: SEdge[] = [];
  for (const n of rawNets) {
    const ports = [...n.byPart.keys()].flatMap((pid) => nodeById.get(pid)?.ports.filter((p) => p.netKey === n.netKey) ?? []);
    if (ports.length < 2) continue;
    const k = netKindOf(project, netlist, [ports[0].ref]);
    const kind: NetKind = n.name === 'GND' || /BAT[-−]$/.test(n.name ?? '') || k === 'ground' ? 'ground' : k === 'supply' ? 'supply' : 'signal';
    const net: SNet = { key: n.netKey, name: n.name, kind, refs: n.refs, ports, wires: n.wires };
    nets.push(net);
    const rank = (p: SPort) => depthOf(p.node) * 2 + (p.side === 'EAST' || p.side === 'SOUTH' ? 0 : 1);
    if (ports.length === 2) {
      let [a, b] = [...ports].sort((x, y) => rank(x) - rank(y));
      if (kind === 'ground') [a, b] = [b, a]; // flow into ground
      edges.push({ id: `e::${n.netKey}`, netKey: n.netKey, source: { node: a.node, port: a.id }, target: { node: b.node, port: b.id }, sourceRef: a.ref, targetRef: b.ref });
      continue;
    }
    const jid = `j::${n.netKey}`;
    junctions.push({ id: jid, netKey: n.netKey });
    net.junction = jid;
    const minDepth = Math.min(...ports.map((p) => depthOf(p.node)));
    ports.forEach((p, i) => {
      const intoJunction = kind === 'ground' || depthOf(p.node) === minDepth;
      edges.push(
        intoJunction
          ? { id: `e::${n.netKey}::${i}`, netKey: n.netKey, source: { node: p.node, port: p.id }, target: { node: jid }, sourceRef: p.ref }
          : { id: `e::${n.netKey}::${i}`, netKey: n.netKey, source: { node: jid }, target: { node: p.node, port: p.id }, targetRef: p.ref },
      );
    });
  }

  const topologyKey = JSON.stringify({
    n: nodes.map((x) => [x.id, x.symbol, x.w, x.h, x.flipped, x.ports.map((p) => [p.pin, p.side, p.x, p.y])]),
    j: junctions.map((j) => j.id),
    e: edges.map((e) => [e.source.port ?? e.source.node, e.target.port ?? e.target.node]),
  });
  return { nodes, junctions, edges, nets, topologyKey };
}
