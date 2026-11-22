// Fire-spread engine: minimum-travel-time propagation (time-dependent Dijkstra) on the raster, with
// McArthur / CSIRO rates of spread, wind + slope as one effective wind vector, elliptical fire shape
// (Alexander 1985) and downwind ember spotting. Pure TypeScript, no DOM: runs in a Web Worker and in Node.
// The physics lives in model.ts; MODEL.md explains every formula and its source.
import { FUEL, type FireInput, type FireParams, type FireResult, type WeatherSample } from '../types'
import { CellHeap } from './heap'
import {
  FIRE_MODEL,
  SPREAD_MODEL,
  eccentricity,
  forestRosKmh,
  grassCuringFactor,
  grassMoistureFactor,
  grassMoisturePct,
  grassRosKmh,
  lengthToBreadth,
  mcArthurFFDI,
  slopeFactor,
  weatherInto,
} from './model'

export {
  ERA5_WIND_DIR_CORRECTION_DEG,
  FIRE_MODEL,
  SPREAD_MODEL,
  flatRosKmh,
  lengthToBreadth,
  mcArthurFFDI,
  weatherAt,
} from './model'

export const DEFAULT_FIRE_PARAMS: FireParams = {
  droughtFactor: 10,
  curingPct: 100,
  rosMultiplier: 1,
  spotting: true,
  spotMetresPerKmh: 25,
  horizonMin: 12 * 60, // 12:00 to midnight: the model has no suppression, so later hours overburn
}

// 16-neighbour stencil: 8 neighbours, then 8 knight moves. (dr, dc) in rows (south +) and cols (east +).
const DR = [-1, -1, -1, 0, 0, 1, 1, 1, -1, -1, 1, 1, -2, -2, 2, 2]
const DC = [-1, 0, 1, -1, 1, -1, 0, 1, -2, 2, -2, 2, -1, 1, -1, 1]
const K = DR.length
const KIND_ORTH = 0
const KIND_DIAG = 1
const KIND_KNIGHT = 2
const KIND = new Uint8Array(K)
/** Unit vector of each move in (east, north), length in cells. */
const UX = new Float64Array(K)
const UY = new Float64Array(K)
const LEN = new Float64Array(K)
/** The two cells a diagonal or knight move passes between, as (dr, dc) offsets. */
const P1R = new Int8Array(K)
const P1C = new Int8Array(K)
const P2R = new Int8Array(K)
const P2C = new Int8Array(K)
for (let k = 0; k < K; k++) {
  const dr = DR[k]
  const dc = DC[k]
  const len = Math.hypot(dr, dc)
  LEN[k] = len
  UX[k] = dc / len
  UY[k] = -dr / len
  if (Math.abs(dr) + Math.abs(dc) === 1) {
    KIND[k] = KIND_ORTH
  } else if (Math.abs(dr) === 1 && Math.abs(dc) === 1) {
    KIND[k] = KIND_DIAG
    P1R[k] = dr // (dr, 0)
    P2C[k] = dc // (0, dc)
  } else {
    KIND[k] = KIND_KNIGHT
    if (Math.abs(dc) === 2) {
      P1C[k] = dc / 2 // (0, dc/2)
      P2R[k] = dr // (dr, dc/2)
      P2C[k] = dc / 2
    } else {
      P1R[k] = dr / 2 // (dr/2, 0)
      P2R[k] = dr / 2 // (dr/2, dc)
      P2C[k] = dc
    }
  }
}

const DEG = Math.PI / 180
const KMH_TO_M_PER_MIN = 1000 / 60

