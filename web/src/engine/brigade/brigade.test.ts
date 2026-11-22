import { describe, expect, it } from 'vitest'
import { buildCsr, prepareEvac } from '../evac/prepare'
import type { BrigadesFile, GridMeta, RoadClass, RoadsFile } from '../types'
import { FUEL, HOUSEHOLD, ROAD, UNIT } from '../types'
import { applyRescue, earliestArrival, planBrigades, type BrigadeSettings, type RouteGraph } from './index'
import { FIREFIGHT_MODEL } from './model'

const KMH = [60, 40, 35, 30, 20, 0]

function graph(edges: [number, number, number, RoadClass][], n: number): RouteGraph {
  const us = Int32Array.from(edges.map((e) => e[0]))
  const vs = Int32Array.from(edges.map((e) => e[1]))
  return { nodeCount: n, edgeU: us, edgeV: vs, edgeLenM: Float64Array.from(edges.map((e) => e[2])), edgeCls: Uint8Array.from(edges.map((e) => e[3])), adj: buildCsr(n, us, vs) }
}

describe('earliestArrival', () => {
  // 0 -1000m- 1 -1000m- 3 ; 0 -2000m- 2 -2000m- 3, all LOCAL (20 km/h = 333 m/min)
  const g = graph(
    [
      [0, 1, 1000, ROAD.LOCAL],
      [1, 3, 1000, ROAD.LOCAL],
      [0, 2, 2000, ROAD.LOCAL],
      [2, 3, 2000, ROAD.LOCAL],
    ],
    4,
  )
  const open = new Float64Array(4).fill(Infinity)
  it('takes the short way when everything is open', () => {
    expect(earliestArrival(g, [{ node: 0, tMin: 0 }], open, [], KMH).time[3]).toBeCloseTo(6, 6)
  })
  it('routes around an edge the fire closes before the truck gets through', () => {
    const closes = open.slice()
    closes[1] = 4 // the truck would leave edge 1 at minute 6
    const r = earliestArrival(g, [{ node: 0, tMin: 0 }], closes, [], KMH)
    expect(r.time[3]).toBeCloseTo(12, 6)
    expect(r.pred[3]).toBe(3)
  })
  it('does not wait: a node behind the only, already closed edge is unreachable', () => {
    const closes = open.slice()
    closes[0] = 1
    closes[2] = 1
    expect(earliestArrival(g, [{ node: 0, tMin: 0 }], closes, [], KMH).time[3]).toBe(Infinity)
  })
  it('a historical cut blocks an edge only while it is in force', () => {
    const cuts = [
      { edge: 1, fromMin: 100, toMin: Infinity },
      { edge: 3, fromMin: 100, toMin: Infinity },
    ]
    expect(earliestArrival(g, [{ node: 0, tMin: 0 }], open, cuts, KMH).time[3]).toBeCloseTo(6, 6)
    expect(earliestArrival(g, [{ node: 0, tMin: 200 }], open, cuts, KMH).time[3]).toBe(Infinity)
    expect(earliestArrival(g, [{ node: 0, tMin: 200 }], open, [], KMH).time[3]).toBeCloseTo(206, 6)
  })
  it('never uses foot paths', () => {
    const p = graph([[0, 1, 100, ROAD.PATH]], 2)
    expect(earliestArrival(p, [{ node: 0, tMin: 0 }], new Float64Array(1).fill(Infinity), [], KMH).time[1]).toBe(Infinity)
  })
})

