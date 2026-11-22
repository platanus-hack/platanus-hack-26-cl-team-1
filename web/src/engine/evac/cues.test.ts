// Environmental-cue (spontaneous) evacuation: the min filter, the cue response and the riskByAlert curve.
import { describe, expect, it } from 'vitest'
import { FUEL, ROAD, type EvacParams, type GridMeta, type RoadClass, type RoadsFile } from '../types'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from './index'
import { minFilterOctagon, octagonWindow, type OctagonWindow } from './minfilter'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

/** A small synthetic city (deterministic): sea to the west, dense housing, an interface with shrub gullies,
 *  wildland to the east, a 100 m street lattice, 3,000 buildings and a fire running in from the east. */
function testCity() {
  const rand = rng(2024)
  const CELL = 50
  const ROWS = 100
  const COLS = 140
  const grid: GridMeta = {
    rows: ROWS,
    cols: COLS,
    latMax: -33,
    lonMin: -71.6,
    dLat: CELL / 111320,
    dLon: CELL / (111320 * Math.cos((33 * Math.PI) / 180)),
    cellM: CELL,
    t0: '2024-02-02T12:00:00-03:00',
    sources: {},
  }
  const lonOf = (x: number) => grid.lonMin + (x / CELL) * grid.dLon
  const latOf = (y: number) => grid.latMax - (y / CELL) * grid.dLat
  const fuel = new Uint8Array(ROWS * COLS)
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const x = (c + 0.5) * CELL
      const y = (r + 0.5) * CELL
      let f: number
      if (x < 300) f = FUEL.NONE
      else if (x < 4000) f = FUEL.URBAN_DENSE
      else if (x < 5000) f = y % 1200 < 150 ? FUEL.SHRUB : FUEL.URBAN_LOW
      else f = [FUEL.FOREST, FUEL.SHRUB, FUEL.GRASS][(r * 7 + c) % 3]
      fuel[r * COLS + c] = f
    }
  const SP = 100
  const NX = 62
  const NY = 49
  const nodes: [number, number][] = []
  const nx: number[] = []
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const x = 350 + i * SP + (rand() - 0.5) * 20
      const y = 100 + j * SP + (rand() - 0.5) * 20
      nx.push(x)
      nodes.push([lonOf(x), latOf(y)])
    }
  const edges: [number, number, number, RoadClass][] = []
  const cls = (k: number, x: number): RoadClass =>
    x > 5000 && rand() < 0.3 ? ROAD.PATH : k % 12 === 0 ? ROAD.PRIMARY : k % 4 === 0 ? ROAD.TERTIARY : ROAD.LOCAL
  for (let j = 0; j < NY; j++)
    for (let i = 0; i < NX; i++) {
      const a = j * NX + i
      if (i + 1 < NX && rand() > 0.1) edges.push([a, a + 1, SP, cls(j, nx[a])])
      if (j + 1 < NY && rand() > 0.1) edges.push([a, a + NX, SP, cls(i, nx[a])])
    }
  const roads: RoadsFile = { nodes, edges }
  const NB = 3000
  const buildings = new Float32Array(NB * 3)
  for (let b = 0; b < NB; b++) {
    let n: number
    do n = Math.floor(rand() * nodes.length)
    while (nx[n] > 5500)
    buildings[3 * b] = nodes[n][0] + (rand() - 0.5) * 60 * (grid.dLon / CELL)
    buildings[3 * b + 1] = nodes[n][1] + (rand() - 0.5) * 60 * (grid.dLat / CELL)
    buildings[3 * b + 2] = 100
  }
  // Fire: ignition at (6.5 km, 2.5 km) at t = 30 min, faster with the wind (westwards), noisy, stops at 2 km.
  const arrival = new Float32Array(ROWS * COLS).fill(Infinity)
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c
      const x = (c + 0.5) * CELL
      const y = (r + 0.5) * CELL
      if (fuel[i] === FUEL.NONE || x < 2000 || rand() < 0.03) continue
      const slow = fuel[i] === FUEL.URBAN_DENSE ? 3 : fuel[i] === FUEL.URBAN_LOW ? 1.5 : 1
      arrival[i] = 30 + (Math.hypot((x - 6500) * (x < 6500 ? 0.5 : 2), y - 2500) * slow) / 30 + rand() * 10
    }
  return { grid, fuel, roads, buildings, arrival }
}

