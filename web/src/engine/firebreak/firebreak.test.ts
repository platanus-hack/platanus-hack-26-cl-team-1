import { describe, expect, it } from 'vitest'
import { prepareEvac } from '../evac/prepare'
import { DEFAULT_FIRE_PARAMS, simulateFire } from '../fire'
import { FUEL, ROAD, type FireInput, type FuelCode, type GridMeta, type RoadsFile, type WeatherSample } from '../types'
import { FlowNetwork, LINE_MODEL, LineCut, buildMinutes, buildableCells, cellsInTime, crewAccessMin, fireNearMin, lineDefense, lineSegments, refineLine, scheduleLine } from './index'

// ---------------------------------------------------------------------------------------------------------
// Minimum cut
// ---------------------------------------------------------------------------------------------------------

/** mulberry32: reproducible random graphs. */
function prng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('FlowNetwork (Dinic)', () => {
  it('solves the textbook network (Cormen et al., max flow 23)', () => {
    const g = new FlowNetwork(6)
    const [s, v1, v2, v3, v4, t] = [0, 1, 2, 3, 4, 5]
    g.addArc(s, v1, 16)
    g.addArc(s, v2, 13)
    g.addArc(v1, v3, 12)
    g.addArc(v2, v1, 4)
    g.addArc(v2, v4, 14)
    g.addArc(v3, v2, 9)
    g.addArc(v3, t, 20)
    g.addArc(v4, v3, 7)
    g.addArc(v4, t, 4)
    expect(g.maxFlow(s, t)).toBe(23)
    const side = g.sourceSide(s)
    expect(side[s]).toBe(1)
    expect(side[t]).toBe(0)
  })

  it('equals the cheapest cut found by brute force on random graphs, and its source side is such a cut', () => {
    const rnd = prng(7)
    for (let trial = 0; trial < 60; trial++) {
      const n = 4 + Math.floor(rnd() * 4) // 4..7 nodes; 0 = source, n - 1 = sink
      const arcs: [number, number, number][] = []
      for (let u = 0; u < n; u++)
        for (let v = 0; v < n; v++) if (u !== v && v !== 0 && u !== n - 1 && rnd() < 0.5) arcs.push([u, v, Math.round(rnd() * 90) / 10])
      const g = new FlowNetwork(n)
      for (const [u, v, c] of arcs) g.addArc(u, v, c)
      const flow = g.maxFlow(0, n - 1)
      // Every set holding the source and not the sink.
      let best = Infinity
      for (let mask = 0; mask < 1 << (n - 2); mask++) {
        const inS = (x: number) => x === 0 || (x !== n - 1 && ((mask >> (x - 1)) & 1) === 1)
        let cut = 0
        for (const [u, v, c] of arcs) if (inS(u) && !inS(v)) cut += c
        best = Math.min(best, cut)
      }
      expect(flow).toBeCloseTo(best, 6)
      const side = g.sourceSide(0)
      let cutOfSide = 0
      for (const [u, v, c] of arcs) if (side[u] && !side[v]) cutOfSide += c
      expect(cutOfSide).toBeCloseTo(flow, 6)
    }
  })

  it('can be solved again after reset() with another capacity', () => {
    const g = new FlowNetwork(3)
    const a = g.addArc(0, 1, 5)
    g.addArc(1, 2, 3)
    expect(g.maxFlow(0, 2)).toBe(3)
    g.reset()
    g.setCapacity(a, 2)
    expect(g.maxFlow(0, 2)).toBe(2)
    expect(g.flowOn(a)).toBe(2)
  })

  it('refuses a source joined to the sink by infinite arcs only, and malformed arcs', () => {
    const g = new FlowNetwork(3)
    g.addArc(0, 1, Infinity)
    g.addArc(1, 2, Infinity)
    expect(() => g.maxFlow(0, 2)).toThrow(/infinite/)
    expect(() => g.addArc(0, 3, 1)).toThrow(/outside/)
    expect(() => g.addArc(0, 1, -1)).toThrow(/capacity/)
    expect(() => g.addArc(0, 1, NaN)).toThrow(/capacity/)
  })
})

