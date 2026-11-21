/**
 * World-space SVG overlays drawn above parts and wires: selection / hover /
 * agent-highlight outlines, pin markers and connected-strip highlight, drop
 * ghost, wire rubber band, marquee and waypoint handles.
 */
import { memo, useMemo } from 'react';
import type { Netlist, PartDef, PinRef, Point, ProjectModel } from '@/contracts';
import { findPartDef } from '@/catalog';
import { parsePinRef, pinRef } from '@/lib/pinref';
import { useProject } from '@/store/project';
import { useUI } from '@/store/ui';
import { getNetlist } from '@/store/derived';
import { useHW } from '../state';
import { getPinIndex } from '../logic/pinIndex';
import { isBreadboard } from '../logic/partInfo';
import { autoWireColor, classifyEndpoint } from '../logic/wireColor';
import { buildWirePath } from '../logic/wirePath';
import { GhostPart } from './PartsLayer';
import { wireWorldPoints } from './WiresLayer';

export function safeNetlist(project: ProjectModel): Netlist | null {
  try {
    return getNetlist(project);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Selection, hover and agent highlight outlines                       */
/* ------------------------------------------------------------------ */

function PartOutline({ project, id, className, pad, scale }: { project: ProjectModel; id: string; className: string; pad: number; scale: number }) {
  const part = project.parts.find((p) => p.id === id);
  const def = part && findPartDef(part.type);
  if (!part || !def) return null;
  const b = def.bounds;
  const sw = 1.5 / scale;
  return (
    <g transform={`translate(${part.x} ${part.y})${part.rotation ? ` rotate(${part.rotation})` : ''}`}>
      <rect
        className={className}
        x={b.x - pad}
        y={b.y - pad}
        width={b.w + pad * 2}
        height={b.h + pad * 2}
        rx={Math.min(0.8, pad + 0.35)}
        strokeWidth={sw}
        strokeDasharray={className.includes('selected') ? `${6 / scale} ${4 / scale}` : undefined}
      />
    </g>
  );
}

export const SelectionOverlay = memo(function SelectionOverlay({ project }: { project: ProjectModel }) {
  const scale = useHW((s) => s.vp.scale);
  const hoverPart = useHW((s) => s.hoverPart);
  const dragging = useHW((s) => s.dragging);
  const selected = useUI((s) => s.selection.parts);
  const highlight = useUI((s) => s.highlight);
  const hlParts = highlight ? highlight.targets.filter((t) => project.parts.some((p) => p.id === t)) : [];
  const hlWires = highlight ? highlight.targets.filter((t) => project.wires.some((w) => w.id === t)) : [];
  const hlPins = highlight ? highlight.targets.filter((t) => t.includes('.')) : [];
  const idx = getPinIndex(project);
  return (
    <g className="hw-overlay">
      {hoverPart && !selected.includes(hoverPart) && !dragging && (
        <PartOutline project={project} id={hoverPart} className="hw-outline-hover" pad={0.3} scale={scale} />
      )}
      {selected.map((id) => (
        <PartOutline key={id} project={project} id={id} className="hw-outline-selected" pad={0.45} scale={scale} />
      ))}
      {hlParts.map((id) => (
        <PartOutline key={`hl-${id}`} project={project} id={id} className="hw-outline-highlight" pad={0.7} scale={scale} />
      ))}
      {hlWires.map((id) => {
        const w = project.wires.find((x) => x.id === id);
        const pts = w && wireWorldPoints(project, w);
        return pts ? <path key={`hlw-${id}`} d={buildWirePath(pts)} className="hw-highlight-wire" /> : null;
      })}
      {hlPins.map((ref) => {
        const e = idx.byRef.get(ref);
        return e ? <circle key={`hlp-${ref}`} cx={e.x} cy={e.y} r={0.62} className="hw-highlight-pin" strokeWidth={2 / scale} /> : null;
      })}
    </g>
  );
});

/* ------------------------------------------------------------------ */
/* Pins: markers, hovered pin, connected strip / net                   */
/* ------------------------------------------------------------------ */

const busIndexCache = new WeakMap<PartDef, Map<string, number>>();
function busIndexOf(def: PartDef): Map<string, number> {
  let m = busIndexCache.get(def);
  if (!m) {
    m = new Map();
    (def.internalBuses ?? []).forEach((bus, i) => bus.forEach((pin) => m!.set(pin, i)));
    busIndexCache.set(def, m);
  }
  return m;
}

/** Every pin electrically joined to `ref` (net), falling back to the part's internal bus. */
export function connectedPins(project: ProjectModel, netlist: Netlist | null, ref: PinRef): PinRef[] {
  const netId = netlist?.pinNet[ref];
  if (netlist && netId) {
    const net = netlist.nets.find((n) => n.id === netId);
    if (net && net.pins.length) return net.pins;
  }
  const { part: partId, pin } = parsePinRef(ref);
  const part = project.parts.find((p) => p.id === partId);
  const def = part && findPartDef(part.type);
  const bus = def?.internalBuses?.find((b) => b.includes(pin));
  return bus ? bus.map((p) => pinRef(partId, p)) : [ref];
}

interface Capsule {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PinOverlay = memo(function PinOverlay({ project }: { project: ProjectModel }) {
  const hoverPin = useHW((s) => s.hoverPin);
  const hoverPart = useHW((s) => s.hoverPart);
  const drafting = useHW((s) => s.draft !== null);
  const dragging = useHW((s) => s.dragging);
  const scale = useHW((s) => s.vp.scale);
  const tool = useUI((s) => s.tool);
  const idx = getPinIndex(project);

  const markers = useMemo(() => {
    if (dragging) return [];
    const out: Point[] = [];
    if (tool === 'wire' || drafting) {
      for (const p of project.parts) {
        const def = findPartDef(p.type);
        if (!def || isBreadboard(def)) continue;
        for (const e of idx.byPart.get(p.id) ?? []) out.push(e);
      }
    } else if (hoverPart) {
      const part = project.parts.find((p) => p.id === hoverPart);
      const def = part && findPartDef(part.type);
      if (def && !isBreadboard(def)) for (const e of idx.byPart.get(hoverPart) ?? []) out.push(e);
    }
    return out;
  }, [project, idx, tool, drafting, hoverPart, dragging]);

  const strip = useMemo(() => {
    if (!hoverPin || dragging) return null;
    const netlist = safeNetlist(project);
    const refs = connectedPins(project, netlist, hoverPin);
    const capsules: Capsule[] = [];
    const rings: Point[] = [];
    const groups = new Map<string, Point[]>();
    for (const ref of refs) {
      const e = idx.byRef.get(ref);
      if (!e) continue;
      const part = project.parts.find((p) => p.id === e.partId);
      const def = part && findPartDef(part.type);
      if (def && isBreadboard(def)) {
        const bi = busIndexOf(def).get(e.pinId);
        const key = `${e.partId}#${bi ?? e.pinId}`;
        const g = groups.get(key);
        if (g) g.push(e);
        else groups.set(key, [e]);
      } else rings.push(e);
    }
    const R = 0.42;
    for (const pts of groups.values()) {
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      capsules.push({ x: x0 - R, y: y0 - R, w: x1 - x0 + 2 * R, h: y1 - y0 + 2 * R });
      for (const p of pts) rings.push(p);
    }
    return { capsules, rings };
  }, [hoverPin, project, idx, dragging]);

  const hovered = hoverPin ? idx.byRef.get(hoverPin) : undefined;
  const sw = 1.25 / scale;
  return (
    <g className="hw-overlay">
      {markers.map((m, i) => (
        <circle key={i} cx={m.x} cy={m.y} r={0.24} className="hw-pin-marker" strokeWidth={sw} />
      ))}
      {strip && (
        <g className="hw-strip">
          {strip.capsules.map((c, i) => (
            <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} rx={0.42} className="hw-strip-capsule" strokeWidth={sw} />
          ))}
          {strip.rings.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={0.3} className="hw-strip-ring" strokeWidth={sw} />
          ))}
        </g>
      )}
      {hovered && (
        <g className="hw-pin-hover">
          <circle cx={hovered.x} cy={hovered.y} r={0.62} className="hw-pin-hover-halo" />
          <circle cx={hovered.x} cy={hovered.y} r={0.36} className="hw-pin-hover-ring" strokeWidth={2 / scale} />
        </g>
      )}
    </g>
  );
});

