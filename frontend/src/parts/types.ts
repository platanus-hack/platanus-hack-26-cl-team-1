import type { ComponentType } from 'react';
import type { PartDef, PartInstance, PartSimState, PropValue } from '@/contracts';

/**
 * Props every part renderer receives.
 *
 * COORDINATES: draw in the part's LOCAL, UNROTATED frame, in GRID UNITS
 * (1 unit = 0.1 in). The canvas wraps you in
 *   <g transform="translate(x y) rotate(rotation)">.
 * Each leg / header pin must END exactly at its PinDef (x, y).
 * Do NOT draw pin hit-targets: the canvas overlays them.
 * Keep stroke widths in grid units (e.g. 0.08). Use <defs> ids prefixed with
 * the part id (`${part.id}-grad`) to avoid collisions — or use the shared
 * defs in parts/defs.tsx.
 */
export interface PartRenderProps {
  part: PartInstance;
  def: PartDef;
  /** Live electrical state (undefined when there is no solve yet). */
  sim?: PartSimState;
  /** Effective runtime props (pressed, position, light…), already merged with part.props. */
  runtime: Record<string, PropValue>;
  selected?: boolean;
  /** True when drawn small in the palette / inspector (skip fine details if you want). */
  thumbnail?: boolean;
}

export type PartRenderer = ComponentType<PartRenderProps>;
