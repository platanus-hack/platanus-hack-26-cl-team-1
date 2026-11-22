import { afterEach, describe, expect, it } from 'vitest'
import { FUEL, type FireInput, type FireParams, type FuelCode, type GridMeta, type WeatherSample } from '../types'
import { DEFAULT_FIRE_PARAMS, FIRE_MODEL, nearestBurnableCell, simulateFire } from './index'
import { eccentricity, flatRosKmh, lengthToBreadth } from './model'

const ANCHOR_DEFAULT = FIRE_MODEL.anchorMaxCells
afterEach(() => {
  FIRE_MODEL.anchorMaxCells = ANCHOR_DEFAULT
})

interface Opts {
  rows: number
  cols: number
  cellM?: number
  fuel?: FuelCode | ((r: number, c: number) => FuelCode)
  elevation?: (r: number, c: number) => number
  firebreak?: (r: number, c: number) => boolean
  weather?: WeatherSample | WeatherSample[]
  ignitions: { r: number; c: number; tMin?: number }[]
  params?: Partial<FireParams>
}

function makeInput(o: Opts): FireInput {
  const cellM = o.cellM ?? 30
  const grid: GridMeta = { rows: o.rows, cols: o.cols, latMax: 0, lonMin: 0, dLat: 1e-4, dLon: 1e-4, cellM, t0: '2024-02-02T12:00:00-03:00', sources: {} }
  const n = o.rows * o.cols
  const fuel = new Uint8Array(n)
  const elevation = new Float32Array(n)
  const firebreak = new Uint8Array(n)
  for (let r = 0; r < o.rows; r++)
    for (let c = 0; c < o.cols; c++) {
      const i = r * o.cols + c
      fuel[i] = typeof o.fuel === 'function' ? o.fuel(r, c) : (o.fuel ?? FUEL.GRASS)
      elevation[i] = o.elevation ? o.elevation(r, c) : 100
      firebreak[i] = o.firebreak?.(r, c) ? 1 : 0
    }
  const samples = Array.isArray(o.weather) ? o.weather : [o.weather ?? { tempC: 30, rh: 30, windKmh: 20, windFromDeg: 270 }]
  return {
    grid,
    elevation,
    fuel,
    firebreak,
    ignitions: o.ignitions.map((g) => ({ cell: g.r * o.cols + g.c, tMin: g.tMin ?? 0 })),
    weather: { t0Min: 0, stepMin: 60, samples },
    params: { ...DEFAULT_FIRE_PARAMS, spotting: false, ...o.params },
  }
}

const at = (inp: FireInput, a: Float32Array, r: number, c: number) => a[r * inp.grid.cols + c]

/** Max projection of burned cells (relative to the ignition) onto a unit direction, metres. */
function reach(inp: FireInput, arr: Float32Array, r0: number, c0: number, ux: number, uy: number): number {
  const { rows, cols, cellM } = inp.grid
  let best = 0
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!Number.isFinite(arr[r * cols + c])) continue
      const p = ((c - c0) * ux + (r0 - r) * uy) * cellM
      if (p > best) best = p
    }
  return best
}

