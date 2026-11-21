/**
 * ELK layered layout of a SchematicGraph (async, cached by topology key so
 * live simulation ticks never trigger a relayout).
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import { MCU_HEADER, MCU_PIN_PITCH, type Side } from './geometry';
import type { SchematicGraph } from './graph';

export interface Pt {
  x: number;
  y: number;
}

export interface LaidOutNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Port id → position relative to the node. */
  ports: Record<string, Pt & { side: Side }>;
}

export interface SchematicLayout {
  key: string;
  nodes: Record<string, LaidOutNode>;
  /** Edge id → polyline (absolute). */
  edges: Record<string, Pt[]>;
  width: number;
  height: number;
}

let elk: InstanceType<typeof ELK> | null = null;
const getElk = () => (elk ??= new ELK());

const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '20',
  'elk.spacing.edgeEdge': '12',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.separateConnectedComponents': 'true',
  'elk.spacing.componentComponent': '56',
  'elk.layered.mergeEdges': 'false',
};

export const JUNCTION_SIZE = 8;

/** Fixed pin position of the i-th MCU port (below the header, regular pitch). */
export const mcuPortY = (i: number) => MCU_HEADER + 14 + i * MCU_PIN_PITCH;

/**
 * ELK graph. MCU ports use FIXED_SIDE (ELK picks the order that minimises
 * crossings); when `mcuOrder` is given (2nd pass) they are pinned at a
 * regular pitch in that order (FIXED_POS) like every other symbol.
 */
export function toElkGraph(graph: SchematicGraph, mcuOrder?: Record<string, string[]>): ElkNode {
  const children: ElkNode[] = graph.nodes.map((n) => {
    const order = mcuOrder?.[n.id];
    const isMcu = n.symbol === 'mcu' && !order;
    const ports: ElkPort[] = n.ports.map((p, i) => {
      const fixed = order ? { x: n.w, y: mcuPortY(Math.max(0, order.indexOf(p.id))) } : isMcu ? {} : { x: p.x, y: p.y };
      return { id: p.id, width: 0, height: 0, ...fixed, layoutOptions: { 'elk.port.side': p.side, 'elk.port.index': String(i) } };
    });
    const layoutOptions: LayoutOptions = isMcu
        ? {
            'elk.portConstraints': 'FIXED_SIDE',
            'elk.portAlignment.default': 'DISTRIBUTED',
            'elk.spacing.portPort': '22',
            'elk.spacing.portsSurrounding': `[top=${MCU_HEADER},left=0,bottom=12,right=0]`,
          }
        : { 'elk.portConstraints': 'FIXED_POS' };
    return { id: n.id, width: n.w, height: n.h, ports, layoutOptions };
  });
  for (const j of graph.junctions) children.push({ id: j.id, width: JUNCTION_SIZE, height: JUNCTION_SIZE });
  const edges: ElkExtendedEdge[] = graph.edges.map((e) => ({
    id: e.id,
    sources: [e.source.port ?? e.source.node],
    targets: [e.target.port ?? e.target.node],
  }));
  return { id: 'root', layoutOptions: ROOT_OPTIONS, children, edges };
}

function fromElk(key: string, graph: SchematicGraph, out: ElkNode): SchematicLayout {
  const nodes: Record<string, LaidOutNode> = {};
  const sideOf = new Map(graph.nodes.flatMap((n) => n.ports.map((p) => [p.id, p.side] as const)));
  for (const c of out.children ?? []) {
    const ports: LaidOutNode['ports'] = {};
    for (const p of c.ports ?? []) ports[p.id] = { x: p.x ?? 0, y: p.y ?? 0, side: sideOf.get(p.id) ?? 'EAST' };
    nodes[c.id] = { id: c.id, x: c.x ?? 0, y: c.y ?? 0, w: c.width ?? 0, h: c.height ?? 0, ports };
  }
  const edges: Record<string, Pt[]> = {};
  for (const e of (out.edges ?? []) as ElkExtendedEdge[]) {
    const pts: Pt[] = [];
    for (const s of e.sections ?? []) {
      if (pts.length === 0) pts.push(s.startPoint);
      for (const b of s.bendPoints ?? []) pts.push(b);
      pts.push(s.endPoint);
    }
    edges[e.id] = pts;
  }
  return { key, nodes, edges, width: out.width ?? 0, height: out.height ?? 0 };
}

const cache = new Map<string, SchematicLayout>();
const inflight = new Map<string, Promise<SchematicLayout>>();
const CACHE_MAX = 40;

export function cachedLayout(key: string): SchematicLayout | undefined {
  return cache.get(key);
}

/** Layout for `graph` (cached by graph.topologyKey). */
export function layoutSchematic(graph: SchematicGraph): Promise<SchematicLayout> {
  const key = graph.topologyKey;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const mcus = graph.nodes.filter((n) => n.symbol === 'mcu' && n.ports.length > 0);
  const p = getElk()
    .layout(toElkGraph(graph))
    .then(async (first) => {
      if (mcus.length === 0) return first;
      // 2nd pass: keep ELK's crossing-minimised pin order, at a clean pitch below the header.
      const order: Record<string, string[]> = {};
      for (const m of mcus) {
        const laid = first.children?.find((c) => c.id === m.id);
        const ys = new Map((laid?.ports ?? []).map((pp) => [pp.id, pp.y ?? 0]));
        order[m.id] = m.ports.map((pp) => pp.id).sort((a, b) => (ys.get(a) ?? 0) - (ys.get(b) ?? 0));
      }
      return getElk().layout(toElkGraph(graph, order));
    })
    .then((out) => {
      const layout = fromElk(key, graph, out);
      cache.set(key, layout);
      if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
      return layout;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