const NO_EDITS = { closedEdges: [], addedLinks: [] }

/** Order-dependent float64 checksum of the per-building risk. */
function riskChecksum(risk: Float32Array): number {
  let s = 0
  for (let i = 0; i < risk.length; i++) s += risk[i] * ((i % 97) + 1)
  return s
}

/** The window's offsets [dy, dx], enumerated as the Minkowski sum it is defined as (bitmap of side
 *  2E + 1, E = a + 2d). */
function windowBitmap({ a, d }: OctagonWindow): { E: number; has: (dy: number, dx: number) => boolean; offsets: [number, number][] } {
  const E = a + 2 * d
  const W = 2 * E + 1
  const bm = new Uint8Array(W * W)
  for (let t = -d; t <= d; t++)
    for (let s = -d; s <= d; s++)
      for (let i = -a; i <= a; i++) {
        const row = (i + t + s + E) * W + E + t - s
        for (let j = -a; j <= a; j++) bm[row + j] = 1
      }
  const offsets: [number, number][] = []
  for (let y = -E; y <= E; y++) for (let x = -E; x <= E; x++) if (bm[(y + E) * W + x + E]) offsets.push([y, x])
  const has = (dy: number, dx: number) => Math.abs(dy) <= E && Math.abs(dx) <= E && bm[(dy + E) * W + dx + E] === 1
  return { E, has, offsets }
}

describe('minFilterOctagon', () => {
  it('matches the brute-force min over the window on random grids', () => {
    const rand = rng(99)
    for (let trial = 0; trial < 60; trial++) {
      const rows = 1 + Math.floor(rand() * 30)
      const cols = 1 + Math.floor(rand() * 30)
      const src = new Float32Array(rows * cols)
      for (let i = 0; i < src.length; i++) src[i] = rand() < 0.4 ? Infinity : Math.fround(rand() * 500)
      const win: OctagonWindow =
        trial % 3 === 0 ? octagonWindow(rand() * 12) : { a: Math.floor(rand() * 5), d: Math.floor(rand() * 4) }
      const got = minFilterOctagon(src, rows, cols, win)
      const offs = windowBitmap(win).offsets
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          let m = Infinity
          for (const [dy, dx] of offs) {
            const rr = r + dy
            const cc = c + dx
            if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && src[rr * cols + cc] < m) m = src[rr * cols + cc]
          }
          expect(got[r * cols + c]).toBe(m)
        }
    }
  })

  it('uses an approximately circular window: every cell within R, none beyond 1.17 R (1.11 R from 10 cells)', () => {
    for (let R = 4; R <= 60; R++) {
      const { E, has } = windowBitmap(octagonWindow(R))
      const bound = (R < 10 ? 1.17 : 1.11) * R
      let missing = 0
      let beyond = 0
      for (let y = -E - 2; y <= E + 2; y++)
        for (let x = -E - 2; x <= E + 2; x++) {
          const h = Math.hypot(x, y)
          if (h <= R && !has(y, x)) missing++
          if (h > bound && has(y, x)) beyond++
        }
      expect([R, missing, beyond]).toEqual([R, 0, 0])
    }
    expect(octagonWindow(2.4)).toEqual({ a: 2, d: 0 })
    expect(octagonWindow(0)).toEqual({ a: 0, d: 0 })
    expect(() => octagonWindow(NaN)).toThrow()
  })
})