describe('simulateFire on flat grass with constant wind', () => {
  const weather = { tempC: 30, rh: 30, windKmh: 20, windFromDeg: 270 } // blows toward the east
  const rHead = (flatRosKmh(FUEL.GRASS, weather, DEFAULT_FIRE_PARAMS) * 1000) / 60 // m/min
  const lb = lengthToBreadth(20)
  const e = eccentricity(lb)
  const rBack = (rHead * (1 - e)) / (1 + e)
  const cellM = 10
  const tEnd = (150 * cellM) / rHead // head should travel 150 cells

  for (const anchors of [true, false]) {
    it(`gives a downwind ellipse whose head distance is R*t (anchors ${anchors ? 'on' : 'off'})`, () => {
      FIRE_MODEL.anchorMaxCells = anchors ? ANCHOR_DEFAULT : 0
      const inp = makeInput({ rows: 141, cols: 221, cellM, weather, ignitions: [{ r: 70, c: 40 }], params: { horizonMin: tEnd } })
      const res = simulateFire(inp)
      const head = reach(inp, res.arrivalMin, 70, 40, 1, 0)
      const back = reach(inp, res.arrivalMin, 70, 40, -1, 0)
      const north = reach(inp, res.arrivalMin, 70, 40, 0, 1)
      const south = reach(inp, res.arrivalMin, 70, 40, 0, -1)
      expect(Math.abs(head - rHead * tEnd) / (rHead * tEnd)).toBeLessThan(0.02)
      expect(back).toBeLessThan(head / 5)
      expect(Math.abs(back - rBack * tEnd)).toBeLessThanOrEqual(cellM + 0.05 * rBack * tEnd)
      expect(north).toBeCloseTo(south, -1) // symmetric about the wind axis
      // Length-to-breadth of the burned shape ~ Alexander's LB.
      const shapeLb = (head + back) / (north + south)
      expect(Math.abs(shapeLb - lb) / lb).toBeLessThan(anchors ? 0.1 : 0.2)
      // Arrival grows with distance downwind; ROS is reported where it burned and 0 elsewhere.
      expect(at(inp, res.arrivalMin, 70, 100)).toBeGreaterThan(at(inp, res.arrivalMin, 70, 60))
      expect(at(inp, res.rosMPerMin, 70, 60)).toBeCloseTo(rHead, 3)
      expect(at(inp, res.rosMPerMin, 0, 0)).toBe(0)
      expect(at(inp, res.arrivalMin, 0, 0)).toBe(Infinity)
    })
  }

  it('keeps the head speed when the wind blows between stencil directions (any-angle anchors)', () => {
    // Head toward bearing 76.7 deg: halfway between the east move (90) and the knight move (63.4).
    const w = { ...weather, windKmh: 30, windFromDeg: 256.7 }
    const rh = (flatRosKmh(FUEL.GRASS, w, DEFAULT_FIRE_PARAMS) * 1000) / 60
    const t = (100 * cellM) / rh
    const ux = Math.sin(76.7 * (Math.PI / 180))
    const uy = Math.cos(76.7 * (Math.PI / 180))
    const run = (anchorCells: number) => {
      FIRE_MODEL.anchorMaxCells = anchorCells
      const inp = makeInput({ rows: 141, cols: 181, cellM, weather: w, ignitions: [{ r: 110, c: 30 }], params: { horizonMin: t } })
      return reach(inp, simulateFire(inp).arrivalMin, 110, 30, ux, uy) / (rh * t)
    }
    const withAnchors = run(ANCHOR_DEFAULT)
    const plain = run(0)
    expect(withAnchors).toBeGreaterThan(0.9)
    expect(withAnchors).toBeLessThan(1.02)
    expect(plain).toBeLessThan(withAnchors) // the plain 16-neighbour stencil loses speed off its directions
  })
})