// A 30 x 30 grid of 60 m cells: grass west of column 10, built-up columns 10-19 with a green strip in column 14,
// nothing to burn from column 20. One street along row 15 and one along column 25; the cuartel near (15, 28).
const ROWS = 30
const COLS = 30
const grid: GridMeta = { rows: ROWS, cols: COLS, latMax: -33, lonMin: -71.6, dLat: 60 / 111320, dLon: 60 / (111320 * Math.cos((33 * Math.PI) / 180)), cellM: 60, t0: '2024-02-02T12:00:00-03:00', sources: {} }
const ll = (r: number, c: number): [number, number] => [grid.lonMin + (c + 0.5) * grid.dLon, grid.latMax - (r + 0.5) * grid.dLat]
const fuel = new Uint8Array(ROWS * COLS)
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) fuel[r * COLS + c] = c < 10 || c === 14 ? FUEL.GRASS : c < 20 ? FUEL.URBAN_LOW : FUEL.NONE
const roads: RoadsFile = { nodes: [], edges: [] }
for (let c = 0; c < COLS; c++) roads.nodes.push(ll(15, c))
for (let c = 0; c + 1 < COLS; c++) roads.edges.push([c, c + 1, 60, ROAD.LOCAL])
for (let r = 0; r < ROWS; r++) if (r !== 15) roads.nodes.push(ll(r, 25))
// column-25 street: nodes 30.. (rows 0..29 without 15), joined to node 25 at row 15
const colNode = (r: number) => (r === 15 ? 25 : 30 + (r < 15 ? r : r - 1))
for (let r = 0; r + 1 < ROWS; r++) roads.edges.push([colNode(r), colNode(r + 1), 60, ROAD.LOCAL])
const bl: number[] = []
for (let r = 10; r <= 20; r++) for (let c = 10; c <= 19; c++) if (c !== 14) bl.push(...ll(r, c), 100)
const buildings = Float32Array.from(bl)
const prepared = prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: 300 })
// Pass-1 fire: moves east, reaching column c at 60 + 10 c minutes; never past column 19.
const arrival = new Float32Array(ROWS * COLS).fill(Infinity)
for (let r = 0; r < ROWS; r++) for (let c = 0; c < 20; c++) arrival[r * COLS + c] = 60 + 10 * c

const file: BrigadesFile = {
  stations: [{ id: 's1', cuerpo: 'X', company: '1ª', lon: ll(15, 28)[0], lat: ll(15, 28)[1], units: [1, 0, 0, 0], unitsSource: null, locationSource: 'test' }],
  dispatch: [{ cuerpo: 'X', dispatchLocal: '2024-02-02T12:00', source: null }],
  reinforcements: [],
  cuts: [],
}
function plan(units: number[], dispatchMin = 0) {
  const settings: BrigadeSettings = { units: { s1: units }, dispatchMin: { X: dispatchMin }, reinforcementUnits: {}, reinforcementMin: {}, historicalCuts: false }
  return planBrigades({ prepared, grid, fuel, arrivalMin: arrival, file, settings, toMin: () => 0, safetyMarginMin: 5, carKmhByClass: KMH, horizonMin: 720 })
}