// The 5 x 30 grid of 100 m cells of evac.test.ts, reduced to the main street: shrub on columns 0..9, a
// street on row 2 with nodes at columns 2, 6, ..., 26 (safe zone from column 17). One house on node 0.
function streetCase() {
  const ROWS = 5
  const COLS = 30
  const grid: GridMeta = {
    rows: ROWS,
    cols: COLS,
    latMax: -33,
    lonMin: -71.6,
    dLat: 0.001,
    dLon: 0.001,
    cellM: 100,
    t0: '2024-02-02T12:00:00-03:00',
    sources: {},
  }
  const lonOf = (c: number) => grid.lonMin + (c + 0.5) * grid.dLon
  const latOf = (r: number) => grid.latMax - (r + 0.5) * grid.dLat
  const fuel = new Uint8Array(ROWS * COLS)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) fuel[r * COLS + c] = c < 10 ? FUEL.SHRUB : FUEL.URBAN_LOW
  const cols = [2, 6, 10, 14, 18, 22, 26]
  const roads: RoadsFile = {
    nodes: cols.map((c) => [lonOf(c), latOf(2)] as [number, number]),
    edges: cols.slice(1).map((_, i) => [i, i + 1, 400, ROAD.LOCAL] as [number, number, number, RoadClass]),
  }
  const house = new Float32Array([lonOf(2), latOf(2), 100])
  const prepared = prepareEvac(grid, fuel, roads, house, { safeDistanceM: 800 })
  // The fire starts in the hills at cell (0, 0), 283 m from the house, at t = 10 and reaches the house
  // (and the street next to it) at t = 100.
  const arrival = new Float32Array(ROWS * COLS).fill(Infinity)
  arrival[0] = 10
  arrival[2 * COLS + 2] = 100
  return { prepared, arrival, COLS }
}

const params = (p: Partial<EvacParams>): EvacParams => ({ ...DEFAULT_EVAC_PARAMS, ...p })