// ---------------------------------------------------------------------------------------------------------
// The cut of the spread graph
// ---------------------------------------------------------------------------------------------------------

const ROWS = 7
const COLS = 12
const cell = (r: number, c: number) => r * COLS + c
/** A fire moving east (arrival = 10 min per column) through a wall at column 6 that is open in rows 2-3 only. */
function corridor() {
  const arrivalMin = new Float32Array(ROWS * COLS)
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) arrivalMin[cell(r, c)] = c === 6 && r !== 2 && r !== 3 ? Infinity : 10 * c
  const eligible = new Uint8Array(ROWS * COLS).fill(1)
  const value = new Float32Array(ROWS * COLS)
  for (let r = 0; r < ROWS; r++) value[cell(r, COLS - 1)] = 10
  const ignitionCells = [cell(3, 0)]
  return { rows: ROWS, cols: COLS, arrivalMin, jumps: new Int32Array(0), ignitionCells, eligible, value, untilMin: Infinity }
}

describe('LineCut', () => {
  it('cuts the gap of a wall: the cheapest chain that separates the ignition from the households', () => {
    const cut = new LineCut(corridor())
    expect(cut.totalValue).toBe(70)
    const r = cut.solve(1)
    // Two cells close the gap. Of the equal cuts (columns 5, 6 or 7) it takes the one nearest the ignition.
    expect(Array.from(r.cells)).toEqual([cell(2, 5), cell(3, 5)])
    expect(r.protectedValue).toBe(70)
    expect(r.lostValue).toBe(0)
  })

  it('builds nothing when the line costs more than lambda x households, and says what it gave up', () => {
    const cut = new LineCut(corridor())
    // 2 cells of line against 70 households: worth it only from 2 / 70 cells per household.
    const cheap = cut.solve(0.02)
    expect(cheap.cells).toHaveLength(0)
    expect(cheap.lostValue).toBe(70)
    expect(cheap.protectedValue).toBe(0)
    expect(cut.solve(0.04).cells).toHaveLength(2)
    expect(() => cut.solve(0)).toThrow(/lambda/)
  })

  it('never uses a cell that is not eligible, an ignition cell, or a forbidden one', () => {
    const base = corridor()
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < 3; c++) base.eligible[cell(r, c)] = 0 // no ring around the ignition
    for (const c of [5, 6, 7]) base.eligible[cell(2, c)] = 0 // row 2 cannot be cut at the gap
    const cut = new LineCut(base)
    const r = cut.solve(1)
    // Cheapest now: keep the fire out of (2, 5) from its three other sides, one of which also closes row 3.
    expect(Array.from(r.cells)).toEqual([cell(1, 5), cell(2, 4), cell(3, 5)])
    expect(r.protectedValue).toBe(70)
    const again = cut.solve(1, new Set(r.cells))
    expect(again.cells.length).toBeGreaterThanOrEqual(3)
    for (const i of again.cells) {
      expect(r.cells).not.toContain(i)
      expect(base.eligible[i]).toBe(1)
    }
    expect(again.protectedValue).toBe(70)
    // The same network solves again without the restriction.
    expect(Array.from(cut.solve(1).cells)).toEqual(Array.from(r.cells))

    // A ring around the ignition is the cheapest cut when the households are worth it; never the ignition cell.
    const open = new LineCut({ ...corridor(), arrivalMin: corridor().arrivalMin.map((_, i) => 10 * (i % COLS)) }).solve(1)
    expect(Array.from(open.cells)).toEqual([cell(2, 0), cell(3, 1), cell(4, 0)])
  })

  it('an ember jump over the line has to be cut too, at its source or where it lands', () => {
    const base = corridor()
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < 3; c++) base.eligible[cell(r, c)] = 0 // no ring around the ignition
    const from = cell(3, 4)
    const to = cell(3, 9)
    base.jumps = Int32Array.from([from, to, from, to]) // a repeated jump counts once
    const cut = new LineCut(base)
    expect(cut.jumpCount).toBe(1)
    const r = cut.solve(1)
    expect(r.cells).toHaveLength(3)
    expect(r.cells.includes(from) || r.cells.includes(to)).toBe(true)
    expect(r.protectedValue).toBe(70)
    // If neither end of the jump can be cut, the fire has to be kept away from the source cell: 5 cells.
    base.eligible[from] = 0
    base.eligible[to] = 0
    const far = new LineCut(base).solve(1)
    expect(far.protectedValue).toBe(70)
    expect(far.cells).toHaveLength(5)
    expect(far.cells).not.toContain(from)
    expect(far.cells).not.toContain(to)
  })

  it('with a time threshold, only what the fire reaches by then is in the graph', () => {
    const base = corridor()
    base.value[cell(3, 5)] = 4
    const cut = new LineCut({ ...base, untilMin: 80 }) // columns 0..8
    expect(cut.cellCount).toBe(ROWS * 9 - (ROWS - 2))
    expect(cut.totalValue).toBe(4)
    expect(() => new LineCut({ ...base, ignitionCells: [cell(0, 11)], untilMin: 80 })).toThrow(/no ignition/)
    expect(() => new LineCut({ ...base, untilMin: -1 })).toThrow(/reaches no cell/)
  })
})

