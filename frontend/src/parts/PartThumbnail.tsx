import type { PartDef, PartInstance, PropValue } from '@/contracts';
import { defaultProps } from '@/catalog';
import { getRenderer } from './registry';
import { SharedDefs } from './defs';

/** Small standalone SVG of a part (palette, inspector, agent cards). */
export function PartThumbnail({ def, size = 64, props }: { def: PartDef; size?: number; props?: Record<string, PropValue> }) {
  const R = getRenderer(def.type);
  const b = def.bounds;
  const pad = Math.max(b.w, b.h) * 0.08 + 0.4;
  const part: PartInstance = { id: `thumb-${def.type}`, type: def.type, label: def.name, x: 0, y: 0, rotation: 0, props: { ...defaultProps(def), ...props } };
  return (
    <svg width={size} height={size} viewBox={`${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`} preserveAspectRatio="xMidYMid meet" aria-label={def.name}>
      <SharedDefs />
      <R part={part} def={def} runtime={part.props} thumbnail />
    </svg>
  );
}

export { SharedDefs };
