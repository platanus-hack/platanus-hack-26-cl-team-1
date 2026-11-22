import { describe, expect, it } from 'vitest'
import { FUEL, HOUSEHOLD, ROAD, type EvacEdits, type EvacParams, type GridMeta, type RoadClass, type RoadsFile } from '../types'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from './index'
import { lognormalCdf, makeLognormalCdf, normalCdf } from './lognormal'
import type { Prepared } from './prepare'

// A 5 x 30 grid of 100 m cells. Columns 0..9 are shrubland (the hills), the rest is urban: a node is a
// safe-zone candidate (>= 800 m from wildland) from column 17 on.
// Main street on row 2: nodes 0..6 at columns 2, 6, 10, 14, 18, 22, 26 (edges 0..5, 400 m each).
// Optional detour on row 4: node 7 (col 6) and node 8 (col 10), spurs 1-7 and 2-8, and 7-8.
// The fire burns column 8, rows 0..2, at t = 60 min: it cuts edge 1-2 (closes at 60 - 5 = 55) but not
// the row-4 detour.
const ROWS = 5
const COLS = 30
const CELL = 100
const grid: GridMeta = {
  rows: ROWS,
  cols: COLS,
  latMax: -33,
  lonMin: -71.6,
  dLat: 0.001,
  dLon: 0.001,
  cellM: CELL,
  t0: '2024-02-02T12:00:00-03:00',
  sources: {},
}
const lonOf = (c: number) => grid.lonMin + (c + 0.5) * grid.dLon
const latOf = (r: number) => grid.latMax - (r + 0.5) * grid.dLat

const fuel = new Uint8Array(ROWS * COLS)
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) fuel[r * COLS + c] = c < 10 ? FUEL.SHRUB : FUEL.URBAN_LOW

const MAIN_COLS = [2, 6, 10, 14, 18, 22, 26]

function makeRoads(opts: { detour?: 'none' | 'spurs' | 'full'; pathEdge?: number; detourCls?: RoadClass } = {}): RoadsFile {
  const nodes: [number, number][] = MAIN_COLS.map((c) => [lonOf(c), latOf(2)])
  const edges: [number, number, number, RoadClass][] = []
  for (let i = 0; i < MAIN_COLS.length - 1; i++)
    edges.push([i, i + 1, 400, i === opts.pathEdge ? ROAD.PATH : ROAD.LOCAL])
  const detour = opts.detour ?? 'none'
  if (detour !== 'none') {
    nodes.push([lonOf(6), latOf(4)], [lonOf(10), latOf(4)]) // nodes 7, 8
    edges.push([1, 7, 200, ROAD.LOCAL], [2, 8, 200, ROAD.LOCAL]) // edges 6, 7
    if (detour === 'full') edges.push([7, 8, 400, opts.detourCls ?? ROAD.LOCAL]) // edge 8
  }
  return { nodes, edges }
}

function fireAt60(): Float32Array {
  const a = new Float32Array(ROWS * COLS).fill(Infinity)
  for (let r = 0; r <= 2; r++) a[r * COLS + 8] = 60
  return a
}

/** One building exactly on node 0 (col 2, row 2). */
const oneHouse = new Float32Array([lonOf(2), latOf(2), 100])

const params = (p: Partial<EvacParams> = {}): EvacParams => ({ ...DEFAULT_EVAC_PARAMS, ...p })
const noEdits: EvacEdits = { closedEdges: [], addedLinks: [] }

function run(roads: RoadsFile, p: Partial<EvacParams>, edits: EvacEdits = noEdits, arrival = fireAt60()) {
  const prepared = prepareEvac(grid, fuel, roads, oneHouse, { safeDistanceM: 800 })
  return simulateEvac({ prepared, arrivalMin: arrival, params: params(p), edits })
}

describe('lognormal', () => {
  it('matches known normal quantiles and the median', () => {
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6)
    expect(normalCdf(-1)).toBeCloseTo(0.158655, 6)
    expect(lognormalCdf(10, 10, 0.6)).toBeCloseTo(0.5, 7)
    expect(lognormalCdf(0, 10, 0.6)).toBe(0)
    expect(lognormalCdf(-Infinity, 10, 0.6)).toBe(0)
    expect(lognormalCdf(Infinity, 10, 0.6)).toBe(1)
    expect(() => lognormalCdf(NaN, 10, 0.6)).toThrow()
  })

  it('reaches exactly 1 in the far tail and is monotone', () => {
    for (const [m, sg] of [
      [10, 0.6],
      [3, 1.5],
      [45, 0.2],
    ]) {
      const f = makeLognormalCdf(m, sg)
      let prev = 0
      for (let x = -5; x < 5000; x += 0.37) {
        const v = f(x)
        expect(v).toBeGreaterThanOrEqual(prev)
        prev = v
      }
      expect(f(m * Math.exp(8.29 * sg))).toBeCloseTo(1, 15)
      expect(f(Infinity)).toBe(1)
      expect(f(-Infinity)).toBe(0)
    }
  })
})