describe('simulateFire physics', () => {
  it('spreads faster upslope than downslope, with head ROS x exp(0.069 * slope) in calm air', () => {
    const slopeDeg = 15
    const cellM = 30
    const inp = makeInput({
      rows: 61,
      cols: 61,
      cellM,
      fuel: FUEL.FOREST,
      elevation: (_r, c) => c * cellM * Math.tan(slopeDeg * (Math.PI / 180)), // rises toward the east
      weather: { tempC: 30, rh: 25, windKmh: 0, windFromDeg: 0 },
      ignitions: [{ r: 30, c: 30 }],
      params: { horizonMin: 600 },
    })
    const res = simulateFire(inp)
    expect(at(inp, res.arrivalMin, 30, 40)).toBeLessThan(at(inp, res.arrivalMin, 30, 20))
    const flat = (flatRosKmh(FUEL.FOREST, inp.weather.samples[0], inp.params) * 1000) / 60
    expect(at(inp, res.rosMPerMin, 30, 30) / flat).toBeCloseTo(Math.exp(0.069 * slopeDeg), 2)
  })

  it('combines wind and slope as vectors: a cross-slope wind turns the head upslope', () => {
    // Wind toward the east, slope rising toward the north: the head points north-east, between the two.
    const cellM = 30
    const slopeDeg = 10
    const inp = makeInput({
      rows: 81,
      cols: 81,
      cellM,
      fuel: FUEL.FOREST,
      elevation: (r) => (80 - r) * cellM * Math.tan(slopeDeg * (Math.PI / 180)),
      weather: { tempC: 30, rh: 25, windKmh: 25, windFromDeg: 270 },
      ignitions: [{ r: 60, c: 20 }],
      params: { horizonMin: 240 },
    })
    const res = simulateFire(inp)
    const east = reach(inp, res.arrivalMin, 60, 20, 1, 0)
    const north = reach(inp, res.arrivalMin, 60, 20, 0, 1)
    const us = FIRE_MODEL.slopeWindKmhPerDeg * slopeDeg // ~29.5 km/h upslope (north) vs 25 km/h wind (east)
    const headDeg = (Math.atan2(25, us) * 180) / Math.PI // bearing of W_eff
    const ne = reach(inp, res.arrivalMin, 60, 20, Math.sin((headDeg * Math.PI) / 180), Math.cos((headDeg * Math.PI) / 180))
    expect(ne).toBeGreaterThan(east)
    expect(ne).toBeGreaterThan(north)
    // Head ROS = flat ROS at the 10 m wind x exp(0.0234 (|W_eff| - V)).
    const flat = (flatRosKmh(FUEL.FOREST, inp.weather.samples[0], inp.params) * 1000) / 60
    expect(at(inp, res.rosMPerMin, 60, 20) / flat).toBeCloseTo(Math.exp(0.0234 * (Math.hypot(25, us) - 25)), 2)
  })

  it('spreads slower at higher relative humidity (grass and forest)', () => {
    for (const fuel of [FUEL.GRASS, FUEL.FOREST] as const) {
      const run = (rh: number) => {
        const inp = makeInput({ rows: 81, cols: 81, fuel, weather: { tempC: 30, rh, windKmh: 25, windFromDeg: 225 }, ignitions: [{ r: 60, c: 20 }], params: { horizonMin: 60 } })
        return simulateFire(inp).burnedCells
      }
      expect(run(60)).toBeLessThan(run(20))
    }
  })

  it('never burns NONE cells or firebreak cells', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const fuelGrid: FuelCode[] = []
    for (let i = 0; i < 81 * 81; i++) fuelGrid.push(rand() < 0.2 ? FUEL.NONE : FUEL.SHRUB)
    fuelGrid[40 * 81 + 40] = FUEL.SHRUB
    const inp = makeInput({
      rows: 81,
      cols: 81,
      fuel: (r, c) => fuelGrid[r * 81 + c],
      firebreak: (r, c) => (r + c) % 17 === 0,
      weather: { tempC: 32, rh: 20, windKmh: 30, windFromDeg: 200 },
      ignitions: [{ r: 40, c: 41 }],
      params: { spotting: true, horizonMin: 600 },
    })
    const res = simulateFire(inp)
    let finite = 0
    for (let i = 0; i < inp.fuel.length; i++) {
      if (inp.fuel[i] === FUEL.NONE || inp.firebreak[i]) {
        expect(res.arrivalMin[i]).toBe(Infinity)
        expect(res.rosMPerMin[i]).toBe(0)
      }
      if (Number.isFinite(res.arrivalMin[i])) finite++
    }
    expect(res.burnedCells).toBe(finite)
    expect(res.burnedCells).toBeGreaterThan(500)
  })

  it('stops at the horizon', () => {
    const inp = makeInput({ rows: 101, cols: 101, ignitions: [{ r: 50, c: 50, tMin: 30 }], params: { horizonMin: 90 } })
    const res = simulateFire(inp)
    let max = -Infinity
    for (const t of res.arrivalMin) if (Number.isFinite(t)) max = Math.max(max, t)
    expect(at(inp, res.arrivalMin, 50, 50)).toBe(30)
    expect(max).toBeLessThanOrEqual(90)
    expect(res.burnedCells).toBeGreaterThan(1)
    expect(res.burnedCells).toBeLessThan(101 * 101)
    // An ignition after the horizon burns nothing.
    const late = simulateFire(makeInput({ rows: 11, cols: 11, ignitions: [{ r: 5, c: 5, tMin: 200 }], params: { horizonMin: 90 } }))
    expect(late.burnedCells).toBe(0)
  })

  it('takes the earliest of several ignitions and follows a wind shift', () => {
    // Wind from the west for the first hour, then from the south: the fire turns north.
    const inp = makeInput({
      rows: 121,
      cols: 121,
      weather: [
        { tempC: 30, rh: 30, windKmh: 25, windFromDeg: 270 },
        { tempC: 30, rh: 30, windKmh: 25, windFromDeg: 270 },
        { tempC: 30, rh: 30, windKmh: 25, windFromDeg: 180 },
        { tempC: 30, rh: 30, windKmh: 25, windFromDeg: 180 },
      ],
      ignitions: [
        { r: 100, c: 20, tMin: 10 },
        { r: 100, c: 20, tMin: 0 },
      ],
      params: { horizonMin: 240 },
    })
    const res = simulateFire(inp)
    expect(at(inp, res.arrivalMin, 100, 20)).toBe(0)
    const east = reach(inp, res.arrivalMin, 100, 20, 1, 0)
    const north = reach(inp, res.arrivalMin, 100, 20, 0, 1)
    expect(east).toBeGreaterThan(300)
    expect(north).toBeGreaterThan(300)
  })
})

