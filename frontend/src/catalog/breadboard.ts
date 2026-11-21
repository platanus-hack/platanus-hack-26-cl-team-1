/**
 * Half-size breadboard (400 tie points) geometry. Grid units, relative to the
 * breadboard origin (top-left of the body). Renderers MUST draw holes at these
 * exact coordinates.
 *
 *   y=1   T+  ● ● ● ● ●   ● ● ● ● ●  … (red line above)   top + rail
 *   y=2   T-  ● ● ● ● ●   ● ● ● ● ●  … (blue line below)  top − rail
 *   y=5..9    rows a..e   (each column's a–e joined)
 *   y=10.5    center channel
 *   y=12..16  rows f..j   (each column's f–j joined)
 *   y=19  B+  red rail · y=20 B- blue rail
 *   Columns 1..30 at x = col + 1. Rail holes skip every 6th column (groups of 5).
 */
import type { PinDef } from '@/contracts';

export const BB_COLS = 30;
export const BB_WIDTH = 33;
export const BB_HEIGHT = 21;
export const BB_ROWS_TOP = ['a', 'b', 'c', 'd', 'e'] as const;
export const BB_ROWS_BOTTOM = ['f', 'g', 'h', 'i', 'j'] as const;
export const BB_ROW_Y: Record<string, number> = { a: 5, b: 6, c: 7, d: 8, e: 9, f: 12, g: 13, h: 14, i: 15, j: 16 };
export const BB_RAILS = [
  { id: 'T+', y: 1, polarity: '+' as const, label: 'Riel + superior' },
  { id: 'T-', y: 2, polarity: '-' as const, label: 'Riel − superior' },
  { id: 'B+', y: 19, polarity: '+' as const, label: 'Riel + inferior' },
  { id: 'B-', y: 20, polarity: '-' as const, label: 'Riel − inferior' },
];
export const BB_CHANNEL_Y = 10.5;
export const bbColX = (col: number) => col + 1;
export const bbRailHasCol = (col: number) => col % 6 !== 0;

/** Hole ids: 'a10' (row+col) or 'T+3' (rail+col). */
export function breadboardPins(): PinDef[] {
  const pins: PinDef[] = [];
  for (const rail of BB_RAILS) {
    for (let c = 1; c <= BB_COLS; c++) {
      if (!bbRailHasCol(c)) continue;
      pins.push({ id: `${rail.id}${c}`, label: `${rail.label} (col. ${c})`, x: bbColX(c), y: rail.y, kind: 'hole', polarity: rail.polarity });
    }
  }
  for (const row of [...BB_ROWS_TOP, ...BB_ROWS_BOTTOM]) {
    for (let c = 1; c <= BB_COLS; c++) {
      pins.push({ id: `${row}${c}`, label: `Fila ${row} · columna ${c}`, x: bbColX(c), y: BB_ROW_Y[row], kind: 'hole' });
    }
  }
  return pins;
}

/** Internal strips: every column's a–e and f–j, plus each full rail. */
export function breadboardBuses(): string[][] {
  const buses: string[][] = [];
  for (let c = 1; c <= BB_COLS; c++) {
    buses.push(BB_ROWS_TOP.map((r) => `${r}${c}`));
    buses.push(BB_ROWS_BOTTOM.map((r) => `${r}${c}`));
  }
  for (const rail of BB_RAILS) {
    const holes: string[] = [];
    for (let c = 1; c <= BB_COLS; c++) if (bbRailHasCol(c)) holes.push(`${rail.id}${c}`);
    buses.push(holes);
  }
  return buses;
}

/** Parse a hole id. */
export function parseHole(id: string): { kind: 'main'; row: string; col: number } | { kind: 'rail'; rail: string; col: number } | null {
  let m = /^([a-j])(\d{1,2})$/.exec(id);
  if (m) return { kind: 'main', row: m[1], col: Number(m[2]) };
  m = /^([TB][+-])(\d{1,2})$/.exec(id);
  if (m) return { kind: 'rail', rail: m[1], col: Number(m[2]) };
  return null;
}

/** Spanish human description of a hole, for the wiring guide. */
export function describeHole(id: string): string {
  const h = parseHole(id);
  if (!h) return id;
  if (h.kind === 'main') return `${h.row}${h.col}`;
  const rail = BB_RAILS.find((r) => r.id === h.rail)!;
  return `${rail.label.toLowerCase()} (columna ${h.col})`;
}