describe('prepareEvac', () => {
  it('computes wildland distance, snapping and edge cells', () => {
    const off = new Float32Array([lonOf(14) + 0.3 * grid.dLon, latOf(2), 50]) // 30 m east of node 3
    const P = prepareEvac(grid, fuel, makeRoads(), off, { safeDistanceM: 800 }) as Prepared
    expect(P.nodeCount).toBe(7)
    expect(P.edgeCount).toBe(6)
    expect(P.nodeWildM[4]).toBeCloseTo(900, 3) // col 18, nearest shrub at col 9
    expect(P.nodeWildM[0]).toBe(0)
    expect(P.candidateSafeNodes).toBe(3) // nodes 4, 5, 6
    expect(P.bldNode[0]).toBe(3)
    // buildings.bin is Float32: lon -71.6 has ~1e-5 deg resolution, i.e. under a metre here
    expect(Math.abs(P.bldAccessM[0] - 30)).toBeLessThan(1)
    // edge 1-2 runs along row 2 from col 6 to col 10
    const cells = Array.from(P.edgeCells.subarray(P.edgeCellStart[1], P.edgeCellStart[2]))
    expect(cells).toEqual([2 * COLS + 6, 2 * COLS + 7, 2 * COLS + 8, 2 * COLS + 9, 2 * COLS + 10])
  })

  it('car households start from the nearest drivable node, not a closer footway node', () => {
    // House at row 3, col 2 (100 m south of node 0); a footway node 30 m from it, linked to node 0.
    const roads = makeRoads()
    roads.nodes.push([lonOf(2) + 0.3 * grid.dLon, latOf(3)]) // node 7
    roads.edges.push([7, 0, 100, ROAD.PATH])
    const house = new Float32Array([lonOf(2), latOf(3), 80])
    const P = prepareEvac(grid, fuel, roads, house, { safeDistanceM: 800 }) as Prepared
    expect(P.bldNode[0]).toBe(7)
    expect(P.bldCarNode[0]).toBe(0)
    expect(Math.abs(P.bldCarAccessM[0] - 100)).toBeLessThan(1)
    const r = simulateEvac({ prepared: P, arrivalMin: fireAt60(), params: params({ footShare: 0, alertMin: 0 }), edits: noEdits })
    expect(r.carHouseholdsWalking).toBe(0)
    expect(r.edgeFlow[6]).toBe(0) // the footway (edge 6) is not driven
    expect(r.edgeFlow[0]).toBe(1)
  })

  it('throws on malformed input', () => {
    const roads = makeRoads()
    const bad1: RoadsFile = { ...roads, edges: [...roads.edges, [0, 99, 10, ROAD.LOCAL]] }
    expect(() => prepareEvac(grid, fuel, bad1, oneHouse, { safeDistanceM: 800 })).toThrow(/out of range/)
    const bad2: RoadsFile = { ...roads, nodes: [[NaN, latOf(2)], ...roads.nodes.slice(1)] }
    expect(() => prepareEvac(grid, fuel, bad2, oneHouse, { safeDistanceM: 800 })).toThrow(/non-finite/)
    expect(() => prepareEvac(grid, fuel, roads, new Float32Array(4), { safeDistanceM: 800 })).toThrow(/multiple of 3/)
    expect(() => prepareEvac(grid, new Uint8Array(3), roads, oneHouse, { safeDistanceM: 800 })).toThrow(/fuel/)
    const bad3: RoadsFile = { ...roads, edges: [[0, 1, 400, 9 as RoadClass]] }
    expect(() => prepareEvac(grid, fuel, bad3, oneHouse, { safeDistanceM: 800 })).toThrow(/ROAD class/)
  })
})

