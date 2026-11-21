/**
 * Pure geometry helpers for the board / power renderers.
 * Everything is in grid units (1 = 0.1 in) and returns compact SVG path data,
 * so a whole family of shapes (400 breadboard holes, 32 header sockets…)
 * becomes ONE <path> element.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Round to 3 decimals and print without trailing zeros (keeps path strings short). */
export function n(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
}

/* ------------------------------------------------------------------------- */
/* Header runs                                                               */
/* ------------------------------------------------------------------------- */

export interface HeaderRun<P extends Pt = Pt> {
  y: number;
  /** x of the first / last pin of the run. */
  x0: number;
  x1: number;
  pins: P[];
}

/**
 * Group pins into horizontal header strips: same group key + same y, and
 * consecutive x positions (pitch 1). A gap of more than one unit starts a new
 * strip (e.g. the Uno's 10-pin and 8-pin digital headers).
 */
export function headerRuns<P extends Pt>(pins: readonly P[], keyOf: (p: P) => string = () => ''): HeaderRun<P>[] {
  const groups = new Map<string, P[]>();
  for (const p of pins) {
    const k = `${keyOf(p)}|${p.y}`;
    const g = groups.get(k);
    if (g) g.push(p);
    else groups.set(k, [p]);
  }
  const runs: HeaderRun<P>[] = [];
  const close = (cur: P[]) => runs.push({ y: cur[0].y, x0: cur[0].x, x1: cur[cur.length - 1].x, pins: cur });
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.x - b.x);
    let cur: P[] = [];
    for (const p of sorted) {
      if (cur.length > 0 && p.x - cur[cur.length - 1].x > 1.001) {
        close(cur);
        cur = [];
      }
      cur.push(p);
    }
    if (cur.length > 0) close(cur);
  }
  return runs.sort((a, b) => a.y - b.y || a.x0 - b.x0);
}

/* ------------------------------------------------------------------------- */
/* Path builders                                                             */
/* ------------------------------------------------------------------------- */

/** One rectangle as a closed sub-path, optionally with rounded corners. */
export function rectSubpath(x: number, y: number, w: number, h: number, r = 0): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  if (rr === 0) return `M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z`;
  const a = n(rr);
  return (
    `M${n(x + rr)} ${n(y)}h${n(w - 2 * rr)}a${a} ${a} 0 0 1 ${a} ${a}` +
    `v${n(h - 2 * rr)}a${a} ${a} 0 0 1 ${n(-rr)} ${a}` +
    `h${n(-(w - 2 * rr))}a${a} ${a} 0 0 1 ${n(-rr)} ${n(-rr)}` +
    `v${n(-(h - 2 * rr))}a${a} ${a} 0 0 1 ${a} ${n(-rr)}z`
  );
}

/** Many rectangles → one path. */
export function rectsPath(rects: readonly Rect[], r = 0): string {
  let d = '';
  for (const q of rects) d += rectSubpath(q.x, q.y, q.w, q.h, r);
  return d;
}

/** Squares of side `size` CENTRED on each point → one path. */
export function squaresPath(points: readonly Pt[], size: number, r = 0): string {
  let d = '';
  const h = size / 2;
  for (const p of points) d += rectSubpath(p.x - h, p.y - h, size, size, r);
  return d;
}

/** Circles centred on each point → one path. */
export function circlesPath(points: readonly Pt[], r: number): string {
  let d = '';
  const a = n(r);
  for (const p of points) d += `M${n(p.x - r)} ${n(p.y)}a${a} ${a} 0 1 0 ${n(2 * r)} 0a${a} ${a} 0 1 0 ${n(-2 * r)} 0z`;
  return d;
}

/** Open polylines → one path. */
export function polylinesPath(lines: readonly (readonly Pt[])[]): string {
  let d = '';
  for (const line of lines) {
    line.forEach((p, i) => {
      d += `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`;
    });
  }
  return d;
}

/**
 * Serpentine (meander) antenna trace: vertical strokes between yTop and yBot,
 * stepping right by `step`, starting at the bottom-left feed point.
 */