// ---------------------------------------------------------------------------------------------------------
// The cut against the real fire engine
// ---------------------------------------------------------------------------------------------------------

function fireInput(rows: number, cols: number, fuelOf: (r: number, c: number) => FuelCode, weather: WeatherSample, spotting: boolean): FireInput {
  const grid: GridMeta = { rows, cols, latMax: 0, lonMin: 0, dLat: 1e-4, dLon: 1e-4, cellM: 60, t0: '2024-02-02T12:00:00-03:00', sources: {} }
  const n = rows * cols
  const fuel = new Uint8Array(n)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) fuel[r * cols + c] = fuelOf(r, c)
  return {
    grid,
    elevation: new Float32Array(n).fill(100),
    fuel,
    firebreak: new Uint8Array(n),
    ignitions: [{ cell: Math.floor(rows / 2) * cols + 2, tMin: 0 }],
    weather: { t0Min: 0, stepMin: 60, samples: [weather] },
    params: { ...DEFAULT_FIRE_PARAMS, spotting, horizonMin: 100000 },
  }
}

/** Cuts the spread graph of `inp`'s own fire to protect the cells in `value`, builds that line before the
 *  fire (and optionally removes eligibility at random) and runs the engine again. */
function cutAndBurn(inp: FireInput, value: Float32Array, eligible: Uint8Array) {
  const { rows, cols } = inp.grid
  const pairs: number[] = []
  const baseline = simulateFire(inp, (from, to) => pairs.push(from, to))
  const cut = new LineCut({ rows, cols, arrivalMin: baseline.arrivalMin, jumps: Int32Array.from(pairs), ignitionCells: inp.ignitions.map((g) => g.cell), eligible, value, untilMin: Infinity })
  const r = cut.solve(1000)
  const defended = simulateFire({ ...inp, defense: lineDefense(rows * cols, r.cells, new Float64Array(r.cells.length).fill(-Infinity)) })
  return { baseline, r, defended, jumps: pairs.length / 2 }
}