export function simulateFire(input: FireInput): FireResult {
  const started = performance.now()
  validateInput(input)
  const { grid, elevation, fuel, firebreak, ignitions, weather, params } = input
  const { rows, cols, cellM } = grid
  const n = rows * cols
  const M = FIRE_MODEL
  const horizon = params.horizonMin

  // Per-fuel lookup tables (indexed by fuel code).
  const fuelModel = new Uint8Array(256)
  const fuelLoad = new Float64Array(256)
  const fuelFactor = new Float64Array(256)
  const fuelSpot = new Uint8Array(256)
  const fuelLand = new Uint8Array(256)
  const fuelSpotDist = new Float64Array(256)
  for (const code of Object.values(FUEL)) {
    const f = M.fuels[code]
    if (!f) throw new Error(`simulateFire: FIRE_MODEL.fuels has no entry for fuel code ${code}`)
    if (!(f.factor >= 0) || !(f.loadTHa >= 0) || !(M.modelFactor[f.model] >= 0)) {
      throw new Error(`simulateFire: FIRE_MODEL has a negative or invalid factor/load for fuel code ${code}`)
    }
    fuelModel[code] = f.model
    fuelLoad[code] = f.loadTHa
    fuelFactor[code] = f.factor * M.modelFactor[f.model]
    fuelSpot[code] = f.spotSource ? 1 : 0
    fuelLand[code] = f.spotTarget ? 1 : 0
    if (!(f.spotDistanceFactor >= 0)) throw new Error(`simulateFire: FIRE_MODEL has an invalid spotDistanceFactor for fuel code ${code}`)
    fuelSpotDist[code] = f.spotDistanceFactor
  }

  // Burnable: has fuel and is not a firebreak.
  const burnable = new Uint8Array(n)
  for (let i = 0; i < n; i++) burnable[i] = firebreak[i] === 0 && fuelModel[fuel[i]] !== SPREAD_MODEL.NONE ? 1 : 0

  // Slope as an equivalent wind vector pointing upslope, km/h (east, north components).
  const { slopeX, slopeY } = slopeWind(elevation, rows, cols, cellM)

  // State. time: tentative/final arrival (min); anchor: the cell whose ellipse gave `time` (see MODEL.md).
  const time = new Float64Array(n).fill(Infinity)
  const anchor = new Int32Array(n).fill(-1)
  const settled = new Uint8Array(n)
  const arrival = new Float32Array(n).fill(Infinity)
  const headR = new Float32Array(n) // head ROS at arrival, m/min (returned as rosMPerMin)
  const headX = new Float32Array(n) // head direction, unit vector (east, north)
  const headY = new Float32Array(n)
  const headE = new Float32Array(n) // ellipse eccentricity
  const heap = new CellHeap(time)

  for (const ig of ignitions) {
    if (!burnable[ig.cell]) {
      throw new Error(
        firebreak[ig.cell]
          ? `La ignición en la celda ${ig.cell} está sobre un cortafuego`
          : `La ignición en la celda ${ig.cell} cae en una zona sin combustible (agua, roca, pavimento)`,
      )
    }
    if (ig.tMin < time[ig.cell]) {
      time[ig.cell] = ig.tMin
      anchor[ig.cell] = ig.cell
      heap.pushOrDecrease(ig.cell)
    }
  }

  // Weather-derived values, recomputed only when the settle time changes.
  const w: WeatherSample = { tempC: 0, rh: 0, windKmh: 0, windFromDeg: 0 }
  const phiC = grassCuringFactor(params.curingPct)
  const rosMult = params.rosMultiplier * KMH_TO_M_PER_MIN
  let lastT = NaN
  let V = 0 // 10 m wind, km/h
  let wx = 0 // wind vector (toward), km/h
  let wy = 0
  let downR = 0 // downwind unit vector in grid (row, col) steps
  let downC = 0
  let forestPerLoad = 0 // McArthur flat ROS per t/ha of load, km/h
  let grassFlat = 0 // CSIRO flat ROS, km/h

  const anchorMax = M.anchorMaxCells
  const anchorMax2 = anchorMax * anchorMax
  const anchorRosTol = M.anchorMaxRosChange
  const anchorCosTurn = Math.cos(M.anchorMaxTurnDeg * DEG)
  const spotOn = params.spotting
  const spotMinCells = M.spotMinCells
  let burned = 0

  while (heap.size > 0) {
    const i = heap.pop()
    const t = time[i]
    if (t > horizon) break
    settled[i] = 1
    arrival[i] = t
    burned++

    if (t !== lastT) {
      lastT = t
      weatherInto(weather, t, w)
      V = w.windKmh
      const toward = (w.windFromDeg + 180) * DEG
      const sinB = Math.sin(toward)
      const cosB = Math.cos(toward)
      wx = V * sinB
      wy = V * cosB
      downR = -cosB
      downC = sinB
      forestPerLoad = forestRosKmh(mcArthurFFDI(params.droughtFactor, w.rh, w.tempC, V), 1)
      grassFlat = grassRosKmh(V, grassMoistureFactor(grassMoisturePct(w.tempC, w.rh), V), phiC)
    }

    // Head of the fire leaving cell i: effective wind = wind + slope (vector), ROS, direction, shape.
    const f = fuel[i]
    const flat = fuelModel[f] === SPREAD_MODEL.MCARTHUR_FOREST ? forestPerLoad * fuelLoad[f] : grassFlat
    const ex = wx + slopeX[i]
    const ey = wy + slopeY[i]
    const U = Math.sqrt(ex * ex + ey * ey)
    const Rh = flat * fuelFactor[f] * slopeFactor(U, V) * rosMult
    const e = eccentricity(lengthToBreadth(U))
    const hx = U > 0 ? ex / U : 0
    const hy = U > 0 ? ey / U : 1
    headR[i] = Rh
    headX[i] = hx
    headY[i] = hy
    headE[i] = e
    if (!(Rh > 0)) continue

    const r = (i / cols) | 0
    const c = i - r * cols
    const inv = 1 / (Rh * (1 - e)) // travel time per metre = (1 - e cos(phi)) * inv

    // Anchor: if i was reached straight from a's ellipse and conditions still match, neighbours may be timed
    // straight from a too (removes the zig-zag cost of a 16-direction stencil on elongated ellipses).
    const a = anchor[i]
    let useAnchor = false
    let ar = 0
    let ac = 0
    let aT = 0
    let aX = 0
    let aY = 0
    let aE = 0
    let aInv = 0
    if (anchorMax > 0 && a !== i && fuel[a] === f) {
      const aR = headR[a]
      aE = headE[a]
      aX = headX[a]
      aY = headY[a]
      if (Math.abs(Rh - aR) <= anchorRosTol * aR && (aE < 0.3 || hx * aX + hy * aY >= anchorCosTurn)) {
        useAnchor = true
        ar = (a / cols) | 0
        ac = a - ar * cols
        aT = time[a]
        aInv = 1 / (aR * (1 - aE))
      }
    }

    for (let k = 0; k < K; k++) {
      const rr = r + DR[k]
      const cc = c + DC[k]
      if (rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue
      const j = rr * cols + cc
      if (settled[j] || !burnable[j]) continue
      const kind = KIND[k]
      if (kind === KIND_DIAG) {
        // No corner-cutting between two unburnable cells (keeps 8-connected firebreak lines watertight).
        if (!burnable[(r + P1R[k]) * cols + c] && !burnable[r * cols + c + P2C[k]]) continue
      } else if (kind === KIND_KNIGHT) {
        // A knight move must pass between two burnable cells.
        if (!burnable[(r + P1R[k]) * cols + c + P1C[k]] || !burnable[(r + P2R[k]) * cols + c + P2C[k]]) continue
      }
      let tt = t + LEN[k] * cellM * (1 - e * (UX[k] * hx + UY[k] * hy)) * inv
      let from = i
      if (useAnchor && fuel[j] === f) {
        const dxc = cc - ac
        const dyc = ar - rr
        const d2 = dxc * dxc + dyc * dyc
        if (d2 <= anchorMax2) {
          const d = Math.sqrt(d2)
          const tb = aT + d * cellM * (1 - (aE * (dxc * aX + dyc * aY)) / d) * aInv
          if (tb < tt) {
            tt = tb
            from = a
          }
        }
      }
      if (tt < time[j]) {
        time[j] = tt
        anchor[j] = from
        heap.pushOrDecrease(j)
      }
    }

    // Ember spotting: jump edges downwind (+-1 cell sideways) from 3 cells up to D_max, from intense fires only.
    if (spotOn && fuelSpot[f] && V >= M.spotMinWindKmh && Rh >= M.spotMinSourceRosMPerMin) {
      const dMax = params.spotMetresPerKmh * V * fuelSpotDist[f] // metres
      const kMax = Math.floor(dMax / cellM)
      const minD = spotMinCells * cellM
      for (let s = spotMinCells; s <= kMax; s++) {
        const fr = r + s * downR
        const fc = c + s * downC
        for (let lat = -1; lat <= 1; lat++) {
          // Perpendicular to (downR, downC) is (downC, -downR).
          const tr = Math.round(fr + lat * downC)
          const tc = Math.round(fc - lat * downR)
          if (tr < 0 || tr >= rows || tc < 0 || tc >= cols) continue
          const j = tr * cols + tc
          if (settled[j] || !burnable[j] || !fuelLand[fuel[j]]) continue
          const d = Math.sqrt((tr - r) * (tr - r) + (tc - c) * (tc - c)) * cellM
          if (d < minD || d > dMax) continue
          const tt = t + M.spotDelayMin + (M.spotTravelMin * d) / dMax
          if (tt < time[j]) {
            time[j] = tt
            anchor[j] = j // a spot fire is a new ignition point
            heap.pushOrDecrease(j)
          }
        }
      }
    }
  }

  return { arrivalMin: arrival, rosMPerMin: headR, burnedCells: burned, elapsedMs: performance.now() - started }
}

/** Upslope equivalent wind per cell, km/h: U_s = slopeWindKmhPerDeg * slopeDeg along the upslope direction.
 *  Gradient by central differences (one-sided on the grid edges), metres per cellM. */
function slopeWind(z: Float32Array, rows: number, cols: number, cellM: number) {
  const n = rows * cols
  const slopeX = new Float32Array(n)
  const slopeY = new Float32Array(n)
  const k = FIRE_MODEL.slopeWindKmhPerDeg
  const maxDeg = FIRE_MODEL.maxSlopeDeg
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const cw = c > 0 ? c - 1 : c
      const ce = c < cols - 1 ? c + 1 : c
      const rn = r > 0 ? r - 1 : r
      const rs = r < rows - 1 ? r + 1 : r
      const gx = ce > cw ? (z[r * cols + ce] - z[r * cols + cw]) / ((ce - cw) * cellM) : 0 // dz/dx, east
      const gy = rs > rn ? (z[rn * cols + c] - z[rs * cols + c]) / ((rs - rn) * cellM) : 0 // dz/dy, north
      const g = Math.sqrt(gx * gx + gy * gy)
      if (g === 0) continue
      const deg = Math.min(Math.atan(g) / DEG, maxDeg) // documented physical cap, see FIRE_MODEL.maxSlopeDeg
      const us = k * deg
      slopeX[i] = (us * gx) / g
      slopeY[i] = (us * gy) / g
    }
  }
  return { slopeX, slopeY }
}