/* ------------------------------------------------------------------ */
/* Drop ghost & insertion holes                                        */
/* ------------------------------------------------------------------ */

function HoleRings({ pts, scale }: { pts: Point[]; scale: number }) {
  return (
    <g className="hw-insert">
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={0.55} className="hw-insert-halo" />
          <circle cx={p.x} cy={p.y} r={0.3} className="hw-insert-ring" strokeWidth={1.75 / scale} />
        </g>
      ))}
    </g>
  );
}

export const GhostOverlay = memo(function GhostOverlay() {
  const ghost = useHW((s) => s.ghost);
  const dragHoles = useHW((s) => s.dragHoles);
  const scale = useHW((s) => s.vp.scale);
  const def = ghost ? findPartDef(ghost.type) : undefined;
  return (
    <g className="hw-overlay">
      {dragHoles.length > 0 && <HoleRings pts={dragHoles} scale={scale} />}
      {ghost && def && (
        <g className={`hw-ghost${ghost.invalid ? ' is-invalid' : ''}`}>
          <g className="hw-ghost-part">
            <GhostPart def={def} x={ghost.x} y={ghost.y} />
          </g>
          <rect
            x={ghost.x + def.bounds.x - 0.35}
            y={ghost.y + def.bounds.y - 0.35}
            width={def.bounds.w + 0.7}
            height={def.bounds.h + 0.7}
            rx={0.6}
            className="hw-ghost-outline"
            strokeWidth={1.5 / scale}
            strokeDasharray={`${5 / scale} ${4 / scale}`}
          />
          <HoleRings pts={ghost.holes} scale={scale} />
        </g>
      )}
    </g>
  );
});

