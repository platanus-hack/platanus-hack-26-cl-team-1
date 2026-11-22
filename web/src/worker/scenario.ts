// The user's scenario (everything the control panel can change) and the pure functions that turn it into
// engine inputs. Shared by the UI thread and the simulation worker.
import type { BrigadesFile, GridMeta, IgnitionPreset, Ignition, WeatherFile, WeatherSample, WeatherSeries } from '../engine/types'
import type { BrigadeSettings } from '../engine/brigade'
import { FUEL } from '../engine/types'
import { lonLatToCell, lonLatToColRow } from '../data/grid'
import { localToMin } from '../data/time'


export type WeatherMode = 'real' | 'constante'

export interface WeatherSettings {
  mode: WeatherMode
  /** mode "real": adjustments applied to the hourly series. */
  windFactor: number
  windDirOffsetDeg: number
  rhOffset: number
  tempOffsetC: number
  /** mode "constante": absolute values held all along the simulation. */
  windKmh: number
  windFromDeg: number
  rh: number
  tempC: number
}

export const FIREBREAK_WIDTHS = [30, 60, 90, 120] as const
export type FirebreakWidth = (typeof FIREBREAK_WIDTHS)[number]

export interface Firebreak {
  id: string
  /** [lon, lat] polyline. */
  points: [number, number][]
  widthM: FirebreakWidth
}

export interface UserIgnition {
  id: string
  lon: number
  lat: number
  tMin: number
}

export interface Scenario {
  weather: WeatherSettings
  droughtFactor: number
  spotting: boolean
  spotMetresPerKmh: number
  /** Ids of the enabled preset ignitions (ignitions.json). */
  presetIgnitions: string[]
  userIgnitions: UserIgnition[]
  firebreaks: Firebreak[]
  alertMin: number
  /** Environmental-cue (spontaneous) evacuation: share 0..1 of households that leave when they see the
   *  fire, and the distance (m) at which they see it (EvacParams.cueShare / cueRadiusM). */
  cueShare: number
  cueRadiusM: number
  prepMedianMin: number
  /** 0..1 */
  footShare: number
  closedEdges: number[]
  addedLinks: { u: number; v: number }[]
  /** Firefighters (off by default: the calibrated model has no suppression). */
  brigades: BrigadeScenario
}

export interface BrigadeScenario extends BrigadeSettings {
  enabled: boolean
}

/** The firefighter settings as brigades.json ships them (counts, dispatch and arrival times, cuts on), off. */
export function defaultBrigades(file: BrigadesFile, t0: string): BrigadeScenario {
  return {
    enabled: false,
    units: Object.fromEntries(file.stations.map((s) => [s.id, s.units.slice()])),
    dispatchMin: Object.fromEntries(file.dispatch.map((d) => [d.cuerpo, localToMin(t0, d.dispatchLocal)])),
    reinforcementUnits: Object.fromEntries(file.reinforcements.map((r) => [r.id, r.units.slice()])),
    reinforcementMin: Object.fromEntries(file.reinforcements.map((r) => [r.id, localToMin(t0, r.arrivalLocal)])),
    historicalCuts: true,
  }
}

/** Firefighter settings for an event without brigades.json (EventDef.layers.brigades false): off, nothing to plan. */
export function noBrigades(): BrigadeScenario {
  return { enabled: false, units: {}, dispatchMin: {}, reinforcementUnits: {}, reinforcementMin: {}, historicalCuts: false }
}

/** Max trucks of one type per company (the panel's stepper limit). */
export const MAX_UNITS = 99

/** Scales every count by k with cumulative rounding per type across entries, so halving 28 companies of
 *  one truck gives 14 trucks (not 28), and clamps each count to MAX_UNITS. */
export function scaleUnits(units: Record<string, number[]>, k: number): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  const cum: number[] = []
  for (const [id, u] of Object.entries(units)) {
    out[id] = u.map((x, t) => {
      const prev = cum[t] ?? 0
      cum[t] = prev + x
      return Math.min(MAX_UNITS, Math.round(cum[t] * k) - Math.round(prev * k))
    })
  }
  return out
}

/** Everything the second (defended) fire run depends on beyond fireKey: null when firefighters are off. */
export function brigadeKey(s: Scenario): string | null {
  return s.brigades.enabled ? JSON.stringify(s.brigades) : null
}

/** The part of the scenario the fire depends on (the worker reruns the fire only when this changes). */
export function fireKey(s: Scenario): string {
  return JSON.stringify([s.weather, s.droughtFactor, s.spotting, s.spotMetresPerKmh, s.presetIgnitions, s.userIgnitions, s.firebreaks])
}

// ---------------------------------------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------------------------------------

export const RH_MIN = 1
export const RH_MAX = 100