describe('a cut of the 4-neighbour graph holds in the fire engine', () => {
  const rows = 40
  const cols = 60
  const value = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) for (let c = cols - 8; c < cols; c++) value[r * cols + c] = 1

  it('no spotting: a jagged chain (random cells cannot be cut) lets no fire through, straight, diagonal or knight moves', () => {
    const rnd = prng(11)
    const eligible = new Uint8Array(rows * cols)
    // A band well away from the ignition (else the cheapest cut is a ring around it), 6 cells in 10 usable.
    for (let i = 0; i < eligible.length; i++) eligible[i] = i % cols >= 20 && i % cols < 45 && rnd() < 0.6 ? 1 : 0
    const inp = fireInput(rows, cols, () => FUEL.GRASS, { tempC: 32, rh: 20, windKmh: 30, windFromDeg: 250 }, false)
    const { baseline, r, defended } = cutAndBurn(inp, value, eligible)
    expect(r.lostValue).toBe(0)
    expect(r.cells.length).toBeGreaterThanOrEqual(rows) // a chain across the grid, not shorter than its width
    let reachedBefore = 0
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 0) continue
      if (baseline.arrivalMin[i] !== Infinity) reachedBefore++
      expect(defended.arrivalMin[i]).toBe(Infinity)
    }
    expect(reachedBefore).toBe(rows * 8)
    for (const i of r.cells) expect(eligible[i]).toBe(1)
  })

  it('with spotting: the line also stops every ember jump the engine makes (constant weather)', () => {
    // Forest throws embers in a 45 km/h wind; a grass strip (no ember source) is where a thin line can hold.
    const inp = fireInput(rows, cols, (_r, c) => (c >= 30 && c < 48 ? FUEL.GRASS : FUEL.FOREST), { tempC: 35, rh: 15, windKmh: 45, windFromDeg: 270 }, true)
    const eligible = new Uint8Array(rows * cols)
    for (let i = 0; i < eligible.length; i++) eligible[i] = i % cols >= 20 ? 1 : 0
    const { baseline, r, defended, jumps } = cutAndBurn(inp, value, eligible)
    expect(jumps).toBeGreaterThan(1000)
    expect(r.lostValue).toBe(0)
    for (let i = 0; i < value.length; i++) {
      if (value[i] === 0) continue
      expect(baseline.arrivalMin[i]).not.toBe(Infinity)
      expect(defended.arrivalMin[i]).toBe(Infinity)
    }
    // The same search without the ember jumps in its graph puts the line in the forest, and the engine jumps it.
    const blind = new LineCut({ rows, cols, arrivalMin: baseline.arrivalMin, jumps: new Int32Array(0), ignitionCells: inp.ignitions.map((g) => g.cell), eligible, value, untilMin: Infinity }).solve(1000)
    expect(blind.lostValue).toBe(0)
    const leaky = simulateFire({ ...inp, defense: lineDefense(rows * cols, blind.cells, new Float64Array(blind.cells.length).fill(-Infinity)) })
    let burned = 0
    for (let i = 0; i < value.length; i++) if (value[i] > 0 && leaky.arrivalMin[i] !== Infinity) burned++
    expect(burned).toBeGreaterThan(0)
  })

  it('onSpot only observes: the fire is the same with and without it', () => {
    const inp = fireInput(20, 40, () => FUEL.FOREST, { tempC: 35, rh: 15, windKmh: 45, windFromDeg: 270 }, true)
    let n = 0
    const a = simulateFire(inp)
    const b = simulateFire(inp, (from, to) => {
      n++
      expect(a.arrivalMin[from]).not.toBe(Infinity)
      expect(to).not.toBe(from)
    })
    expect(n).toBeGreaterThan(0)
    expect(Array.from(b.arrivalMin)).toEqual(Array.from(a.arrivalMin))
    expect(Array.from(b.rosMPerMin)).toEqual(Array.from(a.rosMPerMin))
  })
})

// ---------------------------------------------------------------------------------------------------------
// The time rule and the schedule
// ---------------------------------------------------------------------------------------------------------

describe('cellsInTime: access + build + margin <= fire near', () => {
  const buildable = Uint8Array.from([1, 1, 1, 0, 1, 1])
  const access = Float32Array.from([100, 100, 100, 0, 100, Infinity])
  const build = Float32Array.from([20, 20, 20, 20, 20, 20])
  const near = Float32Array.from([150, 149, Infinity, 1000, 120, Infinity])
  it('passes exactly at the limit, fails one minute short, never for a cell that is not buildable or not reachable', () => {
    expect(Array.from(cellsInTime(buildable, access, build, near, 30))).toEqual([1, 0, 1, 0, 0, 0])
    expect(Array.from(cellsInTime(buildable, access, build, near, 0))).toEqual([1, 1, 1, 0, 1, 0])
  })
  it('rejects a negative margin and arrays of different length', () => {
    expect(() => cellsInTime(buildable, access, build, near, -1)).toThrow(/margin/)
    expect(() => cellsInTime(buildable, access.slice(1), build, near, 0)).toThrow(/length/)
  })
})

