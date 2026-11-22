// Raster overlays drawn into canvases (one pixel per grid cell, row 0 = north), used as MapLibre canvas sources.
import type { FuelCode, GridMeta } from '../engine/types'

/** Cells whose fire arrived within this many minutes before the clock are drawn as "burning now". */
export const BURNING_WINDOW_MIN = 30

export function sizeCanvas(canvas: HTMLCanvasElement, grid: GridMeta, scale = 1) {
  if (canvas.width !== grid.cols * scale) canvas.width = grid.cols * scale
  if (canvas.height !== grid.rows * scale) canvas.height = grid.rows * scale
}

let fireImage: ImageData | null = null

export function drawFire(canvas: HTMLCanvasElement, grid: GridMeta, arrival: Float32Array | null, ros: Float32Array | null, t: number) {
  sizeCanvas(canvas, grid)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite dibujar en canvas 2D')
  if (!fireImage || fireImage.width !== grid.cols || fireImage.height !== grid.rows) fireImage = ctx.createImageData(grid.cols, grid.rows)
  const px = fireImage.data
  px.fill(0)
  if (arrival && ros) {
    const tBurn = t - BURNING_WINDOW_MIN
    for (let i = 0; i < arrival.length; i++) {
      const a = arrival[i]
      if (a > t) continue // also skips Infinity
      const o = i * 4
      if (a > tBurn) {
        // Burning now: orange (slow) to bright yellow (fast). 40 m/min is already a very fast head fire.
        const k = Math.min(1, Math.sqrt(ros[i] / 40))
        px[o] = 255
        px[o + 1] = Math.round(110 + 120 * k)
        px[o + 2] = Math.round(20 + 70 * k)
        px[o + 3] = 235
      } else {
        // Burned
        px[o] = 88
        px[o + 1] = 22
        px[o + 2] = 14
        px[o + 3] = 175
      }
    }
  }
  ctx.putImageData(fireImage, 0, 0)
}

export const FUEL_COLOURS: Record<FuelCode, [number, number, number, number]> = {
  0: [0, 0, 0, 0],
  1: [214, 196, 106, 150],
  2: [140, 150, 70, 160],
  3: [46, 110, 60, 170],
  4: [190, 160, 90, 140],
  5: [170, 150, 170, 120],
  6: [120, 100, 130, 140],
}

export function drawFuel(canvas: HTMLCanvasElement, grid: GridMeta, fuel: Uint8Array) {
  sizeCanvas(canvas, grid)
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(grid.cols, grid.rows)
  for (let i = 0; i < fuel.length; i++) {
    const c = FUEL_COLOURS[fuel[i] as FuelCode]
    img.data.set(c, i * 4)
  }
  ctx.putImageData(img, 0, 0)
}

/** People per cell above which the population layer is drawn at full colour (log scale below it). */
export const POPULATION_FULL_AT = 300

/** People per cell at a given share of residents away (home + away * (work - home)): violet, more opaque and
 *  lighter with more people, on a log scale; empty cells transparent. */
export function drawPopulation(canvas: HTMLCanvasElement, grid: GridMeta, home: Float32Array, work: Float32Array, away: number) {
  sizeCanvas(canvas, grid)
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(grid.cols, grid.rows)
  const top = Math.log1p(POPULATION_FULL_AT)
  for (let i = 0; i < home.length; i++) {
    const n = home[i] + away * (work[i] - home[i])
    if (n < 0.5) continue
    const k = Math.min(1, Math.log1p(n) / top)
    const o = i * 4
    img.data[o] = Math.round(110 + 135 * k)
    img.data[o + 1] = Math.round(60 + 150 * k)
    img.data[o + 2] = 255
    img.data[o + 3] = Math.round(70 + 170 * k)
  }
  ctx.putImageData(img, 0, 0)
}

/** Sentinel-2 burn scar at one pixel per cell: opaque outline cells, diagonal hatching and a faint tint, so
 *  it stays readable from the overview zoom (where one cell is about one screen pixel) to street level. */
export function drawScar(canvas: HTMLCanvasElement, grid: GridMeta, scar: Uint8Array) {
  sizeCanvas(canvas, grid)
  const ctx = canvas.getContext('2d')!
  const { rows, cols } = grid
  const img = ctx.createImageData(cols, rows)
  const burned = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols && scar[r * cols + c] === 1
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!burned(r, c)) continue
      const outline = !burned(r - 1, c) || !burned(r + 1, c) || !burned(r, c - 1) || !burned(r, c + 1)
      const hatch = (r + c) % 5 === 0
      const o = (r * cols + c) * 4
      img.data[o] = 110
      img.data[o + 1] = 215
      img.data[o + 2] = 255
      img.data[o + 3] = outline ? 240 : hatch ? 150 : 45
    }
  ctx.putImageData(img, 0, 0)
}

/** Grey hillshade from elevation.bin (fallback base map when the vector style cannot load). */
export function drawHillshade(canvas: HTMLCanvasElement, grid: GridMeta, elev: Float32Array, fuel: Uint8Array) {
  sizeCanvas(canvas, grid)
  const ctx = canvas.getContext('2d')!
  const { rows, cols, cellM } = grid
  const img = ctx.createImageData(cols, rows)
  // Light from the north-west, 45 degrees up.
  const az = (315 * Math.PI) / 180
  const alt = Math.PI / 4
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const e = (rr: number, cc: number) => elev[Math.min(rows - 1, Math.max(0, rr)) * cols + Math.min(cols - 1, Math.max(0, cc))]
      const dzdx = (e(r, c + 1) - e(r, c - 1)) / (2 * cellM)
      const dzdy = (e(r - 1, c) - e(r + 1, c)) / (2 * cellM) // north positive
      const slope = Math.atan(Math.hypot(dzdx, dzdy))
      const aspect = Math.atan2(dzdy, -dzdx)
      let shade = Math.sin(alt) * Math.cos(slope) + Math.cos(alt) * Math.sin(slope) * Math.cos(az - Math.PI / 2 - aspect)
      shade = Math.max(0, shade)
      const water = fuel[i] === 0 && elev[i] <= 1
      const v = Math.round(40 + 110 * shade)
      const o = i * 4
      img.data[o] = water ? 22 : v
      img.data[o + 1] = water ? 34 : v
      img.data[o + 2] = water ? 52 : v + 6
      img.data[o + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
}