export interface WeatherBuild {
  series: WeatherSeries
  /** Visible notes for the panel (e.g. relative humidity clamped to its physical range). */
  notes: string[]
}

/** Builds the engine's WeatherSeries from a weather file and the user's settings. `windDirCorrectionDeg` is
 *  Dataset.windDirCorrectionDeg: the calibrated ERA5 correction for 2024 (see engine/fire/MODEL.md), 0 for a
 *  forecast. */
export function buildWeatherSeries(file: WeatherFile, t0: string, w: WeatherSettings, windDirCorrectionDeg: number): WeatherBuild {
  if (w.mode === 'constante') {
    if (w.rh < RH_MIN || w.rh > RH_MAX) throw new Error(`Humedad relativa fuera de rango: ${w.rh} %`)
    return {
      series: { t0Min: 0, stepMin: 60, samples: [{ tempC: w.tempC, rh: w.rh, windKmh: w.windKmh, windFromDeg: norm360(w.windFromDeg) }] },
      notes: [],
    }
  }
  const t0Min = localToMin(t0, file.times[0])
  const stepMin = localToMin(t0, file.times[1]) - t0Min
  let clamped = 0
  const samples: WeatherSample[] = file.times.map((_, i) => {
    const rawRh = file.rh[i] + w.rhOffset
    // Physical cap: relative humidity lives in [1, 100] %. Clamping is reported to the user (notes).
    const rh = Math.min(RH_MAX, Math.max(RH_MIN, rawRh))
    if (rh !== rawRh) clamped++
    return {
      tempC: file.tempC[i] + w.tempOffsetC,
      rh,
      windKmh: file.windKmh[i] * w.windFactor,
      // The source's calibrated correction (ERA5 on the scar; none for a forecast), then the user's offset.
      windFromDeg: norm360(file.windFromDeg[i] + windDirCorrectionDeg + w.windDirOffsetDeg),
    }
  })
  const notes = clamped > 0 ? [`La humedad ajustada quedó fuera de 1–100 % en ${clamped} de ${samples.length} horas; se limitó a ese rango.`] : []
  return { series: { t0Min, stepMin, samples }, notes }
}

export function norm360(d: number): number {
  return ((d % 360) + 360) % 360
}

/** Sample of the series at time t (linear, direction on the circle, held outside the range), as the engine does. */
export function sampleAt(s: WeatherSeries, tMin: number): WeatherSample {
  const x = (tMin - s.t0Min) / s.stepMin
  const n = s.samples.length
  if (x <= 0 || n === 1) return s.samples[0]
  if (x >= n - 1) return s.samples[n - 1]
  const i = Math.floor(x)
  const f = x - i
  const a = s.samples[i]
  const b = s.samples[i + 1]
  let dd = b.windFromDeg - a.windFromDeg
  if (dd > 180) dd -= 360
  if (dd < -180) dd += 360
  return {
    tempC: a.tempC + f * (b.tempC - a.tempC),
    rh: a.rh + f * (b.rh - a.rh),
    windKmh: a.windKmh + f * (b.windKmh - a.windKmh),
    windFromDeg: norm360(a.windFromDeg + f * dd),
  }
}

// ---------------------------------------------------------------------------------------------------------
// Ignitions
// ---------------------------------------------------------------------------------------------------------

