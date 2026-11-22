// Pacing of a simulated fire against satellite fire detections, scored in both directions: whether the model
// front is ahead of or behind the observed front at each pass (lag in minutes), and how much the model burns
// where the satellite saw no fire (overrun). Pure functions; calibrate.ts runs them on the real data.
// MODEL.md section 6 explains how the numbers are used.
import { cellCentre } from '../../data/grid'
import type { GridMeta } from '../types'

/** A fire detection: pixel centre and time in simulation minutes. */
export interface Obs {
  lon: number
  lat: number
  tMin: number
}

/** Lag reported when the model never reaches the observed front, or is that far ahead (minutes). */
export const LAG_CAP_MIN = 180
/** Half a pixel per sensor (km): an observed front within this of the model front counts as on time. */
export const HALF_PIXEL_KM = { goes: 1.0, viirs: 0.19, modis: 0.5 } as const
/** Footprint radius per sensor (m) for the overrun: model cells farther than this from every detection. */
export const FOOTPRINT_M = { goes: 2000, viirs: 750, modis: 1500 } as const
/** Link radius per sensor (km) for fireCluster: about one pixel diagonal plus navigation error. */
export const LINK_KM = { goes: 4, viirs: 2, modis: 3 } as const

const KM_PER_DEG = 111.32

/** Equirectangular distance (km) from origin; good to < 0.1 % over the 30 km of the grid. */
export function distanceKm(origin: [number, number], lon: number, lat: number): number {
  const kx = KM_PER_DEG * Math.cos((origin[1] * Math.PI) / 180)
  return Math.hypot((lon - origin[0]) * kx, (lat - origin[1]) * KM_PER_DEG)
}

/** The detections of the fire that started at origin: each one must lie within linkKm of the origin or of a
 *  detection of the same fire seen at the same time or earlier. Unrelated fires and isolated false alarms are
 *  left out. Returned in time order. */
export function fireCluster<T extends Obs>(obs: T[], origin: [number, number], linkKm: number): T[] {
  const sorted = [...obs].sort((a, b) => a.tMin - b.tMin)
  const members: T[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length && sorted[j].tMin === sorted[i].tMin) j++
    // One satellite frame: repeat until no more points join, so points of the same frame can chain.
    const pending = sorted.slice(i, j)
    let joined = true
    while (joined && pending.length > 0) {
      joined = false
      for (let k = pending.length - 1; k >= 0; k--) {
        const p = pending[k]
        const near =
          distanceKm(origin, p.lon, p.lat) <= linkKm ||
          members.some((m) => distanceKm([m.lon, m.lat], p.lon, p.lat) <= linkKm)
        if (near) {
          members.push(p)
          pending.splice(k, 1)
          joined = true
        }
      }
    }
    i = j
  }
  return members.sort((a, b) => a.tMin - b.tMin)
}

/** Farthest distance (km) from origin of the detections seen by tMin, or null if none yet. */
export function observedFrontKm(obs: Obs[], origin: [number, number], tMin: number): number | null {
  let best: number | null = null
  for (const o of obs) if (o.tMin <= tMin) best = Math.max(best ?? 0, distanceKm(origin, o.lon, o.lat))
  return best
}

/** Last time (min, at most tEnd) the observed front grew, or null with no detection by tEnd. After it the real
 *  fire had stopped advancing (firefighting, the city, the coast), which the model, with no suppression, cannot
 *  do: lags scored after it measure that overshoot, not the pace of the spread. */
export function lastAdvanceMin(obs: Obs[], origin: [number, number], tEnd: number): number | null {
  let front = -1
  let last: number | null = null
  for (const o of [...obs].sort((a, b) => a.tMin - b.tMin)) {
    if (o.tMin > tEnd) break
    const d = distanceKm(origin, o.lon, o.lat)
    if (d > front) {
      front = d
      last = o.tMin
    }
  }
  return last
}

/** Root mean square of front lags (min). An empty set has no score: it throws instead of reading as perfect. */
export function rmsLag(lags: number[]): number {
  if (lags.length === 0) throw new Error('rmsLag: no frames to score')
  return Math.sqrt(lags.reduce((s, x) => s + x * x, 0) / lags.length)
}

/** Element k = earliest model arrival (min) among cells at least k·binKm from origin. Non-decreasing in k. */
export function frontCurve(arrival: Float32Array, grid: GridMeta, origin: [number, number], binKm = 0.1): Float64Array {
  const n = grid.rows * grid.cols
  const bins = new Int32Array(n)
  let maxBin = 0
  for (let i = 0; i < n; i++) {
    const [lon, lat] = cellCentre(grid, i)
    const k = Math.floor(distanceKm(origin, lon, lat) / binKm)
    bins[i] = k
    if (k > maxBin) maxBin = k
  }
  const curve = new Float64Array(maxBin + 1).fill(Infinity)
  for (let i = 0; i < n; i++) if (arrival[i] < curve[bins[i]]) curve[bins[i]] = arrival[i]
  for (let k = maxBin - 1; k >= 0; k--) curve[k] = Math.min(curve[k], curve[k + 1])
  return curve
}

/** Model front distance (km) at tMin from a frontCurve; -1 if the fire has not started. */
export function modelFrontKm(curve: Float64Array, binKm: number, tMin: number): number {
  let k = -1
  while (k + 1 < curve.length && curve[k + 1] <= tMin) k++
  return k < 0 ? -1 : k * binKm
}

/** Minutes the model is late (+) or early (−) at reaching the observed front dObsKm seen at tMin. On time (0) if the
 *  model front is within halfPixelKm of it; ±capMin if the model never gets there or is that far ahead. */
export function frontLagMin(curve: Float64Array, binKm: number, dObsKm: number, tMin: number, halfPixelKm: number, capMin = LAG_CAP_MIN): number {
  const dMod = modelFrontKm(curve, binKm, tMin)
  if (Math.abs(dMod - dObsKm) <= halfPixelKm + 1e-9) return 0
  const late = dMod < dObsKm
  const target = late ? dObsKm - halfPixelKm : dObsKm + halfPixelKm
  const k = Math.max(0, Math.ceil(target / binKm - 1e-9))
  const t = k < curve.length ? curve[k] : Infinity
  return late ? Math.min(capMin, t - tMin) : Math.max(-capMin, t - tMin)
}

/** Area (ha) the model has burned by tMin farther than radiusM from every detection seen by tMin. */
export function overrunHa(arrival: Float32Array, grid: GridMeta, obs: Obs[], tMin: number, radiusM: number): number {
  const supported = new Uint8Array(grid.rows * grid.cols)
  const rad = Math.ceil(radiusM / grid.cellM)
  for (const o of obs) {
    if (o.tMin > tMin) continue
    const r0 = (grid.latMax - o.lat) / grid.dLat - 0.5
    const c0 = (o.lon - grid.lonMin) / grid.dLon - 0.5
    for (let r = Math.max(0, Math.floor(r0 - rad)); r <= Math.min(grid.rows - 1, Math.ceil(r0 + rad)); r++)
      for (let c = Math.max(0, Math.floor(c0 - rad)); c <= Math.min(grid.cols - 1, Math.ceil(c0 + rad)); c++)
        if (Math.hypot(r - r0, c - c0) * grid.cellM <= radiusM) supported[r * grid.cols + c] = 1
  }
  let cells = 0
  for (let i = 0; i < arrival.length; i++) if (arrival[i] <= tMin && !supported[i]) cells++
  return (cells * grid.cellM ** 2) / 1e4
}