describe('simulateEvac', () => {
  it('fire cutting the only road traps a slow household; an earlier alert gets it out', () => {
    // On foot: leave node 0 by 55 - 2 * 400 m / 75 m/min = 44.3 min.
    const late = run(makeRoads(), { footShare: 1, alertMin: 40 })
    expect(late.householdRisk[0]).toBeGreaterThan(0.85)
    expect(late.householdStatus[0]).toBe(HOUSEHOLD.TRAPPED)
    expect(late.edgeClosesMin[1]).toBeCloseTo(55, 5)
    expect(late.edgeClosesMin[0]).toBe(Infinity)
    expect(late.expectedTrappedPeople).toBeCloseTo(late.expectedTrappedHouseholds * 2.9, 5)
    const early = run(makeRoads(), { footShare: 1, alertMin: 0 })
    expect(early.householdRisk[0]).toBeLessThan(0.02)
    expect(early.householdStatus[0]).toBe(HOUSEHOLD.SAFE)
  })

  it('routes flow along the next-hop chain to the first safe node', () => {
    const r = run(makeRoads(), { footShare: 1, alertMin: 0 })
    expect(Array.from(r.edgeFlow)).toEqual([1, 1, 1, 1, 0, 0])
    const mixed = run(makeRoads(), { footShare: 0.25, alertMin: 0 }) // 0.25 on foot + 0.75 by car, same route
    expect(Array.from(mixed.edgeFlow)).toEqual([1, 1, 1, 1, 0, 0])
  })

  it('an emergency link that bypasses the fire lowers the risk', () => {
    const roads = makeRoads({ detour: 'spurs' })
    const before = run(roads, { footShare: 1, alertMin: 40 })
    expect(before.householdRisk[0]).toBeGreaterThan(0.85)
    const after = run(roads, { footShare: 1, alertMin: 40 }, { closedEdges: [], addedLinks: [{ u: 7, v: 8 }] })
    expect(after.householdRisk[0]).toBe(0)
    expect(after.householdStatus[0]).toBe(HOUSEHOLD.UNAFFECTED)
    expect(after.addedLinkFlow[0]).toBe(0) // unaffected households are not routed
    expect(after.addedLinkClosesMin[0]).toBe(Infinity)
    // Partial bypass with a threatened household: its flow goes over the link.
    const threatened = new Float32Array(ROWS * COLS).fill(Infinity)
    threatened[2 * COLS + 8] = 60
    threatened[2 * COLS + 2] = 120 // the house itself burns at 120
    const prepared = prepareEvac(grid, fuel, roads, oneHouse, { safeDistanceM: 800 })
    const res = simulateEvac({
      prepared,
      arrivalMin: threatened,
      params: params({ footShare: 1, alertMin: 40 }),
      edits: { closedEdges: [], addedLinks: [{ u: 7, v: 8 }] },
    })
    expect(res.householdStatus[0]).toBe(HOUSEHOLD.SAFE)
    expect(res.addedLinkFlow[0]).toBe(1)
  })

  it('closing a road raises the risk', () => {
    const roads = makeRoads({ detour: 'full' })
    const open = run(roads, { footShare: 1, alertMin: 40 })
    expect(open.householdRisk[0]).toBe(0)
    const closed = run(roads, { footShare: 1, alertMin: 40 }, { closedEdges: [8], addedLinks: [] })
    expect(closed.householdRisk[0]).toBeGreaterThan(0.85)
    expect(closed.edgeClosesMin[8]).toBe(-Infinity)
  })

  it('foot-only PATH edges are unusable by car', () => {
    // The row-4 detour around the fire is a footpath (edge 8): on foot the house is never cut off, by car
    // the only way is edge 1-2 (closes at 55; leave node 0 by 55 - 2 x 400 m at 20 km/h = 52.6).
    const roads = makeRoads({ detour: 'full', detourCls: ROAD.PATH })
    const byFoot = run(roads, { footShare: 1, alertMin: 50 })
    expect(byFoot.householdRisk[0]).toBe(0)
    const byCar = run(roads, { footShare: 0, alertMin: 50 })
    expect(byCar.householdRisk[0]).toBeGreaterThan(0.9)
    expect(byCar.edgeFlow[8]).toBe(0)
    expect(byCar.edgeFlow[1]).toBe(1)
    expect(byCar.carHouseholdsWalking).toBe(0)
    const control = run(makeRoads({ detour: 'full' }), { footShare: 0, alertMin: 50 })
    expect(control.householdRisk[0]).toBe(0)
  })

  it('car households on a street with no drivable way out walk', () => {
    // 3-4 is a footpath: cars at node 0 cannot reach any node far from the hills, so they walk.
    const roads = makeRoads({ pathEdge: 3 })
    const byCar = run(roads, { footShare: 0, alertMin: 0 })
    const byFoot = run(roads, { footShare: 1, alertMin: 0 })
    expect(byCar.carHouseholdsWalking).toBe(1)
    expect(byCar.householdRisk[0]).toBeCloseTo(byFoot.householdRisk[0], 6)
    expect(Array.from(byCar.edgeFlow)).toEqual([1, 1, 1, 1, 0, 0])
  })

  it('riskByAlert is non-decreasing and agrees with a run at that alert time', () => {
    const r = run(makeRoads(), { footShare: 0.5, alertMin: 40 })
    const curve = r.riskByAlert
    expect(curve[0].alertMin).toBe(0)
    expect(curve[curve.length - 1].alertMin).toBe(60) // horizon: max arrival 60 rounded up to the hour
    for (let i = 1; i < curve.length; i++)
      expect(curve[i].expectedTrappedHouseholds).toBeGreaterThanOrEqual(curve[i - 1].expectedTrappedHouseholds)
    const at40 = curve.find((p) => p.alertMin === 40)!
    expect(at40.expectedTrappedHouseholds).toBeCloseTo(r.expectedTrappedHouseholds, 2)
  })

  it('no fire: everyone is unaffected', () => {
    const r = run(makeRoads(), {}, noEdits, new Float32Array(ROWS * COLS).fill(Infinity))
    expect(r.householdStatus[0]).toBe(HOUSEHOLD.UNAFFECTED)
    expect(r.expectedTrappedHouseholds).toBe(0)
    expect(r.buildingsReached).toBe(0)
    expect(r.riskByAlert).toEqual([{ alertMin: 0, expectedTrappedHouseholds: 0 }])
  })

  it('a fire-free pocket cut off by the user is not trapped', () => {
    // House on node 8; closing its only street (2-8, edge 7) leaves it alone, far from the fire.
    const roads = makeRoads({ detour: 'spurs' })
    const house = new Float32Array([lonOf(10), latOf(4), 80])
    const prepared = prepareEvac(grid, fuel, roads, house, { safeDistanceM: 800 })
    const r = simulateEvac({ prepared, arrivalMin: fireAt60(), params: params(), edits: { closedEdges: [7], addedLinks: [] } })
    expect(r.householdStatus[0]).toBe(HOUSEHOLD.UNAFFECTED)
    expect(r.householdRisk[0]).toBe(0)
  })

  it('buildings attach to the network with a way out, not to disconnected fragments', () => {
    // Nodes 7-8 only connect to each other and sit next to the hills (no safe node): a house on node 7
    // snaps to node 1 (200 m away) on the main street instead.
    const roads = makeRoads()
    roads.nodes.push([lonOf(6), latOf(4)], [lonOf(10), latOf(4)])
    roads.edges.push([7, 8, 400, ROAD.LOCAL])
    const house = new Float32Array([lonOf(6), latOf(4), 80])
    const P = prepareEvac(grid, fuel, roads, house, { safeDistanceM: 800 }) as Prepared
    expect(P.bldNode[0]).toBe(1)
    expect(Math.abs(P.bldAccessM[0] - 200)).toBeLessThan(1)
    expect(P.snapNodes).toBe(7)
  })

  it('throws on malformed simulate input', () => {
    const prepared = prepareEvac(grid, fuel, makeRoads(), oneHouse, { safeDistanceM: 800 })
    const ok = { prepared, arrivalMin: fireAt60(), params: params(), edits: noEdits }
    expect(() => simulateEvac({ ...ok, arrivalMin: new Float32Array(3) })).toThrow(/arrivalMin/)
    expect(() => simulateEvac({ ...ok, edits: { closedEdges: [99], addedLinks: [] } })).toThrow(/closed edge/)
    expect(() => simulateEvac({ ...ok, edits: { closedEdges: [], addedLinks: [{ u: 0, v: 50 }] } })).toThrow(/added link/)
    expect(() => simulateEvac({ ...ok, params: params({ footShare: 2 }) })).toThrow(/footShare/)
    expect(() => simulateEvac({ ...ok, prepared: { nodeCount: 1, edgeCount: 0 } })).toThrow(/prepareEvac/)
    expect(() => simulateEvac({ ...ok, params: params({ safeDistanceM: 5000 }) })).toThrow(/no safe destination/)
    const nan = fireAt60()
    nan[0] = NaN
    expect(() => simulateEvac({ ...ok, arrivalMin: nan })).toThrow(/NaN/)
  })
})