describe('firebreaks and spotting', () => {
  const base = {
    rows: 61,
    cols: 81,
    cellM: 30,
    fuel: FUEL.FOREST,
    weather: { tempC: 34, rh: 15, windKmh: 45, windFromDeg: 270 },
    ignitions: [{ r: 30, c: 10 }],
    firebreak: (_r: number, c: number) => c === 30 || c === 31, // 2 cells = 60 m wide, full height
  } satisfies Partial<Opts>
  const eastBurned = (inp: FireInput, a: Float32Array) => {
    let k = 0
    for (let r = 0; r < inp.grid.rows; r++) for (let c = 32; c < inp.grid.cols; c++) if (Number.isFinite(at(inp, a, r, c))) k++
    return k
  }

  it('a 2-cell firebreak stops the fire without spotting', () => {
    const inp = makeInput({ ...base, params: { spotting: false, horizonMin: 600 } })
    const res = simulateFire(inp)
    expect(at(inp, res.arrivalMin, 30, 29)).toBeLessThan(Infinity) // reached the break
    expect(eastBurned(inp, res.arrivalMin)).toBe(0)
  })

  it('embers cross a firebreak narrower than D_max in strong wind', () => {
    const inp = makeInput({ ...base, params: { spotting: true, spotMetresPerKmh: 12, horizonMin: 600 } })
    const res = simulateFire(inp)
    expect(eastBurned(inp, res.arrivalMin)).toBeGreaterThan(500)
    // Firebreak cells themselves still never burn.
    for (let r = 0; r < 61; r++) expect(at(inp, res.arrivalMin, r, 30)).toBe(Infinity)
  })

  it('embers ignite intermix housing but not the consolidated city across the break', () => {
    // East of the break: built-up cells only. Intermix (URBAN_LOW) takes ember landings; consolidated
    // (URBAN_DENSE, spotTarget false) does not, so nothing east of the break burns.
    const town = (kind: FuelCode) => (_r: number, c: number) => (c >= 32 ? kind : FUEL.FOREST)
    const params = { spotting: true, spotMetresPerKmh: 12, horizonMin: 600 }
    const intermix = makeInput({ ...base, fuel: town(FUEL.URBAN_LOW), params })
    const consolidated = makeInput({ ...base, fuel: town(FUEL.URBAN_DENSE), params })
    expect(FIRE_MODEL.fuels[FUEL.URBAN_DENSE].spotTarget).toBe(false)
    expect(eastBurned(intermix, simulateFire(intermix).arrivalMin)).toBeGreaterThan(0)
    expect(eastBurned(consolidated, simulateFire(consolidated).arrivalMin)).toBe(0)
  })

  it('no spotting in light wind (< 15 km/h) or across a break wider than D_max', () => {
    const light = makeInput({ ...base, weather: { ...base.weather, windKmh: 12 }, params: { spotting: true, horizonMin: 1200 } })
    expect(eastBurned(light, simulateFire(light).arrivalMin)).toBe(0)
    // D_max = 2 m/(km/h) * 45 km/h = 90 m = 3 cells: cannot clear the break plus the 3-cell minimum jump.
    const wide = makeInput({ ...base, firebreak: (_r, c) => c >= 30 && c <= 33, params: { spotting: true, spotMetresPerKmh: 2, horizonMin: 600 } })
    let k = 0
    const a = simulateFire(wide).arrivalMin
    for (let r = 0; r < 61; r++) for (let c = 34; c < 81; c++) if (Number.isFinite(at(wide, a, r, c))) k++
    expect(k).toBe(0)
  })

  it('a cool, slow fire does not spot even in strong wind (source ROS gate)', () => {
    // Humid evening: forest head ROS stays well under FIRE_MODEL.spotMinSourceRosMPerMin.
    const cool = makeInput({ ...base, weather: { tempC: 15, rh: 85, windKmh: 25, windFromDeg: 270 }, params: { spotting: true, horizonMin: 2000 } })
    const res = simulateFire(cool)
    expect(Math.max(...res.rosMPerMin)).toBeLessThan(FIRE_MODEL.spotMinSourceRosMPerMin)
    expect(at(cool, res.arrivalMin, 30, 29)).toBeLessThan(Infinity)
    expect(eastBurned(cool, res.arrivalMin)).toBe(0)
  })

  it('a 1-cell diagonal (8-connected) firebreak is watertight without spotting', () => {
    const inp = makeInput({
      rows: 61,
      cols: 61,
      fuel: FUEL.GRASS,
      weather: { tempC: 30, rh: 30, windKmh: 30, windFromDeg: 225 },
      firebreak: (r, c) => r === c,
      ignitions: [{ r: 50, c: 10 }], // below the diagonal (r > c)
      params: { horizonMin: 2000 },
    })
    const res = simulateFire(inp)
    let above = 0
    for (let r = 0; r < 61; r++) for (let c = r + 1; c < 61; c++) if (Number.isFinite(at(inp, res.arrivalMin, r, c))) above++
    expect(above).toBe(0)
  })
})

