/**
 * Schematic view: the circuit as a clean, auto-laid-out (ELK) schematic with
 * live overlays — LEDs glow, nets are coloured by voltage and wires carrying
 * current animate. Pan (drag) / zoom (wheel), click a symbol to select it.
 */
import { type PointerEvent as RPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { LoaderCircle, Maximize2, Minus, Plus, Workflow } from 'lucide-react';
import { projectBoard } from '@/catalog';
import { netlistFor } from '@/placement';
import { formatCurrent, formatVolts } from '@/lib/format';
import { useProject } from '@/store/project';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { getFreshResult } from '@/store/derived';
import { type SchematicGraph, type SNet, buildSchematicGraph } from './graph';
import { type Pt, type SchematicLayout, JUNCTION_SIZE, cachedLayout, layoutSchematic } from './layout';
import { IDLE_LINE, edgeFlow, flowPeriod, netVoltage, nodeLive, voltageColor, voltageScale } from './live';
import { SchematicSymbol } from './symbols';
import './SchematicView.css';

interface View {
  x: number;
  y: number;
  k: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Orthogonal polyline with softly rounded corners. */
export function roundedPath(pts: Pt[], r = 6): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1];
    const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    if (d1 < 0.01 || d2 < 0.01) continue;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = { x: p1.x - ((p1.x - p0.x) / d1) * rr, y: p1.y - ((p1.y - p0.y) / d1) * rr };
    const b = { x: p1.x + ((p2.x - p1.x) / d2) * rr, y: p1.y + ((p2.y - p1.y) / d2) * rr };
    d += ` L ${a.x} ${a.y} Q ${p1.x} ${p1.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

/** Midpoint of the longest segment (for net flags on 2-port nets). */
function longestMid(pts: Pt[]): Pt | null {
  let best: Pt | null = null;
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (l > len) {
      len = l;
      best = { x: (pts[i].x + pts[i - 1].x) / 2, y: (pts[i].y + pts[i - 1].y) / 2 };
    }
  }
  return best;
}

function NetFlag({ x, y, net, color }: { x: number; y: number; net: SNet; color: string }) {
  const text = net.name ?? '';
  const w = text.length * 6.6 + (net.kind === 'ground' ? 26 : 14);
  return (
    <g className={clsx('sch-flag', `sch-flag-${net.kind}`)} transform={`translate(${x} ${y})`}>
      <rect x={0} y={-9} width={w} height={18} rx={9} style={{ stroke: color }} />
      {net.kind === 'ground' && (
        <g className="sch-flag-gnd" transform="translate(9 -4)">
          <line x1={0} y1={0} x2={0} y2={3} />
          <line x1={-5} y1={3} x2={5} y2={3} />
          <line x1={-3.2} y1={5.5} x2={3.2} y2={5.5} />
          <line x1={-1.4} y1={8} x2={1.4} y2={8} />
        </g>
      )}
      <text x={net.kind === 'ground' ? 18 : 7} y={3.6}>
        {text}
      </text>
    </g>
  );
}

export function SchematicView() {
  const project = useProject((s) => s.project);
  const netlist = useMemo(() => netlistFor(project), [project]);
  const graph = useMemo(() => {
    try {
      return buildSchematicGraph(project, netlist);
    } catch (err) {
      console.error('[schematic] no se pudo construir el grafo', err);
      return null;
    }
  }, [project, netlist]);

  // ---- layout (async, cached by topology)
  const [shown, setShown] = useState<{ graph: SchematicGraph; layout: SchematicLayout } | null>(() => {
    const l = graph && cachedLayout(graph.topologyKey);
    return graph && l ? { graph, layout: l } : null;
  });
  const [layoutError, setLayoutError] = useState<string | null>(null);
  useEffect(() => {
    if (!graph) return;
    let alive = true;
    const hit = cachedLayout(graph.topologyKey);
    if (hit) {
      setLayoutError(null);
      setShown({ graph, layout: hit });
      return;
    }
    layoutSchematic(graph)
      .then((layout) => {
        if (!alive) return;
        setLayoutError(null);
        setShown({ graph, layout });
      })
      .catch((err: unknown) => {
        console.error('[schematic] ELK', err);
        if (alive) setLayoutError('No pude ordenar el esquema. Intenta mover o reconectar algún componente.');
      });
    return () => {
      alive = false;
    };
  }, [graph]);
  const loading = !!graph && graph.nodes.length > 0 && (!shown || shown.layout.key !== graph.topologyKey) && !layoutError;

  // ---- live data
  const live = useSim((s) => s.live);
  const simResult = useSim((s) => s.result);
  const runtime = useSim((s) => s.runtime);
  const result = useMemo(() => (live ? getFreshResult(project) : null), [project, simResult, live, runtime]); // eslint-disable-line

  const selection = useUI((s) => s.selection.parts);
  const highlight = useUI((s) => s.highlight);

  const logicVolts = useMemo(() => projectBoard(project)?.profile.logicVoltage, [project]);
  const view = useMemo(() => {
    if (!shown) return null;
    const g = shown.graph;
    const netColors: Record<string, string> = {};
    const netVolts: Record<string, number | undefined> = {};
    for (const n of g.nets) netVolts[n.key] = netVoltage(n, result);
    const vmax = voltageScale(Object.values(netVolts), logicVolts);
    for (const n of g.nets) {
      const v = netVolts[n.key];
      netColors[n.key] = v === undefined ? IDLE_LINE : voltageColor(v, vmax);
    }
    return { vmax, netColors, netVolts, nodes: nodeLive(g, project, result, runtime, result ? netColors : {}) };
  }, [shown, result, logicVolts, project, runtime]);
  const vmax = view?.vmax ?? 5;

  // Highlight → part ids + net keys.
  const hl = useMemo(() => {
    const parts = new Set<string>();
    const nets = new Set<string>();
    if (highlight && shown) {
      for (const t of highlight.targets) {
        if (shown.graph.nodes.some((n) => n.id === t)) parts.add(t);
        for (const n of shown.graph.nets) if (n.wires.includes(t) || n.refs.includes(t)) nets.add(n.key);
      }
    }
    return { parts, nets };
  }, [highlight, shown]);

  // ---- pan / zoom
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<View>({ x: 0, y: 0, k: 1 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = useCallback(() => {
    if (!shown || size.w < 10 || size.h < 10) return;
    const { width, height } = shown.layout;
    const k = clamp(Math.min((size.w - 48) / Math.max(1, width), (size.h - 96) / Math.max(1, height)), 0.25, 1.6);
    setVp({ k, x: (size.w - width * k) / 2, y: (size.h - height * k) / 2 + 12 });
  }, [shown, size]);
  const fittedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || size.w < 10) return;
    if (fittedKey.current === shown.layout.key) return;
    fittedKey.current = shown.layout.key;
    fit();
  }, [shown, size, fit]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      setVp((v) => {
        const k = clamp(v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), 0.2, 4);
        return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (f: number) =>
    setVp((v) => {
      const k = clamp(v.k * f, 0.2, 4);
      const cx = size.w / 2, cy = size.h / 2;
      return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) };
    });

  const drag = useRef<{ sx: number; sy: number; vx: number; vy: number; moved: boolean; part: string | null } | null>(null);
  const [panning, setPanning] = useState(false);
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    const part = (e.target as Element).closest?.('[data-part]')?.getAttribute('data-part') ?? null;
    drag.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y, moved: false, part };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 3) {
      d.moved = true;
      setPanning(true);
    }
    if (d.moved) setVp((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setPanning(false);
    if (!d || d.moved) return;
    if (d.part) useUI.getState().select({ parts: [d.part] });
    else useUI.getState().clearSelection();
  };

  const hasParts = !!graph && graph.nodes.length > 0;
  const g = shown?.graph;
  const L = shown?.layout;

  return (
    <div className="sch-root" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={clsx('sch-svg', panning && 'panning')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label="Esquema eléctrico del circuito"
      >
        <defs>
          <pattern id="sch-grid" width={24} height={24} patternUnits="userSpaceOnUse" patternTransform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`}>
            <circle cx={1} cy={1} r={1} className="sch-grid-dot" />
          </pattern>
          <filter id="sch-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="sch-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>
        <rect className="sch-bg" x={0} y={0} width="100%" height="100%" fill="url(#sch-grid)" />
        {hasParts && g && L && view && (
          <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.k})`} className={clsx('sch-scene', loading && 'stale')}>
            {/* edges */}
            <g className="sch-edges">
              {g.edges.map((e) => {
                const pts = L.edges[e.id];
                if (!pts || pts.length < 2) return null;
                const d = roundedPath(pts);
                const color = view.netColors[e.netKey] ?? IDLE_LINE;
                const flow = edgeFlow(e, result);
                const lit = hl.nets.has(e.netKey);
                const net = g.nets.find((n) => n.key === e.netKey);
                const v = view.netVolts[e.netKey];
                return (
                  <g key={e.id} className={clsx('sch-edge', lit && 'lit')}>
                    <title>
                      {[net?.name ? `Red ${net.name}` : 'Conexión', v !== undefined ? formatVolts(v) : null, flow.amps > 1e-5 ? formatCurrent(flow.amps) : null].filter(Boolean).join(' · ')}
                    </title>
                    {lit && <path d={d} className="sch-edge-halo" />}
                    <path d={d} className="sch-edge-line" style={{ stroke: color }} />
                    {flow.amps > 1e-4 && (
                      <path
                        d={d}
                        className="sch-flow"
                        style={{ animationDuration: `${flowPeriod(flow.amps)}s`, animationDirection: flow.forward ? 'normal' : 'reverse' }}
                      />
                    )}
                    <path d={d} className="sch-edge-hit" />
                  </g>
                );
              })}
            </g>

            {/* junctions + net flags */}
            <g className="sch-junctions">
              {g.junctions.map((j) => {
                const n = L.nodes[j.id];
                const net = g.nets.find((x) => x.key === j.netKey);
                if (!n || !net) return null;
                const cx = n.x + JUNCTION_SIZE / 2, cy = n.y + JUNCTION_SIZE / 2;
                const color = view.netColors[j.netKey] ?? IDLE_LINE;
                return (
                  <g key={j.id}>
                    <circle cx={cx} cy={cy} r={4.6} className="sch-junction" style={{ fill: color }} />
                    {net.name && <NetFlag x={cx + 9} y={cy - 15} net={net} color={color} />}
                  </g>
                );
              })}
              {g.nets
                .filter((n) => !n.junction && n.name && !n.ports.some((p) => g.nodes.find((x) => x.id === p.node)?.symbol === 'mcu'))
                .map((n) => {
                  const e = g.edges.find((x) => x.netKey === n.key);
                  const m = e && L.edges[e.id] ? longestMid(L.edges[e.id]) : null;
                  return m ? <NetFlag key={`f-${n.key}`} x={m.x - 14} y={m.y - 16} net={n} color={view.netColors[n.key] ?? IDLE_LINE} /> : null;
                })}
            </g>

            {/* symbols */}
            <g className="sch-nodes">
              {g.nodes.map((node) => {
                const n = L.nodes[node.id];
                if (!n) return null;
                const st = view.nodes[node.id] ?? {};
                const selected = selection.includes(node.id);
                return (
                  <g
                    key={node.id}
                    data-part={node.id}
                    transform={`translate(${n.x} ${n.y})`}
                    className={clsx('sch-node', selected && 'selected', hl.parts.has(node.id) && 'highlighted', st.burned && 'burned', st.overloaded && 'overloaded', node.ports.length === 0 && 'isolated')}
                  >
                    <title>{node.value ? `${node.label} · ${node.value}` : node.label}</title>
                    <rect className="sch-node-hit" x={-8} y={-6} width={node.w + 16} height={node.h + 12} rx={10} />
                    <SchematicSymbol node={node} layout={n} live={st} />
                  </g>
                );
              })}
            </g>
          </g>
        )}
      </svg>

      {/* overlays */}
      <div className="sch-topbar">
        <div className="sch-chip">
          <Workflow size={14} />
          <span>Esquema eléctrico</span>
          {result && hasParts && (
            <span className="sch-live">
              <i /> en vivo
            </span>
          )}
        </div>
      </div>

      {hasParts && (
        <div className="sch-tools" role="toolbar" aria-label="Zoom del esquema">
          <button className="sch-tool" onClick={() => zoomBy(1 / 1.25)} aria-label="Alejar" title="Alejar">
            <Minus size={15} />
          </button>
          <span className="sch-zoom mono">{Math.round(vp.k * 100)}%</span>
          <button className="sch-tool" onClick={() => zoomBy(1.25)} aria-label="Acercar" title="Acercar">
            <Plus size={15} />
          </button>
          <span className="sch-tools-sep" />
          <button className="sch-tool" onClick={fit} aria-label="Ajustar a la vista" title="Ajustar a la vista">
            <Maximize2 size={14} />
          </button>
        </div>
      )}

      {hasParts && result && (
        <div className="sch-legend" aria-hidden>
          <span className="mono">0 V</span>
          <span className="sch-legend-bar" style={{ background: `linear-gradient(90deg, ${voltageColor(0, 1)}, ${voltageColor(0.45, 1)}, ${voltageColor(1, 1)})` }} />
          <span className="mono">{formatVolts(vmax)}</span>
          <span className="sch-legend-sep" />
          <span className="sch-legend-flow" />
          <span>corriente</span>
        </div>
      )}

      {loading && (
        <div className={clsx('sch-loading', shown && 'corner')}>
          <LoaderCircle size={shown ? 14 : 22} className="sch-spin-icon" />
          <span>Ordenando el esquema…</span>
        </div>
      )}

      {layoutError && hasParts && <div className="sch-error">{layoutError}</div>}

      {!hasParts && (
        <div className="sch-empty">
          <div className="sch-empty-art" aria-hidden>
            <svg width="120" height="56" viewBox="0 0 120 56">
              <g className="sch-line">
                <line x1="4" y1="28" x2="30" y2="28" />
                <polyline points={'30,28 33,22 39,34 45,22 51,34 57,22 60,28'} />
                <line x1="60" y1="28" x2="76" y2="28" />
                <polygon points="76,19 76,37 92,28" className="sch-fill" />
                <line x1="92" y1="19" x2="92" y2="37" />
                <line x1="92" y1="28" x2="116" y2="28" />
              </g>
            </svg>
          </div>
          <p className="sch-empty-title">Tu esquema aparecerá aquí</p>
          <p className="sch-empty-text">Agrega una placa y componentes en la protoboard (o carga un ejemplo): el diagrama se dibuja y ordena solo.</p>
        </div>
      )}
    </div>
  );
}