describe('buildableCells and buildMinutes', () => {
  const fuel = Uint8Array.from([FUEL.GRASS, FUEL.SHRUB, FUEL.FOREST, FUEL.CROP, FUEL.URBAN_LOW, FUEL.URBAN_DENSE, FUEL.NONE, FUEL.GRASS, FUEL.GRASS])
  it('wildland only, never a cell with a building or an ignition', () => {
    expect(Array.from(buildableCells(fuel, [7, -1], [8]))).toEqual([1, 1, 1, 1, 0, 0, 0, 0, 0])
    expect(() => buildableCells(fuel, [], [99])).toThrow(/outside/)
  })
  it('one cell takes cellM / rate minutes; matorral is the slowest fuel', () => {
    const m = buildMinutes(fuel, 60)
    expect(m[0]).toBeCloseTo(60 / LINE_MODEL.buildMPerMin[FUEL.GRASS].value, 5)
    expect(m[1]).toBeGreaterThan(m[2])
    expect(m[2]).toBeGreaterThan(m[0])
    expect(m[4]).toBe(Infinity)
    expect(m[6]).toBe(Infinity)
  })
})

describe('scheduleLine', () => {
  const job = (cellId: number, releaseMin: number, buildMin: number, deadlineMin: number) => ({ cell: cellId, releaseMin, buildMin, deadlineMin })
  it('one crew builds the most urgent cell first, one after another', () => {
    const s = scheduleLine([job(0, 0, 10, 100), job(1, 0, 10, 15), job(2, 0, 10, 50)], 1)
    expect(Array.from(s.readyMin)).toEqual([30, 10, 20])
    expect(s.late).toEqual([])
  })
  it('reports the cells finished after their deadline', () => {
    const s = scheduleLine([job(0, 0, 10, 25), job(1, 0, 10, 15), job(2, 0, 10, 18)], 1)
    expect(Array.from(s.readyMin)).toEqual([30, 10, 20])
    expect(s.late.sort()).toEqual([0, 2])
  })
  it('a second crew halves the wait; nobody starts before the cell can be reached', () => {
    const s = scheduleLine([job(0, 0, 10, 100), job(1, 0, 10, 15), job(2, 0, 10, 50), job(3, 40, 10, 60)], 2)
    expect(Array.from(s.readyMin)).toEqual([20, 10, 10, 50])
    expect(s.late).toEqual([])
  })
  it('a cell the fire never reaches has no deadline and goes last', () => {
    const s = scheduleLine([job(0, 0, 10, Infinity), job(1, 0, 10, 500)], 1)
    expect(Array.from(s.readyMin)).toEqual([20, 10])
  })
  it('refuses a cell nobody can reach, a bad build time and a bad crew count', () => {
    expect(() => scheduleLine([job(0, Infinity, 10, 100)], 1)).toThrow(/reach/)
    expect(() => scheduleLine([job(0, 0, Infinity, 100)], 1)).toThrow(/build time/)
    expect(() => scheduleLine([job(0, 0, 10, 100)], 0)).toThrow(/crews/)
  })
})