/* ------------------------------------------------------------------ */
/* Wire rubber band                                                     */
/* ------------------------------------------------------------------ */

export const DraftOverlay = memo(function DraftOverlay({ project }: { project: ProjectModel }) {
  const draft = useHW((s) => s.draft);
  const hoverPin = useHW((s) => s.hoverPin);
  const scale = useHW((s) => s.vp.scale);
  const color = useMemo(() => {
    if (!draft) return 'yellow' as const;
    const netlist = safeNetlist(project);
    const a = classifyEndpoint(project, netlist, draft.from);
    const b = hoverPin && hoverPin !== draft.from ? classifyEndpoint(project, netlist, hoverPin) : 'signal';
    return autoWireColor(a, b, project.wires);
  }, [draft, hoverPin, project]);
  if (!draft) return null;
  const pts = [draft.fromPt, ...draft.waypoints, draft.cursor];
  const d = buildWirePath(pts);
  return (
    <g className={`hw-overlay hw-wire hw-wire--${color} is-draft`}>
      <path d={d} className="hw-wire-shadow" transform="translate(0.08 0.14)" />
      <path d={d} className="hw-wire-outline" />
      <path d={d} className="hw-wire-outline-shade" />
      <path d={d} className="hw-wire-core" />
      <path d={d} className="hw-wire-highlight" transform="translate(-0.025 -0.045)" />
      <circle cx={draft.fromPt.x} cy={draft.fromPt.y} r={0.3} className="hw-draft-anchor" strokeWidth={1.5 / scale} />
      {draft.waypoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={0.2} className="hw-draft-waypoint" strokeWidth={1.25 / scale} />
      ))}
      <circle cx={draft.cursor.x} cy={draft.cursor.y} r={0.18} className="hw-draft-cursor" />
    </g>
  );
});

/* ------------------------------------------------------------------ */
/* Marquee & waypoint handles                                           */
/* ------------------------------------------------------------------ */

export const MarqueeOverlay = memo(function MarqueeOverlay() {
  const m = useHW((s) => s.marquee);
  const scale = useHW((s) => s.vp.scale);
  if (!m) return null;
  return <rect className="hw-marquee" x={m.x} y={m.y} width={m.w} height={m.h} rx={0.15} strokeWidth={1 / scale} />;
});

export const WaypointHandles = memo(function WaypointHandles() {
  const project = useProject((s) => s.project);
  const sel = useUI((s) => s.selection);
  const scale = useHW((s) => s.vp.scale);
  if (sel.parts.length || sel.wires.length !== 1) return null;
  const wire = project.wires.find((w) => w.id === sel.wires[0]);
  if (!wire?.waypoints?.length) return null;
  return (
    <g className="hw-waypoints">
      {wire.waypoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={Math.max(0.28, 6 / scale)} className="hw-waypoint" data-waypoint={`${wire.id}:${i}`} strokeWidth={1.5 / scale} />
      ))}
    </g>
  );
});