export function buildIgnitions(grid: GridMeta, presets: IgnitionPreset[], s: Scenario): Ignition[] {
  const out: Ignition[] = []
  for (const id of s.presetIgnitions) {
    const p = presets.find((q) => q.id === id)
    if (!p) throw new Error(`Ignición desconocida: ${id}`)
    const cell = lonLatToCell(grid, p.lon, p.lat)
    if (cell < 0) throw new Error(`La ignición "${p.label}" está fuera de la grilla`)
    out.push({ cell, tMin: localToMin(grid.t0, p.timeLocal) })
  }
  for (const u of s.userIgnitions) {
    const cell = lonLatToCell(grid, u.lon, u.lat)
    if (cell < 0) throw new Error('Una ignición agregada está fuera de la grilla')
    out.push({ cell, tMin: u.tMin })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// Firebreaks
// ---------------------------------------------------------------------------------------------------------

/** Rasterises firebreak polylines into a 0/1 mask. Each segment is first traced as a 4-connected chain of
 *  cells (so a thin diagonal line leaves no corner gaps the fire could slip through), then every cell whose
 *  centre lies within widthM/2 of the segment is added. */
export function rasteriseFirebreaks(grid: GridMeta, firebreaks: Firebreak[]): Uint8Array {
  const { rows, cols, cellM } = grid
  const mask = new Uint8Array(rows * cols)
  const mark = (c: number, r: number) => {
    if (r >= 0 && c >= 0 && r < rows && c < cols) mask[r * cols + c] = 1
  }
  for (const fb of firebreaks) {
    if (fb.points.length < 2) throw new Error(`El cortafuego ${fb.id} tiene menos de 2 puntos`)
    const hw = fb.widthM / 2 / cellM // half width in cells
    for (let k = 0; k + 1 < fb.points.length; k++) {
      const [x0, y0] = lonLatToColRow(grid, fb.points[k][0], fb.points[k][1])
      const [x1, y1] = lonLatToColRow(grid, fb.points[k + 1][0], fb.points[k + 1][1])
      // 1) 4-connected trace
      const len = Math.hypot(x1 - x0, y1 - y0)
      const steps = Math.max(1, Math.ceil(len * 4))
      let pc = Math.floor(x0)
      let pr = Math.floor(y0)
      mark(pc, pr)
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const c = Math.floor(x0 + t * (x1 - x0))
        const r = Math.floor(y0 + t * (y1 - y0))
        if (c !== pc && r !== pr) mark(c, pr) // diagonal move: fill the corner
        mark(c, r)
        pc = c
        pr = r
      }
      // 2) width
      const c0 = Math.floor(Math.min(x0, x1) - hw - 1)
      const c1 = Math.ceil(Math.max(x0, x1) + hw + 1)
      const r0 = Math.floor(Math.min(y0, y1) - hw - 1)
      const r1 = Math.ceil(Math.max(y0, y1) + hw + 1)
      const dx = x1 - x0
      const dy = y1 - y0
      const l2 = dx * dx + dy * dy
      for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++)
        for (let c = Math.max(0, c0); c <= Math.min(cols - 1, c1); c++) {
          const px = c + 0.5
          const py = r + 0.5
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / l2))
          if (Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) <= hw) mask[r * cols + c] = 1
        }
    }
  }
  return mask
}

// ---------------------------------------------------------------------------------------------------------
// Safe zones (for drawing only; mirrors the definition of EvacParams.safeDistanceM in types.ts)
// ---------------------------------------------------------------------------------------------------------

const WILDLAND = new Set<number>([FUEL.GRASS, FUEL.SHRUB, FUEL.FOREST, FUEL.CROP])

/** Distance (m) from each cell centre to the nearest wildland-fuel cell (chamfer 3-4 approximation). */
export function wildlandDistanceM(grid: GridMeta, fuel: Uint8Array): Float32Array {
  const { rows, cols, cellM } = grid
  const d = new Float32Array(rows * cols)
  for (let i = 0; i < d.length; i++) d[i] = WILDLAND.has(fuel[i]) ? 0 : Infinity
  const D1 = 1
  const D2 = Math.SQRT2
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      let v = d[i]
      if (c > 0) v = Math.min(v, d[i - 1] + D1)
      if (r > 0) {
        v = Math.min(v, d[i - cols] + D1)
        if (c > 0) v = Math.min(v, d[i - cols - 1] + D2)
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + D2)
      }
      d[i] = v
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c
      let v = d[i]
      if (c < cols - 1) v = Math.min(v, d[i + 1] + D1)
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + D1)
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + D2)
        if (c > 0) v = Math.min(v, d[i + cols - 1] + D2)
      }
      d[i] = v
    }
  for (let i = 0; i < d.length; i++) d[i] *= cellM
  return d
}

/** 1 for road nodes that are safe destinations in this run: far enough from wildland fuel and not burned. */
export function safeNodes(
  grid: GridMeta,
  nodes: [number, number][],
  wildDistM: Float32Array,
  arrivalMin: Float32Array,
  safeDistanceM: number,
): Uint8Array {
  const out = new Uint8Array(nodes.length)
  for (let k = 0; k < nodes.length; k++) {
    const cell = lonLatToCell(grid, nodes[k][0], nodes[k][1])
    if (cell < 0) continue
    if (wildDistM[cell] >= safeDistanceM && arrivalMin[cell] === Infinity) out[k] = 1
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// Results helpers
// ---------------------------------------------------------------------------------------------------------

/** Sorted finite arrival times, for "burned area at time t" by binary search. */
export function sortedArrivals(arrival: Float32Array): Float32Array {
  let n = 0
  for (let i = 0; i < arrival.length; i++) if (arrival[i] !== Infinity) n++
  const out = new Float32Array(n)
  let k = 0
  for (let i = 0; i < arrival.length; i++) if (arrival[i] !== Infinity) out[k++] = arrival[i]
  return out.sort()
}

/** Number of entries <= t in a sorted array. */
export function countAtOrBefore(sorted: Float32Array, t: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] <= t) lo = mid + 1
    else hi = mid
  }
  return lo
}