describe('lineDefense in the fire engine', () => {
  const rows = 9
  const cols = 40
  const inp = fireInput(rows, cols, () => FUEL.GRASS, { tempC: 32, rh: 20, windKmh: 30, windFromDeg: 270 }, false)
  const line = Array.from({ length: rows }, (_, r) => r * cols + 20)
  const base = simulateFire(inp)
  const near = fireNearMin(base.arrivalMin, rows, cols)
  /** When the fire is first within two cells of the line. */
  const atLine = Math.min(...line.map((i) => near[i]))
  const beyond = (a: Float32Array) => a[4 * cols + 30]

  it('fireNearMin is the earliest arrival within two cells', () => {
    expect(near[4 * cols + 20]).toBe(Math.min(...[2, 3, 4, 5, 6].flatMap((r) => [18, 19, 20, 21, 22].map((c) => base.arrivalMin[r * cols + c]))))
    expect(atLine).toBeLessThan(Math.min(...line.map((i) => base.arrivalMin[i])))
  })
  it('holds if it is finished before the fire is within two cells, against any intensity, and leaves other cells alone', () => {
    const d = lineDefense(rows * cols, line, line.map(() => atLine - 1))
    for (const i of line) {
      expect(d.fromMin[i]).toBeGreaterThanOrEqual(atLine - 1)
      expect(d.toMin[i]).toBe(Infinity)
      expect(d.maxKwM[i]).toBe(Infinity)
    }
    expect(d.fromMin[0]).toBe(Infinity)
    expect(beyond(base.arrivalMin)).not.toBe(Infinity)
    expect(beyond(simulateFire({ ...inp, defense: d }).arrivalMin)).toBe(Infinity)
  })
  it('a line finished after the fire has passed changes nothing', () => {
    const late = Math.max(...line.map((i) => base.arrivalMin[i])) + 1
    const d = lineDefense(rows * cols, line, line.map(() => late))
    expect(Array.from(simulateFire({ ...inp, defense: d }).arrivalMin)).toEqual(Array.from(base.arrivalMin))
  })
  it('keeps the windows of a defence it is added to, and checks its input', () => {
    const d0 = lineDefense(rows * cols, [5], [3])
    const d1 = lineDefense(rows * cols, [6], [-Infinity], d0)
    expect(d1.fromMin[5]).toBe(3)
    expect(d1.fromMin[6]).toBe(-Infinity)
    expect(d0.fromMin[6]).toBe(Infinity)
    expect(() => lineDefense(10, [10], [0])).toThrow(/outside/)
    expect(() => lineDefense(10, [1], [NaN])).toThrow(/ready/)
    expect(() => lineDefense(10, [1, 2], [0])).toThrow(/length/)
  })
})

// ---------------------------------------------------------------------------------------------------------
// Access, pieces and the search
// ---------------------------------------------------------------------------------------------------------

describe('crewAccessMin', () => {
  // 20 x 20 cells of 60 m; one street along row 10 from column 0 to 19 (LOCAL, 20 km/h); the base at its east end.
  const R = 20
  const C = 20
  const grid: GridMeta = { rows: R, cols: C, latMax: -33, lonMin: -71.6, dLat: 60 / 111320, dLon: 60 / (111320 * Math.cos((33 * Math.PI) / 180)), cellM: 60, t0: '2024-02-02T12:00:00-03:00', sources: {} }
  const ll = (r: number, c: number): [number, number] => [grid.lonMin + (c + 0.5) * grid.dLon, grid.latMax - (r + 0.5) * grid.dLat]
  const fuel = new Uint8Array(R * C)
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) fuel[r * C + c] = c < 12 ? FUEL.GRASS : FUEL.NONE
  const roads: RoadsFile = { nodes: [], edges: [] }
  for (let c = 0; c < C; c++) roads.nodes.push(ll(10, c))
  for (let c = 0; c + 1 < C; c++) roads.edges.push([c, c + 1, 60, ROAD.LOCAL])
  const prepared = prepareEvac(grid, fuel, roads, Float32Array.from([...ll(10, 15), 100]), { safeDistanceM: 300 })
  const noFire = new Float32Array(R * C).fill(Infinity)
  const KMH = [60, 40, 35, 30, 20, 0]
  const base = { lon: ll(10, 19)[0], lat: ll(10, 19)[1], departMin: 100 }
  const access = (arrivalMin: Float32Array, departMin = 100) => crewAccessMin({ prepared, grid, arrivalMin, bases: [{ ...base, departMin }], carKmhByClass: KMH, safetyMarginMin: 5 })

  it('by road at free flow, then off the road at the walking speed of the model', () => {
    const a = access(noFire)
    const perCellRoad = 60 / ((20 * 1000) / 60)
    const perCellOff = 60 / ((LINE_MODEL.offRoadKmh.value * 1000) / 60)
    expect(a[10 * C + 19]).toBeCloseTo(100, 4)
    expect(a[10 * C + 4]).toBeCloseTo(100 + 15 * perCellRoad, 3)
    expect(a[7 * C + 4]).toBeCloseTo(100 + 15 * perCellRoad + 3 * perCellOff, 3)
    const later = access(noFire, 160)
    for (let i = 0; i < a.length; i++) expect(later[i] - 60).toBeCloseTo(a[i], 3)
  })
  it('a road the fire has closed is not driven: the crew walks from where it could get to', () => {
    const fire = noFire.slice()
    for (let r = 0; r < R; r++) fire[r * C + 8] = 50 // the fire is on column 8 before the crew leaves
    const a = access(fire)
    const open = access(noFire)
    expect(a[10 * C + 4]).toBeGreaterThan(open[10 * C + 4])
    expect(a[10 * C + 12]).toBeCloseTo(open[10 * C + 12], 4)
  })
  it('needs a base with a departure time', () => {
    expect(() => crewAccessMin({ prepared, grid, arrivalMin: noFire, bases: [], carKmhByClass: KMH, safetyMarginMin: 5 })).toThrow(/no base/)
    expect(() => access(noFire, Infinity)).toThrow(/departure/)
  })
})