describe('planBrigades', () => {
  it('no units: no defended cells', () => {
    const p = plan([0, 0, 0, 0])
    expect(p.units).toHaveLength(0)
    expect(p.defendedCells).toBe(0)
    expect(p.defense.fromMin.every((x) => x === Infinity)).toBe(true)
  })
  it('a second Bomba goes to another sector once the best one is covered (diminishing returns)', () => {
    const p = plan([2, 0, 0, 0])
    expect(p.units.map((u) => u.status)).toEqual(['deployed', 'deployed'])
    expect(p.units[0].sector).not.toBe(p.units[1].sector)
    expect(p.units[0].path.length).toBeGreaterThan(0)
  })
  it('Bomba water lasts tank / flow from when the fire comes near; an aljibe at the site adds its water', () => {
    const tank = FIREFIGHT_MODEL.tankL[UNIT.BOMBA].value / FIREFIGHT_MODEL.flowLPerMin.value
    const alone = plan([1, 0, 0, 0]).units[0]
    expect(alone.workToMin - alone.workFromMin).toBeCloseTo(tank, 4)
    expect(alone.workFromMin).toBeGreaterThan(alone.arriveMin)
    const p = plan([1, 0, 1, 0])
    const b = p.units.find((u) => u.type === UNIT.BOMBA)!
    expect(p.units.find((u) => u.type === UNIT.ALJIBE)!.sector).toBe(b.sector)
    expect(b.workToMin - b.workFromMin).toBeCloseTo(tank + FIREFIGHT_MODEL.tankL[UNIT.ALJIBE].value / FIREFIGHT_MODEL.flowLPerMin.value, 4)
  })
  it('Bomba defends urban cells without an intensity limit; Forestal wildland cells up to 1730 kW/m', () => {
    const b = plan([1, 0, 0, 0])
    const f = plan([0, 1, 0, 0])
    let nb = 0
    let nf = 0
    for (let i = 0; i < ROWS * COLS; i++) {
      if (b.defense.fromMin[i] !== Infinity) {
        nb++
        expect(fuel[i]).toBe(FUEL.URBAN_LOW)
        expect(b.defense.maxKwM[i]).toBe(Infinity)
      }
      if (f.defense.fromMin[i] !== Infinity) {
        nf++
        expect(fuel[i]).toBe(FUEL.GRASS)
        expect(f.defense.maxKwM[i]).toBe(1730)
      }
    }
    expect(nb).toBeGreaterThan(0)
    expect(nf).toBeGreaterThan(0)
  })
  it('a unit that leaves after the fire has cut every way to the threatened sectors has no access', () => {
    const p = plan([1, 0, 0, 0], 300)
    expect(p.units[0].status).toBe('no_access')
    expect(p.defendedCells).toBe(0)
  })
  it('refuses a historical cut that matches no road (never fails silently)', () => {
    const settings: BrigadeSettings = { units: { s1: [1, 0, 0, 0] }, dispatchMin: { X: 0 }, reinforcementUnits: {}, reinforcementMin: {}, historicalCuts: true }
    const cutFile: BrigadesFile = { ...file, cuts: [{ id: 'c', label: 'Corte', lines: [[ll(2, 2), ll(2, 5)]], fromLocal: '2024-02-02T12:00', toLocal: null, source: 'test' }] }
    expect(() => planBrigades({ prepared, grid, fuel, arrivalMin: arrival, file: cutFile, settings, toMin: () => 0, safetyMarginMin: 5, carKmhByClass: KMH, horizonMin: 720 })).toThrow(/Corte/)
  })
  it('refuses settings without a dispatch time or with bad unit counts', () => {
    const settings: BrigadeSettings = { units: { s1: [1, 0, 0] }, dispatchMin: { X: 0 }, reinforcementUnits: {}, reinforcementMin: {}, historicalCuts: false }
    expect(() => planBrigades({ prepared, grid, fuel, arrivalMin: arrival, file, settings, toMin: () => 0, safetyMarginMin: 5, carKmhByClass: KMH, horizonMin: 720 })).toThrow(/units/)
  })
})

describe('applyRescue', () => {
  it('with no rescue units returns the evacuation total unchanged (exactly)', () => {
    const nB = buildings.length / 3
    const risk = new Float32Array(nB).map((_, i) => ((i * 7919) % 97) / 97)
    const total = 123.456789
    const res = applyRescue(prepared, risk, new Uint8Array(nB), [], 720, total)
    expect(res.expectedTrappedHouseholds).toBe(total)
  })
  it('takes out at most rescuePerHour x hours households within the radius, highest risk first', () => {
    const p = plan([0, 0, 0, 1])
    const u = p.units[0]
    expect(u.status).toBe('deployed')
    const nB = buildings.length / 3
    const risk = new Float32Array(nB).map((_, i) => 0.2 + 0.7 * ((i * 7919) % 97) / 97)
    const status = new Uint8Array(nB).fill(HOUSEHOLD.AT_RISK)
    const horizon = u.arriveMin + 60
    const res = applyRescue(prepared, risk, status, p.units, horizon, risk.reduce((a, b) => a + b, 0))
    const taken = [...risk.keys()].filter((b) => res.householdRisk[b] === 0)
    expect(taken).toHaveLength(FIREFIGHT_MODEL.rescuePerHour.value)
    expect(res.rescuedExpected).toBeCloseTo(taken.reduce((a, b) => a + risk[b], 0), 4)
    expect(res.expectedTrappedHouseholds).toBeCloseTo(risk.reduce((a, b) => a + b, 0) - res.rescuedExpected, 2)
    for (const b of taken) expect(res.householdStatus[b]).toBe(HOUSEHOLD.SAFE)
  })
})