describe('environmental cues', () => {
  it('a household near an early fire gets out even with a late alert', () => {
    const { prepared, arrival } = streetCase()
    const run = (p: Partial<EvacParams>) => simulateEvac({ prepared, arrivalMin: arrival, params: params({ footShare: 1, alertMin: 200, ...p }), edits: NO_EDITS })
    // Alert only: the house burns at 100, long before the 200 alert.
    const alertOnly = run({ cueShare: 0 })
    expect(alertOnly.householdRisk[0]).toBe(1)
    expect(alertOnly.buildingsCuedBeforeAlert).toBe(0)
    // Everyone responds to cues: starts at 10, must leave by ~90 (prep median 10 min): out.
    const all = run({ cueShare: 1, cueRadiusM: 900 })
    expect(all.householdRisk[0]).toBeLessThan(0.001)
    expect(all.buildingsCuedBeforeAlert).toBe(1)
    // 65 % respond: risk is the 35 % that wait for the alert.
    const most = run({ cueShare: 0.65, cueRadiusM: 900 })
    expect(most.householdRisk[0]).toBeCloseTo(0.35, 3)
    // A fire beyond the cue radius is not a cue (100 m: the house's cell and its 8 neighbours).
    const near = run({ cueShare: 1, cueRadiusM: 100 })
    expect(near.householdRisk[0]).toBe(1)
    // The cue never delays anyone: with an alert before the cue, cues change nothing.
    const early = run({ alertMin: 5, cueShare: 1, cueRadiusM: 900 })
    const earlyNoCue = run({ alertMin: 5, cueShare: 0 })
    expect(early.householdRisk[0]).toBe(earlyNoCue.householdRisk[0])
    expect(early.buildingsCuedBeforeAlert).toBe(0)
  })

  it('cueShare 0 (or cueRadiusM 0) reproduces the pre-cue engine exactly', () => {
    // Expected values: the engine before cues existed, on this city with alertMin 150 (captured once).
    const expected = {
      trapped: 936.842696850956,
      checksum: 45691.66060560868,
      counts: [935, 1107, 24, 934],
      flow: 60226.5,
      reached: 1977,
      curve: [
        0.67195897063948, 1.8432149975767516, 5.729432841128073, 20.48309530679103, 72.38323843770286, 159.66024594336818,
        267.5409767410149, 395.83571482234265, 529.0677097789471, 625.916539884156, 704.3535071837421, 771.748851412211,
        828.6828400233003, 890.2788352840148, 917.0055085202932, 936.8486103272039, 963.1648539036094, 1001.7208728667366,
        1050.1784297790555, 1117.0950013283912, 1192.5748910020689, 1272.4949699390952, 1351.682913948864, 1436.9760371286704,
        1542.3383169928854, 1631.8114929752928, 1709.3724486743358, 1783.4361621705589, 1857.9054631786794, 1915.3658315041596,
        1967.548765885971, 2008.4920264511115, 2033.6269240169697, 2050.265278046745, 2060.802852998331, 2063.814553984566, 2065,
        2065, 2065, 2065, 2065, 2065, 2065,
      ],
    }
    const city = testCity()
    const prepared = prepareEvac(city.grid, city.fuel, city.roads, city.buildings, { safeDistanceM: 800 })
    for (const cue of [{ cueShare: 0, cueRadiusM: 900 }, { cueShare: 0.65, cueRadiusM: 0 }]) {
      const r = simulateEvac({ prepared, arrivalMin: city.arrival, params: params({ alertMin: 150, ...cue }), edits: NO_EDITS })
      const counts = [0, 0, 0, 0]
      for (const s of r.householdStatus) counts[s]++
      let flow = 0
      for (const f of r.edgeFlow) flow += f
      expect(r.expectedTrappedHouseholds).toBe(expected.trapped)
      expect(riskChecksum(r.householdRisk)).toBe(expected.checksum)
      expect(counts).toEqual(expected.counts)
      expect(flow).toBe(expected.flow)
      expect(r.buildingsReached).toBe(expected.reached)
      expect(r.riskByAlert.map((p) => p.expectedTrappedHouseholds)).toEqual(expected.curve)
      expect(r.buildingsCuedBeforeAlert).toBe(0)
    }
  })

  it('riskByAlert with cues is non-decreasing, never above the alert-only curve, and agrees with full runs', () => {
    const city = testCity()
    const prepared = prepareEvac(city.grid, city.fuel, city.roads, city.buildings, { safeDistanceM: 800 })
    const run = (p: Partial<EvacParams>) => simulateEvac({ prepared, arrivalMin: city.arrival, params: params(p), edits: NO_EDITS })
    for (const cue of [
      { cueShare: 0.65, cueRadiusM: 900 },
      { cueShare: 1, cueRadiusM: 400 },
      { cueShare: 0.3, cueRadiusM: 2500, footShare: 0, prepMedianMin: 25 },
    ]) {
      const r = run({ alertMin: 150, ...cue })
      const curve = r.riskByAlert
      const base = run({ alertMin: 150, ...cue, cueShare: 0 }).riskByAlert
      expect(curve.length).toBe(base.length)
      for (let i = 1; i < curve.length; i++)
        expect(curve[i].expectedTrappedHouseholds).toBeGreaterThanOrEqual(curve[i - 1].expectedTrappedHouseholds - 1e-9)
      for (let i = 0; i < curve.length; i++)
        expect(curve[i].expectedTrappedHouseholds).toBeLessThanOrEqual(base[i].expectedTrappedHouseholds + 1e-9)
      // Cues lower the late-alert end of the curve (the fire is seen long before a midnight alert).
      expect(curve[curve.length - 1].expectedTrappedHouseholds).toBeLessThan(0.9 * base[base.length - 1].expectedTrappedHouseholds)
      for (const alertMin of [0, 60, 150, 240, 330, 420]) {
        const full = run({ alertMin, ...cue }).expectedTrappedHouseholds
        const point = curve.find((p) => p.alertMin === alertMin)!.expectedTrappedHouseholds
        expect(Math.abs(point - full)).toBeLessThan(0.002 * Math.max(10, full))
      }
    }
  })

  it('throws on invalid cue parameters', () => {
    const { prepared, arrival } = streetCase()
    const ok = { prepared, arrivalMin: arrival, edits: NO_EDITS }
    expect(() => simulateEvac({ ...ok, params: params({ cueShare: 1.5 }) })).toThrow(/cueShare/)
    expect(() => simulateEvac({ ...ok, params: params({ cueShare: NaN }) })).toThrow(/cueShare/)
    expect(() => simulateEvac({ ...ok, params: params({ cueRadiusM: -1 }) })).toThrow(/cueRadiusM/)
    expect(() => simulateEvac({ ...ok, params: params({ cueRadiusM: Infinity }) })).toThrow(/cueRadiusM/)
    const neg = arrival.slice()
    neg[5] = -Infinity
    expect(() => simulateEvac({ ...ok, arrivalMin: neg, params: params({}) })).toThrow(/-Infinity/)
  })
})