/** Rejects malformed input with a clear error (never guesses). */
function validateInput(input: FireInput): void {
  const { grid, elevation, fuel, firebreak, ignitions, weather, params } = input
  const { rows, cols, cellM } = grid
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows <= 0 || cols <= 0) {
    throw new Error(`simulateFire: grid rows/cols must be positive integers (got ${rows} x ${cols})`)
  }
  if (!(cellM > 0) || !Number.isFinite(cellM)) throw new Error(`simulateFire: grid.cellM must be > 0 (got ${cellM})`)
  const n = rows * cols
  for (const [name, arr] of [
    ['elevation', elevation],
    ['fuel', fuel],
    ['firebreak', firebreak],
  ] as const) {
    if (arr.length !== n) throw new Error(`simulateFire: ${name} has ${arr.length} cells, grid has ${rows} x ${cols} = ${n}`)
  }
  for (let i = 0; i < n; i++) {
    if (fuel[i] > FUEL.URBAN_DENSE) throw new Error(`simulateFire: unknown fuel code ${fuel[i]} at cell ${i}`)
    if (firebreak[i] > 1) throw new Error(`simulateFire: firebreak must be 0/1, got ${firebreak[i]} at cell ${i}`)
    if (!Number.isFinite(elevation[i])) throw new Error(`simulateFire: elevation is not finite at cell ${i} (${elevation[i]})`)
  }
  for (const ig of ignitions) {
    if (!Number.isInteger(ig.cell) || ig.cell < 0 || ig.cell >= n) throw new Error(`simulateFire: ignition cell ${ig.cell} is outside the grid`)
    if (!Number.isFinite(ig.tMin)) throw new Error(`simulateFire: ignition at cell ${ig.cell} has a non-finite time ${ig.tMin}`)
  }
  if (!Number.isFinite(weather.t0Min)) throw new Error(`simulateFire: weather.t0Min must be finite (got ${weather.t0Min})`)
  if (!(weather.stepMin > 0) || !Number.isFinite(weather.stepMin)) throw new Error(`simulateFire: weather.stepMin must be > 0 (got ${weather.stepMin})`)
  if (weather.samples.length === 0) throw new Error('simulateFire: weather has no samples')
  weather.samples.forEach((s, k) => {
    if (!Number.isFinite(s.tempC) || !Number.isFinite(s.windFromDeg)) throw new Error(`simulateFire: weather sample ${k} has a non-finite temperature or wind direction`)
    if (!(s.rh >= 0 && s.rh <= 100)) throw new Error(`simulateFire: weather sample ${k} has relative humidity ${s.rh} outside 0..100`)
    if (!(s.windKmh >= 0) || !Number.isFinite(s.windKmh)) throw new Error(`simulateFire: weather sample ${k} has wind speed ${s.windKmh} (must be >= 0)`)
  })
  if (!(params.droughtFactor >= 0 && params.droughtFactor <= 10)) throw new Error(`simulateFire: droughtFactor ${params.droughtFactor} outside 0..10`)
  if (!(params.curingPct >= 0 && params.curingPct <= 100)) throw new Error(`simulateFire: curingPct ${params.curingPct} outside 0..100`)
  if (!(params.rosMultiplier > 0) || !Number.isFinite(params.rosMultiplier)) throw new Error(`simulateFire: rosMultiplier must be > 0 (got ${params.rosMultiplier})`)
  if (!(params.spotMetresPerKmh >= 0) || !Number.isFinite(params.spotMetresPerKmh)) throw new Error(`simulateFire: spotMetresPerKmh must be >= 0 (got ${params.spotMetresPerKmh})`)
  if (Number.isNaN(params.horizonMin)) throw new Error('simulateFire: horizonMin is NaN')
}