describe('input validation', () => {
  const ok = () => makeInput({ rows: 10, cols: 10, ignitions: [{ r: 5, c: 5 }] })

  it('rejects mismatched arrays, bad codes, bad weather and bad params', () => {
    expect(() => simulateFire({ ...ok(), fuel: new Uint8Array(99) })).toThrow(/fuel has 99 cells/)
    const badFuel = ok()
    badFuel.fuel[3] = 9
    expect(() => simulateFire(badFuel)).toThrow(/unknown fuel code 9/)
    const nanElev = ok()
    nanElev.elevation[2] = NaN
    expect(() => simulateFire(nanElev)).toThrow(/elevation is not finite/)
    expect(() => simulateFire({ ...ok(), weather: { t0Min: 0, stepMin: 60, samples: [] } })).toThrow(/no samples/)
    expect(() => simulateFire({ ...ok(), weather: { t0Min: 0, stepMin: 60, samples: [{ tempC: 30, rh: 130, windKmh: 10, windFromDeg: 0 }] } })).toThrow(/relative humidity/)
    expect(() => simulateFire({ ...ok(), params: { ...DEFAULT_FIRE_PARAMS, droughtFactor: 11 } })).toThrow(/droughtFactor/)
    expect(() => simulateFire({ ...ok(), params: { ...DEFAULT_FIRE_PARAMS, rosMultiplier: 0 } })).toThrow(/rosMultiplier/)
  })

  it('rejects ignitions outside the grid or on unburnable cells', () => {
    expect(() => simulateFire({ ...ok(), ignitions: [{ cell: 100, tMin: 0 }] })).toThrow(/outside the grid/)
    const onNone = ok()
    onNone.fuel[55] = FUEL.NONE
    expect(() => simulateFire(onNone)).toThrow(/sin combustible/)
    const onBreak = ok()
    onBreak.firebreak[55] = 1
    expect(() => simulateFire(onBreak)).toThrow(/cortafuego/)
  })

  it('nearestBurnableCell snaps to the closest cell with fuel', () => {
    const inp = ok()
    inp.fuel[55] = FUEL.NONE
    inp.firebreak[56] = 1
    const j = nearestBurnableCell(inp.grid, inp.fuel, inp.firebreak, 55, 3)
    expect([45, 54, 65]).toContain(j)
    expect(nearestBurnableCell(inp.grid, inp.fuel, inp.firebreak, 44, 3)).toBe(44)
    expect(nearestBurnableCell(inp.grid, new Uint8Array(100), inp.firebreak, 55, 3)).toBe(-1)
  })
})
