import { memo, useMemo } from 'react';
import type { Point, ProjectModel, Wire, WireColor } from '@/contracts';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';
import { useHW } from '../state';
import { getPinIndex } from '../logic/pinIndex';
import { buildWirePath, endDirection, flowParams, FLOW_DASH, FLOW_PERIOD } from '../logic/wirePath';

/** Small metallic jumper tip with a coloured plastic housing, oriented along the wire. */
function WireTip({ at, dir }: { at: Point; dir: Point }) {
  const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI;
  return (
    <g transform={`translate(${at.x} ${at.y}) rotate(${angle})`} className="hw-wire-tip">
      <rect x={0.12} y={-0.2} width={0.62} height={0.4} rx={0.1} className="hw-wire-tip-housing" />
      <rect x={0.12} y={-0.2} width={0.62} height={0.4} rx={0.1} className="hw-wire-tip-shade" />
      <circle r={0.15} className="hw-wire-tip-metal" />
    </g>
  );
}

interface WireNodeProps {
  wire: Wire;
  points: Point[];
}

export const WireNode = memo(function WireNode({ wire, points }: WireNodeProps) {
  const current = useSim((s) => s.result?.wireCurrents[wire.id] ?? 0);
  const showFlow = useHW((s) => s.showFlow);
  const hovered = useHW((s) => s.hoverWire === wire.id);
  const selected = useUI((s) => s.selection.wires.includes(wire.id));
  const d = useMemo(() => buildWirePath(points), [points]);
  const flow = flowParams(current);
  const a = points[0];
  const b = points[points.length - 1];
  return (
    <g className={`hw-wire hw-wire--${wire.color}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}`} data-wire-id={wire.id}>
      {(selected || hovered) && <path d={d} className="hw-wire-glow" />}
      <path d={d} className="hw-wire-shadow" transform="translate(0.08 0.14)" />
      <path d={d} className="hw-wire-outline" />
      <path d={d} className="hw-wire-outline-shade" />
      <path d={d} className="hw-wire-core" />
      <path d={d} className="hw-wire-highlight" transform="translate(-0.025 -0.045)" />
      {showFlow && flow.active && (
        <path
          d={d}
          className="hw-wire-flow"
          strokeDasharray={`${FLOW_DASH} ${FLOW_PERIOD - FLOW_DASH}`}
          style={{
            animationDuration: `${flow.durationS.toFixed(3)}s`,
            animationDirection: flow.reverse ? 'reverse' : 'normal',
            opacity: 0.55 + flow.intensity * 0.45,
          }}
        />
      )}
      <WireTip at={a} dir={endDirection(points, true)} />
      <WireTip at={b} dir={endDirection(points, false)} />
      <path d={d} className="hw-wire-hit" />
    </g>
  );
});

/** World points of a wire (endpoints + waypoints), or null if an end is missing. */
export function wireWorldPoints(project: ProjectModel, wire: Wire): Point[] | null {
  const idx = getPinIndex(project);
  const a = idx.byRef.get(wire.from);
  const b = idx.byRef.get(wire.to);
  if (!a || !b) return null;
  return [{ x: a.x, y: a.y }, ...(wire.waypoints ?? []), { x: b.x, y: b.y }];
}

const pointsCache = new WeakMap<Wire, { key: string; pts: Point[] }>();

/** Stable points array per wire while its geometry is unchanged (keeps WireNode memoized). */
function stablePoints(project: ProjectModel, wire: Wire): Point[] | null {
  const pts = wireWorldPoints(project, wire);
  if (!pts) return null;
  const key = pts.map((p) => `${p.x},${p.y}`).join(';');
  const hit = pointsCache.get(wire);
  if (hit && hit.key === key) return hit.pts;
  pointsCache.set(wire, { key, pts });
  return pts;
}

export const WiresLayer = memo(function WiresLayer({ project }: { project: ProjectModel }) {
  return (
    <g className="hw-wires">
      {project.wires.map((w) => {
        const pts = stablePoints(project, w);
        return pts ? <WireNode key={w.id} wire={w} points={pts} /> : null;
      })}
    </g>
  );
});

export const wireColorVar = (c: WireColor) => `var(--wire-${c})`;