/** Nearest burnable cell (has fuel, not a firebreak) to `cell` within `maxRadiusCells` (Chebyshev rings),
 *  or -1 if none. For the UI: snap a clicked or preset ignition point that falls on a road, water or a
 *  firebreak, and tell the user it was moved. */
export function nearestBurnableCell(
  grid: { rows: number; cols: number },
  fuel: Uint8Array,
  firebreak: Uint8Array,
  cell: number,
  maxRadiusCells: number,
): number {
  const { rows, cols } = grid
  const r0 = Math.floor(cell / cols)
  const c0 = cell - r0 * cols
  const ok = (i: number) => fuel[i] !== FUEL.NONE && firebreak[i] === 0 && FIRE_MODEL.fuels[fuel[i] as keyof typeof FIRE_MODEL.fuels]?.model !== SPREAD_MODEL.NONE
  let best = -1
  let bestD = Infinity
  for (let rad = 0; rad <= maxRadiusCells; rad++) {
    for (let r = r0 - rad; r <= r0 + rad; r++) {
      if (r < 0 || r >= rows) continue
      for (let c = c0 - rad; c <= c0 + rad; c++) {
        if (c < 0 || c >= cols) continue
        if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== rad) continue
        const i = r * cols + c
        const d = (r - r0) ** 2 + (c - c0) ** 2
        if (ok(i) && d < bestD) {
          best = i
          bestD = d
        }
      }
    }
    if (best >= 0) return best
  }
  return -1
}
