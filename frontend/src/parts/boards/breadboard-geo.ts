/**
 * Breadboard hole geometry → path strings, built ONCE per pin array
 * (module-level WeakMap cache keyed by the resolved def.pins array).
 */
import type { PinDef } from '@/contracts';
import { BB_COLS, BB_RAILS, BB_ROW_Y, bbColX } from '@/catalog';
import { rectsPath, squaresPath, type Pt, type Rect } from './layout';

export const BB_HOLE = 0.34;
export const BB_FUNNEL = 0.58;

export interface BreadboardPaths {
  /** Dark hole openings. */
  holes: string;
  /** Slightly darker funnel around each hole (moulded bevel). */
  funnels: string;
  /** Thin highlight on the lower lip of each funnel (light from the top). */
  lips: string;
  count: number;
}

const cache = new WeakMap<readonly PinDef[], BreadboardPaths>();

export function breadboardPaths(pins: readonly PinDef[]): BreadboardPaths {
  const hit = cache.get(pins);
  if (hit) return hit;
  const pts: Pt[] = pins.filter((p) => p.kind === 'hole').map((p) => ({ x: p.x, y: p.y }));
  const f = BB_FUNNEL / 2;
  const lips: Rect[] = pts.map((p) => ({ x: p.x - f + 0.04, y: p.y + f - 0.07, w: BB_FUNNEL - 0.08, h: 0.07 }));
  const out: BreadboardPaths = {
    holes: squaresPath(pts, BB_HOLE, 0.06),
    funnels: squaresPath(pts, BB_FUNNEL, 0.1),
    lips: rectsPath(lips),
    count: pts.length,
  };
  cache.set(pins, out);
  return out;
}

export interface BreadboardLabel {
  x: number;
  y: number;
  text: string;
}

/** Column numbers (1 and every 5) above row a and below row j. */
export function columnLabels(): BreadboardLabel[] {
  const cols = [1];
  for (let c = 5; c <= BB_COLS; c += 5) cols.push(c);
  const top = BB_ROW_Y.a - 1.05;
  const bottom = BB_ROW_Y.j + 1.05;
  return cols.flatMap((c) => [
    { x: bbColX(c), y: top, text: String(c) },
    { x: bbColX(c), y: bottom, text: String(c) },
  ]);
}

/** Row letters a–j on both sides of the main area. */
export function rowLabels(): BreadboardLabel[] {
  const left = bbColX(1) - 1.15;
  const right = bbColX(BB_COLS) + 1.15;
  return Object.entries(BB_ROW_Y).flatMap(([row, y]) => [
    { x: left, y, text: row },
    { x: right, y, text: row },
  ]);
}

export interface RailMark {
  y: number;
  polarity: '+' | '-';
  /** y of the coloured guide line next to the rail (outside the hole pair). */
  lineY: number;
}

/** Rail rows with the position of their red/blue guide lines. */
export function railMarks(): RailMark[] {
  return BB_RAILS.map((r) => {
    // + rail of a pair is the outer one on top (line above) and on the bottom pair the line sits above + too;
    // the line goes on the side of the rail that faces away from its partner.
    const partner = BB_RAILS.find((o) => o.id !== r.id && Math.abs(o.y - r.y) === 1);
    const away = partner ? Math.sign(r.y - partner.y) : r.polarity === '+' ? -1 : 1;
    return { y: r.y, polarity: r.polarity, lineY: r.y + away * 0.6 };
  });
}
