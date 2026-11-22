// Grid geometry (conventions in GridMeta, src/engine/types.ts): row 0 north, col 0 west, row-major.
import type { GridMeta } from '../engine/types'

export function cellCentre(g: GridMeta, cell: number): [number, number] {
  const r = Math.floor(cell / g.cols)
  const c = cell % g.cols
  return [g.lonMin + (c + 0.5) * g.dLon, g.latMax - (r + 0.5) * g.dLat]
}

/** Cell index containing (lon, lat), or -1 when outside the grid. */
export function lonLatToCell(g: GridMeta, lon: number, lat: number): number {
  const c = Math.floor((lon - g.lonMin) / g.dLon)
  const r = Math.floor((g.latMax - lat) / g.dLat)
  if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return -1
  return r * g.cols + c
}

/** Fractional (col, row) of a point in cell units (cell (0,0) spans [0,1) x [0,1)). */
export function lonLatToColRow(g: GridMeta, lon: number, lat: number): [number, number] {
  return [(lon - g.lonMin) / g.dLon, (g.latMax - lat) / g.dLat]
}

/** Grid bounds as [west, south, east, north]. */
export function gridBounds(g: GridMeta): [number, number, number, number] {
  return [g.lonMin, g.latMax - g.rows * g.dLat, g.lonMin + g.cols * g.dLon, g.latMax]
}

/** Four corners for a MapLibre image/canvas source: top-left, top-right, bottom-right, bottom-left. */
export function gridCorners(g: GridMeta): [[number, number], [number, number], [number, number], [number, number]] {
  const [w, s, e, n] = gridBounds(g)
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ]
}
