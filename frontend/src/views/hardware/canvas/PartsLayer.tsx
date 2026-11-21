import { Component, memo, useMemo, useRef, type ReactNode } from 'react';
import type { Id, PartDef, PartInstance, PartSimState, PropValue } from '@/contracts';
import { defaultProps, findPartDef } from '@/catalog';
import { getRenderer } from '@/parts/registry';
import { useSim } from '@/store/sim';
import { useUI } from '@/store/ui';

/** Keeps one broken renderer from taking the whole canvas down. */
class RenderGuard extends Component<{ def: PartDef; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error(`Renderer de "${this.props.def.type}" falló`, err);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    const b = this.props.def.bounds;
    return (
      <g>
        <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={0.4} className="hw-part-fallback" />
        <text x={b.x + b.w / 2} y={b.y + b.h / 2} className="hw-part-fallback-text" textAnchor="middle" dominantBaseline="middle">
          {this.props.def.name}
        </text>
      </g>
    );
  }
}

const EMPTY: Record<string, PropValue> = {};

/** Structural equality for small plain values (PartSimState: numbers, flags, rgb arrays, onboard object). */
function sameValue(a: unknown, b: unknown, depth = 3): boolean {
  if (Object.is(a, b)) return true;
  if (depth <= 0 || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], depth - 1)) return false;
  }
  return true;
}

/**
 * This part's sim state, stable across solves that did not change it. Every
 * solve builds new objects (board `onboard`, RGB arrays…), so a shallow compare
 * re-rendered the board on every tick of a running program.
 */
function usePartSim(id: Id): PartSimState | undefined {
  const prev = useRef<PartSimState | undefined>(undefined);
  return useSim((s) => {
    const next = s.result?.parts[id];
    if (sameValue(prev.current, next)) return prev.current;
    prev.current = next;
    return next;
  });
}

/** One part on the canvas. Subscribes only to its own sim slice. */
export const PartNode = memo(function PartNode({ part }: { part: PartInstance }) {
  const def = findPartDef(part.type);
  const sim = usePartSim(part.id);
  const rt = useSim((s) => s.runtime[part.id]) ?? EMPTY;
  const selected = useUI((s) => s.selection.parts.includes(part.id));
  const runtime = useMemo(() => (def ? { ...defaultProps(def), ...part.props, ...rt } : { ...part.props, ...rt }), [def, part.props, rt]);
  if (!def) return null;
  const R = getRenderer(part.type);
  const b = def.bounds;
  return (
    <g
      className={`hw-part${def.interactive ? ' is-interactive' : ''}`}
      data-part-id={part.id}
      transform={`translate(${part.x} ${part.y})${part.rotation ? ` rotate(${part.rotation})` : ''}`}
    >
      <rect className="hw-part-hit" x={b.x} y={b.y} width={b.w} height={b.h} rx={0.3} />
      <RenderGuard def={def}>
        <R part={part} def={def} sim={sim} runtime={runtime} selected={selected} />
      </RenderGuard>
    </g>
  );
});

export const PartsLayer = memo(function PartsLayer({ parts }: { parts: PartInstance[] }) {
  return (
    <g className="hw-parts">
      {parts.map((p) => (
        <PartNode key={p.id} part={p} />
      ))}
    </g>
  );
});

/** Static (no hooks into sim) rendering used by the drop ghost. */
export function GhostPart({ def, x, y }: { def: PartDef; x: number; y: number }) {
  const R = getRenderer(def.type);
  const part: PartInstance = useMemo(
    () => ({ id: `ghost-${def.type}`, type: def.type, label: def.name, x, y, rotation: 0, props: defaultProps(def) }),
    [def, x, y],
  );
  return (
    <g transform={`translate(${x} ${y})`}>
      <RenderGuard def={def}>
        <R part={part} def={def} runtime={part.props} />
      </RenderGuard>
    </g>
  );
}