export function meanderPath(x0: number, x1: number, yTop: number, yBot: number, step: number): string {
  if (step <= 0 || x1 <= x0) return '';
  let d = `M${n(x0)} ${n(yBot)}V${n(yTop)}`;
  let x = x0;
  let up = true; // we are at the top
  while (x + step <= x1 + 1e-9) {
    x += step;
    d += `H${n(x)}V${n(up ? yBot : yTop)}`;
    up = !up;
  }
  return d;
}

/**
 * Battery lead: from an exit point (sx, sy) an S-curve down to (px, py - tip),
 * where the straight tinned tip of length `tip` starts (it ends ON the pin).
 */
export function leadPath(sx: number, sy: number, px: number, py: number, tip: number): string {
  const ey = py - tip;
  const my = (sy + ey) / 2;
  return `M${n(sx)} ${n(sy)}C${n(sx)} ${n(my + 0.35)} ${n(px)} ${n(my - 0.35)} ${n(px)} ${n(ey)}`;
}

/** Position of a pin by id (fallback when the def lacks it, so renders never throw). */
export function pinPoint(pins: readonly { id: string; x: number; y: number }[], id: string, fallback: Pt): Pt {
  const p = pins.find((q) => q.id === id);
  return p ? { x: p.x, y: p.y } : fallback;
}

/* ------------------------------------------------------------------------- */
/* SMD passives (resistors / capacitors seen from above)                     */
/* ------------------------------------------------------------------------- */

export interface Smd {
  x: number; // centre
  y: number;
  /** Long axis vertical? */
  v?: boolean;
  /** Size code: 0603 (default) or 0805. */
  big?: boolean;
}

/** Bodies and metal end caps of many SMD passives → two paths. */
export function smdPaths(list: readonly Smd[]): { body: string; caps: string } {
  const body: Rect[] = [];
  const caps: Rect[] = [];
  for (const s of list) {
    const L = s.big ? 0.8 : 0.62;
    const W = s.big ? 0.5 : 0.34;
    const c = L * 0.24;
    if (s.v) {
      body.push({ x: s.x - W / 2, y: s.y - L / 2, w: W, h: L });
      caps.push({ x: s.x - W / 2, y: s.y - L / 2, w: W, h: c }, { x: s.x - W / 2, y: s.y + L / 2 - c, w: W, h: c });
    } else {
      body.push({ x: s.x - L / 2, y: s.y - W / 2, w: L, h: W });
      caps.push({ x: s.x - L / 2, y: s.y - W / 2, w: c, h: W }, { x: s.x + L / 2 - c, y: s.y - W / 2, w: c, h: W });
    }
  }
  return { body: rectsPath(body), caps: rectsPath(caps) };
}

/* ------------------------------------------------------------------------- */
/* Colour                                                                    */
/* ------------------------------------------------------------------------- */

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** #rrggbb from three 0..1 channels. */
export function rgbHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Parse #rgb / #rrggbb → 0..1 channels (black on bad input). */
export function parseHex(hex: string): [number, number, number] {
  let s = hex.trim().replace(/^#/, '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return [0, 0, 0];
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255) as [number, number, number];
}

/** Linear mix a→b by t (0 = a, 1 = b). */
export function mixHex(a: string, b: string, t: number): string {
  const A = parseHex(a);
  const B = parseHex(b);
  const k = clamp01(t);
  return rgbHex(A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k);
}

/**
 * An LED colour from a 0..1 RGB drive: hue normalised to full saturation
 * (the lens looks saturated even when dim) plus the intensity (max channel).
 * Returns null when the LED is off.
 */
export function ledColor(rgb: readonly [number, number, number] | undefined | null): { hex: string; level: number } | null {
  if (!rgb) return null;
  const [r, g, b] = rgb.map(clamp01);
  const level = Math.max(r, g, b);
  if (level < 0.02) return null;
  return { hex: rgbHex(r / level, g / level, b / level), level };
}
