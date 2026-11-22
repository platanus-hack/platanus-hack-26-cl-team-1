// Min filter of a grid over an approximately circular window (a regular octagon), in O(cells) whatever the
// radius: the octagon is the Minkowski sum of four line segments (horizontal, vertical and the two
// diagonals), and a min filter over A + B is the min filter over A followed by the one over B. Each line
// segment is a 1D running min (van Herk / Gil-Werman: about 3 comparisons per cell).

/** Half-lengths of the octagon window: `a` cells along the axes (a square of side 2a + 1) and `d` steps
 *  along each diagonal. The window is the set of offsets (i + t + s, j + t - s) with |i|, |j| <= a and
 *  |t|, |s| <= d. */
export interface OctagonWindow {
  a: number
  d: number
}

/** The octagon circumscribing the circle of radius R = round(radiusCells): its support is R along the
 *  axes and about R along the diagonals, so it holds every offset within R cells and none beyond 1.17 R
 *  (1.11 R from R = 10 on; at the octagon's corners; checked for R = 4 .. 60 in cues.test.ts). Below 4 cells it is a square of
 *  half-width R (the diagonal segments would leave parity holes with a square of half-width under 2). */
export function octagonWindow(radiusCells: number): OctagonWindow {
  if (!(Number.isFinite(radiusCells) && radiusCells >= 0)) throw new Error(`octagonWindow: radius ${radiusCells} must be finite and >= 0`)
  const R = Math.round(radiusCells)
  if (R < 4) return { a: R, d: 0 }
  // Axis support a + 2d = R; diagonal support sqrt(2) (a + d) = R  =>  d = R (1 - 1/sqrt 2).
  const d = Math.round(R * (1 - Math.SQRT1_2))
  return { a: R - 2 * d, d }
}

/** Running min over [k - h, k + h] of the line src[start + k * step], k = 0 .. len - 1, written to
 *  dst at the same positions (+Infinity beyond the ends). buf/pre/suf are scratch buffers of at least
 *  len + 4h + 1 entries. Van Herk / Gil-Werman: blocks of w = 2h + 1 on the line padded by h. */
function lineMin(
  src: Float32Array,
  dst: Float32Array,
  start: number,
  step: number,
  len: number,
  h: number,
  buf: Float32Array,
  pre: Float32Array,
  suf: Float32Array,
): void {
  const w = 2 * h + 1
  const P = Math.ceil((len + 2 * h) / w) * w
  // The line padded with h cells of +Infinity on the left and enough on the right to fill the last block.
  for (let q = 0; q < h; q++) buf[q] = Infinity
  for (let k = 0, i = start; k < len; k++, i += step) buf[k + h] = src[i]
  for (let q = len + h; q < P; q++) buf[q] = Infinity
  // Prefix and suffix min within each block.
  for (let q0 = 0; q0 < P; q0 += w) {
    const q1 = q0 + w
    let m = Infinity
    for (let q = q0; q < q1; q++) {
      const v = buf[q]
      if (v < m) m = v
      pre[q] = m
    }
    m = Infinity
    for (let q = q1 - 1; q >= q0; q--) {
      const v = buf[q]
      if (v < m) m = v
      suf[q] = m
    }
  }
  // Window of padded indices [k, k + 2h]: at most two blocks.
  for (let k = 0, i = start; k < len; k++, i += step) {
    const x = suf[k]
    const y = pre[k + 2 * h]
    dst[i] = x < y ? x : y
  }
}

/** One pass of the 1D running min along direction (dr, dc) in {(0,1), (1,0), (1,1), (1,-1)}. */
function pass(src: Float32Array, dst: Float32Array, rows: number, cols: number, dr: number, dc: number, h: number) {
  if (h === 0) {
    dst.set(src)
    return
  }
  const maxLen = Math.max(rows, cols)
  const buf = new Float32Array(maxLen + 4 * h + 1)
  const pre = new Float32Array(maxLen + 4 * h + 1)
  const suf = new Float32Array(maxLen + 4 * h + 1)
  const step = dr * cols + dc
  if (dr === 0) {
    for (let r = 0; r < rows; r++) lineMin(src, dst, r * cols, 1, cols, h, buf, pre, suf)
    return
  }
  if (dc === 0) {
    for (let c = 0; c < cols; c++) lineMin(src, dst, c, cols, rows, h, buf, pre, suf)
    return
  }
  // Diagonals: every line starts on the top row or on the first (dc = 1) / last (dc = -1) column.
  const edgeCol = dc === 1 ? 0 : cols - 1
  for (let c = 0; c < cols; c++) {
    const len = Math.min(rows, dc === 1 ? cols - c : c + 1)
    lineMin(src, dst, c, step, len, h, buf, pre, suf)
  }
  for (let r = 1; r < rows; r++) {
    const len = Math.min(rows - r, cols)
    lineMin(src, dst, r * cols + edgeCol, step, len, h, buf, pre, suf)
  }
}

/** out[p] = min of src over the cells p + offset, offset in the octagon window (cells outside the grid
 *  are ignored). Exact (equal to the brute-force min over the window's offsets): the grid is padded with
 *  +Infinity by the window's extent, so the intermediate passes never lose a path through the margin. */
export function minFilterOctagon(src: Float32Array, rows: number, cols: number, win: OctagonWindow): Float32Array {
  const { a, d } = win
  if (!(Number.isInteger(a) && a >= 0 && Number.isInteger(d) && d >= 0)) throw new Error(`minFilterOctagon: bad window a=${a} d=${d}`)
  if (src.length !== rows * cols) throw new Error(`minFilterOctagon: src has ${src.length} cells, grid is ${rows} x ${cols}`)
  const m = d > 0 ? a + 2 * d : 0 // the square alone is separable on the grid itself: no padding needed
  const R = rows + 2 * m
  const C = cols + 2 * m
  let x = new Float32Array(R * C)
  if (m > 0) {
    x.fill(Infinity)
    for (let r = 0; r < rows; r++) x.set(src.subarray(r * cols, (r + 1) * cols), (r + m) * C + m)
  } else x.set(src)
  let y = new Float32Array(R * C)
  const dirs: [number, number, number][] = [
    [0, 1, a],
    [1, 0, a],
    [1, 1, d],
    [1, -1, d],
  ]
  for (const [dr, dc, h] of dirs) {
    if (h === 0) continue
    pass(x, y, R, C, dr, dc, h)
    const t = x
    x = y
    y = t
  }
  if (m === 0) return x
  const out = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) out.set(x.subarray((r + m) * C + m, (r + m) * C + m + cols), r * cols)
  return out
}