describe('lineSegments', () => {
  it('groups cells that touch, corners included, largest first', () => {
    // 5 columns: a diagonal of 3, and a pair two columns away.
    const segs = lineSegments(4, 5, [0, 6, 12, 4, 9])
    expect(segs.map((s) => Array.from(s))).toEqual([
      [0, 6, 12],
      [4, 9],
    ])
    expect(lineSegments(4, 5, [])).toEqual([])
  })
  it('does not join cells across the grid edge', () => {
    expect(lineSegments(2, 3, [2, 3])).toHaveLength(2)
  })
})

describe('refineLine', () => {
  // Households cut off: 100, minus 60 if piece A is whole, minus 30 for B, minus 5 for C; U does nothing.
  const A = Int32Array.from([1, 2, 3])
  const B = Int32Array.from([10, 11])
  const C1 = Int32Array.from([20])
  const U = Int32Array.from([30, 31])
  const has = (cells: Int32Array, p: Int32Array) => p.every((i) => cells.includes(i))
  const evaluate = (cells: Int32Array) => 100 - (has(cells, A) ? 60 : 0) - (has(cells, B) ? 30 : 0) - (has(cells, C1) ? 5 : 0)

  it('drops a piece that does not help and adds the pieces with the largest gain per cell', () => {
    const r = refineLine({ start: [A, U], pool: [B, C1], budgetCells: 6, evaluate, tolerance: 0.5, maxAddRounds: 5 })
    expect(Array.from(r.cells)).toEqual([1, 2, 3, 10, 11, 20])
    expect(r.trapped).toBe(5)
    expect(r.dropped).toBe(1)
    expect(r.added).toBe(2)
  })
  it('never goes over the budget and stops when nothing helps', () => {
    const r = refineLine({ start: [A], pool: [B, C1, U], budgetCells: 4, evaluate, tolerance: 0.5, maxAddRounds: 5 })
    expect(Array.from(r.cells)).toEqual([1, 2, 3, 20])
    expect(r.trapped).toBe(35)
    expect(() => refineLine({ start: [A, B], pool: [], budgetCells: 4, evaluate, tolerance: 0.5, maxAddRounds: 1 })).toThrow(/budget/)
  })
  it('starts from nothing when no proposal fits', () => {
    const r = refineLine({ start: [], pool: [U, B], budgetCells: 2, evaluate, tolerance: 0.5, maxAddRounds: 3 })
    expect(Array.from(r.cells)).toEqual([10, 11])
    expect(r.trapped).toBe(70)
  })
})
