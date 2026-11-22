// Firebreak lines for one scenario: where to build them and by when, so that as few households as possible are
// left without a way out (MODEL.md in this folder). The scenario is known here (ignitions, weather): this is
// the opposite case of the Plan de preparación (src/engine/plan), which knows nothing about the next fire.
//
// The search proposes lines with a minimum cut of the fire's own spread graph, keeps only cells a crew can
// finish before the fire arrives, and then adds and drops pieces re-running the real fire and evacuation
// engines. It is a search checked by the simulator, not an optimum: placing firebreaks optimally is NP-hard
// (the firefighter problem, Finbow & MacGillivray 2009). Pure TypeScript, no DOM.
import { CellHeap } from '../fire/heap'
import { asPrepared } from '../evac/prepare'
import { dilateMin3x3 } from '../evac/simulate'
import { earliestArrival, edgeClosuresFromFire, nearestDrivable, toXY } from '../brigade'
import { FUEL, type EvacPrepared, type FireDefense, type GridMeta } from '../types'
import { LINE_MODEL } from './model'
import { FlowNetwork } from './mincut'

export { LINE_MODEL } from './model'
export { FlowNetwork } from './mincut'

function fail(msg: string): never {
  throw new Error(`firebreak: ${msg}`)
}

const WILDLAND = new Set<number>([FUEL.GRASS, FUEL.SHRUB, FUEL.FOREST, FUEL.CROP])

// -------------------------------------------------------------------------------------------------------
// Where a line may go, and when a crew can be there
// -------------------------------------------------------------------------------------------------------

/** 1 for the cells a line may use: wildland fuel, no building in the cell, not an ignition cell. Houses are
 *  never cleared, and a line through consolidated built-up land is a street, not a firebreak. */
export function buildableCells(fuel: Uint8Array, buildingCells: ArrayLike<number>, ignitionCells: readonly number[]): Uint8Array {
  const out = new Uint8Array(fuel.length)
  for (let i = 0; i < fuel.length; i++) out[i] = WILDLAND.has(fuel[i]) ? 1 : 0
  for (let b = 0; b < buildingCells.length; b++) if (buildingCells[b] >= 0) out[buildingCells[b]] = 0
  for (const c of ignitionCells) {
    if (!(c >= 0 && c < fuel.length)) fail(`ignition cell ${c} is outside the grid`)
    out[c] = 0
  }
  return out
}

/** Minutes one crew needs to build the line across one cell, per cell (Infinity where the fuel is not
 *  wildland): cellM / LINE_MODEL.buildMPerMin of the cell's fuel. */
export function buildMinutes(fuel: Uint8Array, cellM: number): Float32Array {
  const out = new Float32Array(fuel.length).fill(Infinity)
  for (let i = 0; i < fuel.length; i++) {
    const rate = LINE_MODEL.buildMPerMin[fuel[i] as keyof typeof LINE_MODEL.buildMPerMin]
    if (rate) out[i] = cellM / rate.value
  }
  return out
}

export interface CrewBase {
  lon: number
  lat: number
  /** When its crews leave (minutes since t0). */
  departMin: number
}

export interface AccessInput {
  prepared: EvacPrepared
  grid: GridMeta
  /** The fire without lines: it closes the roads the crews drive on, as it does for everyone else. */
  arrivalMin: Float32Array
  bases: CrewBase[]
  carKmhByClass: number[]
  safetyMarginMin: number
}

/** Earliest time (minutes since t0) a crew can stand at each cell: by road from the nearest base at free-flow
 *  speed (the brigade engine's router: a road is unusable once the fire is on or next to it), then off the road
 *  at LINE_MODEL.offRoadKmh from the nearest street node. Infinity where no base reaches. */
export function crewAccessMin(input: AccessInput): Float32Array {
  const P = asPrepared(input.prepared)
  const { rows, cols, cellM } = P
  const n = rows * cols
  if (input.arrivalMin.length !== n) fail(`arrivalMin has ${input.arrivalMin.length} cells, the grid has ${n}`)
  if (input.bases.length === 0) fail('no base to send crews from')
  const sources = input.bases.map((b) => {
    if (!Number.isFinite(b.departMin)) fail(`a base has no departure time (${b.departMin})`)
    return { node: nearestDrivable(P, ...toXY(input.grid, b.lon, b.lat)), tMin: b.departMin }
  })
  const closes = edgeClosuresFromFire(P, input.arrivalMin, input.safetyMarginMin)
  const routes = earliestArrival(P, sources, closes, [], input.carKmhByClass)
  // Off the road: Dijkstra over the grid from every street node the crews reach (8 neighbours).
  const time = new Float64Array(n).fill(Infinity)
  const heap = new CellHeap(time)
  for (let v = 0; v < P.nodeCount; v++) {
    const c = P.nodeCell[v]
    if (c >= 0 && routes.time[v] < time[c]) {
      time[c] = routes.time[v]
      heap.pushOrDecrease(c)
    }
  }
  const stepMin = cellM / ((LINE_MODEL.offRoadKmh.value * 1000) / 60)
  const done = new Uint8Array(n)
  while (heap.size > 0) {
    const i = heap.pop()
    if (done[i]) continue
    done[i] = 1
    const r = (i / cols) | 0
    const c = i - r * cols
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const rr = r + dr
        const cc = c + dc
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
        const j = rr * cols + cc
        const t = time[i] + stepMin * (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1)
        if (!done[j] && t < time[j]) {
          time[j] = t
          heap.pushOrDecrease(j)
        }
      }
  }
  return Float32Array.from(time)
}

/** When the fire is first within two cells of each cell: the minimum arrival over the 5 x 5 window around it.
 *  This is the clock a line cell is built against. The fire engine lets a knight move (two cells one way, one
 *  the other) pass between two cells that are not held yet when the fire leaves the source cell, so a line one
 *  cell wide holds only if it is finished before the fire is that close (fire/MODEL.md, "Defended cells"). */
export function fireNearMin(arrivalMin: Float32Array, rows: number, cols: number): Float32Array {
  if (arrivalMin.length !== rows * cols) fail(`fireNearMin: arrivalMin has ${arrivalMin.length} cells, the grid has ${rows * cols}`)
  return dilateMin3x3(dilateMin3x3(arrivalMin, rows, cols).dil, rows, cols).dil
}

/** The time rule: a cell can be part of a line only if a crew can reach it, build it and be done `marginMin`
 *  before the fire is near (fireNearMin): access + build + margin <= fire near. Returns 1 where it holds. A cell
 *  the fire never comes near always passes, if a crew can get there at all. */
export function cellsInTime(buildable: Uint8Array, accessMin: Float32Array, buildMin: Float32Array, nearMin: Float32Array, marginMin: number): Uint8Array {
  const n = buildable.length
  if (accessMin.length !== n || buildMin.length !== n || nearMin.length !== n) fail('cellsInTime: arrays of different length')
  if (!(marginMin >= 0)) fail(`cellsInTime: margin must be >= 0 (got ${marginMin})`)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = buildable[i] === 1 && Number.isFinite(accessMin[i]) && accessMin[i] + buildMin[i] + marginMin <= nearMin[i] ? 1 : 0
  return out
}

// -------------------------------------------------------------------------------------------------------
// When each cell of a line is finished
// -------------------------------------------------------------------------------------------------------

export interface LineJob {
  cell: number
  /** Earliest time a crew can start on this cell (crewAccessMin). */
  releaseMin: number
  /** Minutes one crew needs for it (buildMinutes). */
  buildMin: number
  /** When the fire is near the cell (fireNearMin) minus the safety margin; Infinity if it never is. */
  deadlineMin: number
}

export interface LineSchedule {
  /** When each job's cell is finished, in the order of `jobs`. */
  readyMin: Float64Array
  /** Indices of the jobs finished after their deadline (the fire is there first: that cell will not hold). */
  late: number[]
}

/** Builds the cells of a line with `crews` crews, most urgent first (earliest deadline first; ties by release
 *  time, then by cell). Each cell goes to the crew that can start it soonest. A crew works one cell at a time
 *  and never before the cell's release time. Moving between cells is not counted beyond the release time (the
 *  cells of a line are adjacent; MODEL.md lists this as a limitation). */
export function scheduleLine(jobs: readonly LineJob[], crews: number): LineSchedule {
  if (!Number.isInteger(crews) || crews < 1) fail(`scheduleLine: crews must be a positive integer (got ${crews})`)
  for (const j of jobs) {
    if (!(j.buildMin >= 0) || !Number.isFinite(j.buildMin)) fail(`scheduleLine: cell ${j.cell} has build time ${j.buildMin}`)
    if (Number.isNaN(j.releaseMin) || j.releaseMin === Infinity) fail(`scheduleLine: no crew can reach cell ${j.cell}`)
    if (Number.isNaN(j.deadlineMin)) fail(`scheduleLine: cell ${j.cell} has no deadline`)
  }
  const order = jobs.map((_, k) => k).sort((a, b) => jobs[a].deadlineMin - jobs[b].deadlineMin || jobs[a].releaseMin - jobs[b].releaseMin || jobs[a].cell - jobs[b].cell)
  const free = new Float64Array(crews).fill(-Infinity)
  const readyMin = new Float64Array(jobs.length)
  const late: number[] = []
  for (const k of order) {
    const j = jobs[k]
    // The crew that is idle and was freed last (wastes least), else the one that frees first.
    let best = 0
    for (let c = 1; c < crews; c++) {
      const a = free[c]
      const b = free[best]
      const aIdle = a <= j.releaseMin
      const bIdle = b <= j.releaseMin
      if (aIdle !== bIdle ? aIdle : aIdle ? a > b : a < b) best = c
    }
    const start = Math.max(free[best], j.releaseMin)
    const end = start + j.buildMin
    free[best] = end
    readyMin[k] = end
    if (end > j.deadlineMin) late.push(k)
  }
  return { readyMin, late }
}

/** The built line as the fire engine sees it (FireInput.defense): each cell holds from the moment it is
 *  finished to the end, against any intensity (the fuel is gone). A cell the fire reaches before it is finished
 *  burns like any other. readyMin = -Infinity is a line that exists before the fire starts. */
export function lineDefense(cellCount: number, cells: ArrayLike<number>, readyMin: ArrayLike<number>, base?: FireDefense): FireDefense {
  if (cells.length !== readyMin.length) fail('lineDefense: cells and readyMin differ in length')
  const d: FireDefense = base
    ? { fromMin: base.fromMin.slice(), toMin: base.toMin.slice(), maxKwM: base.maxKwM.slice() }
    : { fromMin: new Float32Array(cellCount).fill(Infinity), toMin: new Float32Array(cellCount).fill(Infinity), maxKwM: new Float32Array(cellCount) }
  if (d.fromMin.length !== cellCount) fail('lineDefense: base defence does not match the grid')
  for (let k = 0; k < cells.length; k++) {
    const i = cells[k]
    if (!(i >= 0 && i < cellCount)) fail(`lineDefense: cell ${i} is outside the grid`)
    if (Number.isNaN(readyMin[k])) fail(`lineDefense: cell ${i} has no ready time`)
    // Float32 rounds to nearest: never let the stored time fall before the real one.
    let from = Math.fround(readyMin[k])
    if (from < readyMin[k]) from = Math.fround(readyMin[k] + Math.abs(readyMin[k]) * 1e-6 + 1e-6)
    d.fromMin[i] = from
    d.toMin[i] = Infinity
    d.maxKwM[i] = Infinity
  }
  return d
}

// -------------------------------------------------------------------------------------------------------
// Where: minimum cut of the spread graph
// -------------------------------------------------------------------------------------------------------

export interface CutInput {
  rows: number
  cols: number
  /** Earliest arrival per cell over the fires the line must hold in (Infinity = none of them reaches it). */
  arrivalMin: Float32Array
  /** Ember jumps seen in those fires, [from0, to0, from1, to1, ...] (simulateFire's onSpot). */
  jumps: Int32Array
  ignitionCells: readonly number[]
  /** 1 where a line cell may be placed (buildable and, when crews build during the fire, in time). */
  eligible: Uint8Array
  /** Households at stake per cell (the expected number that does not get out, without lines). */
  value: Float32Array
  /** Only cells the fire reaches by this time are in the graph, so the line keeps the fire away from what it
   *  protects at least until then (MODEL.md, "Why a time threshold"). */
  untilMin: number
}

export interface CutResult {
  /** Line cells, ascending. */
  cells: Int32Array
  /** Value on the far side of the line (the fire does not reach those cells by untilMin, by the graph). */
  protectedValue: number
  /** Value the cut gave up: still connected to the ignitions. */
  lostValue: number
}

/** The spread graph of one or more fires, ready to be cut at different prices.
 *
 *  Nodes are the cells the fire reaches by `untilMin`. Arcs join 4-neighbours (a minimum cut of the
 *  4-neighbour graph is an 8-connected chain, which the engine's corner rules make watertight for its 16
 *  directions) and every ember jump. A cell costs 1 to cut if it is eligible and cannot be cut otherwise.
 *  Each cell with households at stake is tied to the sink with capacity lambda x households, so the cut
 *  minimises (line cells) + lambda x (households left on the fire's side): lambda is how many cells of line one
 *  more protected household is worth. */
export class LineCut {
  private readonly net: FlowNetwork
  private readonly cellOfNode: Int32Array
  /** The arc in(k) -> out(k) of each node and whether cutting it is allowed. */
  private readonly nodeArc: Int32Array
  private readonly nodeEligible: Uint8Array
  private readonly sinkArc: Int32Array
  /** The out node each sink arc leaves from. */
  private readonly sinkTail: Int32Array
  private readonly sinkValue: Float32Array
  private readonly source: number
  private readonly sink: number
  /** Cells in the graph and distinct ember jumps between them. */
  readonly cellCount: number
  readonly jumpCount: number
  /** Value in the graph (households whose cell the fire reaches by untilMin). */
  readonly totalValue: number

  constructor(input: CutInput) {
    const { rows, cols, arrivalMin, jumps, eligible, value, untilMin } = input
    const n = rows * cols
    if (arrivalMin.length !== n || eligible.length !== n || value.length !== n) fail('LineCut: arrays do not match the grid')
    if (jumps.length % 2 !== 0) fail('LineCut: jumps must hold (from, to) pairs')
    const idx = new Int32Array(n).fill(-1)
    let K = 0
    for (let i = 0; i < n; i++) if (arrivalMin[i] !== Infinity && arrivalMin[i] <= untilMin) idx[i] = K++
    if (K === 0) fail(`LineCut: the fire reaches no cell by minute ${untilMin}`)
    this.cellCount = K
    const cellOfNode = new Int32Array(K)
    for (let i = 0; i < n; i++) if (idx[i] >= 0) cellOfNode[idx[i]] = i
    this.cellOfNode = cellOfNode

    // Distinct jumps between cells of the graph.
    const keys = new Float64Array(jumps.length / 2)
    let nk = 0
    for (let k = 0; k < jumps.length; k += 2) {
      const a = jumps[k]
      const b = jumps[k + 1]
      if (!(a >= 0 && a < n && b >= 0 && b < n)) fail(`LineCut: jump ${a} -> ${b} is outside the grid`)
      if (idx[a] >= 0 && idx[b] >= 0) keys[nk++] = idx[a] * K + idx[b]
    }
    const sorted = keys.subarray(0, nk).sort()
    let nj = 0
    for (let k = 0; k < nk; k++) if (k === 0 || sorted[k] !== sorted[k - 1]) sorted[nj++] = sorted[k]
    this.jumpCount = nj

    // in(k) = 2k, out(k) = 2k + 1.
    const S = 2 * K
    const T = 2 * K + 1
    this.source = S
    this.sink = T
    const net = new FlowNetwork(2 * K + 2, 4 * K + nj)
    const isIgnition = new Uint8Array(n)
    let sources = 0
    for (const c of input.ignitionCells) {
      if (!(c >= 0 && c < n)) fail(`LineCut: ignition cell ${c} is outside the grid`)
      if (idx[c] < 0 || isIgnition[c]) continue
      isIgnition[c] = 1
      net.addArc(S, 2 * idx[c], Infinity)
      sources++
    }
    if (sources === 0) fail('LineCut: no ignition cell burns by untilMin')
    const nodeArc = new Int32Array(K)
    const nodeEligible = new Uint8Array(K)
    const sinkArc: number[] = []
    const sinkTail: number[] = []
    const sinkValue: number[] = []
    let total = 0
    for (let k = 0; k < K; k++) {
      const i = cellOfNode[k]
      nodeEligible[k] = eligible[i] === 1 && !isIgnition[i] ? 1 : 0
      nodeArc[k] = net.addArc(2 * k, 2 * k + 1, nodeEligible[k] ? 1 : Infinity)
      const r = (i / cols) | 0
      const c = i - r * cols
      if (c + 1 < cols && idx[i + 1] >= 0) {
        net.addArc(2 * k + 1, 2 * idx[i + 1], Infinity)
        net.addArc(2 * idx[i + 1] + 1, 2 * k, Infinity)
      }
      if (r + 1 < rows && idx[i + cols] >= 0) {
        net.addArc(2 * k + 1, 2 * idx[i + cols], Infinity)
        net.addArc(2 * idx[i + cols] + 1, 2 * k, Infinity)
      }
      const v = value[i]
      if (!(v >= 0)) fail(`LineCut: value at cell ${i} is ${v}`)
      if (v > 0) {
        sinkArc.push(net.addArc(2 * k + 1, T, 0))
        sinkTail.push(2 * k + 1)
        sinkValue.push(v)
        total += v
      }
    }
    for (let k = 0; k < nj; k++) {
      const a = Math.floor(sorted[k] / K)
      const b = sorted[k] - a * K
      net.addArc(2 * a + 1, 2 * b, Infinity)
    }
    this.net = net
    this.nodeArc = nodeArc
    this.nodeEligible = nodeEligible
    this.sinkArc = Int32Array.from(sinkArc)
    this.sinkTail = Int32Array.from(sinkTail)
    this.sinkValue = Float32Array.from(sinkValue)
    this.totalValue = total
  }

  /** The cheapest line for this price: minimises (line cells) + lambda x (households left on the fire's side).
   *  `forbidden` cells cannot be part of the line in this solve (e.g. cells the crews would finish too late). */
  solve(lambda: number, forbidden?: ReadonlySet<number>): CutResult {
    if (!(lambda > 0) || !Number.isFinite(lambda)) fail(`LineCut: lambda must be > 0 (got ${lambda})`)
    const { net } = this
    net.reset()
    for (let k = 0; k < this.cellCount; k++) net.setCapacity(this.nodeArc[k], this.nodeEligible[k] && !forbidden?.has(this.cellOfNode[k]) ? 1 : Infinity)
    for (let k = 0; k < this.sinkArc.length; k++) net.setCapacity(this.sinkArc[k], lambda * this.sinkValue[k])
    net.maxFlow(this.source, this.sink)
    const side = net.sourceSide(this.source)
    const cells: number[] = []
    for (let k = 0; k < this.cellCount; k++) if (side[2 * k] === 1 && side[2 * k + 1] === 0) cells.push(this.cellOfNode[k])
    // A household's cell is given up when it is still on the fire's side (its arc to the sink is cut).
    let lost = 0
    for (let k = 0; k < this.sinkArc.length; k++) if (side[this.sinkTail[k]] === 1) lost += this.sinkValue[k]
    return { cells: Int32Array.from(cells).sort(), protectedValue: this.totalValue - lost, lostValue: lost }
  }
}

// -------------------------------------------------------------------------------------------------------
// Pieces of a line, and the search on the real engines
// -------------------------------------------------------------------------------------------------------

/** 8-connected groups of line cells, largest first (each sorted ascending). */
export function lineSegments(rows: number, cols: number, cells: ArrayLike<number>): Int32Array[] {
  const inLine = new Map<number, number>()
  for (let k = 0; k < cells.length; k++) inLine.set(cells[k], -1)
  const out: number[][] = []
  for (const start of inLine.keys()) {
    if (inLine.get(start) !== -1) continue
    const id = out.length
    const group: number[] = []
    const stack = [start]
    inLine.set(start, id)
    while (stack.length > 0) {
      const i = stack.pop() as number
      group.push(i)
      const r = Math.floor(i / cols)
      const c = i - r * cols
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue
          const j = rr * cols + cc
          if (inLine.get(j) === -1) {
            inLine.set(j, id)
            stack.push(j)
          }
        }
    }
    out.push(group.sort((a, b) => a - b))
  }
  return out.sort((a, b) => b.length - a.length || a[0] - b[0]).map((g) => Int32Array.from(g))
}

export interface RefineInput {
  /** Pieces of the starting line (lineSegments of a proposal). */
  start: Int32Array[]
  /** Other pieces the search may add. */
  pool: Int32Array[]
  /** Most line cells allowed. */
  budgetCells: number
  /** Households that do not get out with these cells built, from the real fire and evacuation engines. */
  evaluate: (cells: Int32Array) => number
  /** A change counts only if it moves the result by more than this (households). */
  tolerance: number
  maxAddRounds: number
}

export interface RefineResult {
  cells: Int32Array
  trapped: number
  evaluations: number
  dropped: number
  added: number
}

/** Greedy add / remove, every step re-evaluated on the real engines: first drops the pieces whose removal
 *  does not make things worse (smallest first), then, while cells are left in the budget, adds the pool piece
 *  with the largest gain per new cell. */
export function refineLine(input: RefineInput): RefineResult {
  const { evaluate, budgetCells, tolerance } = input
  if (!(budgetCells >= 0)) fail(`refineLine: budget must be >= 0 (got ${budgetCells})`)
  const current = new Set<number>()
  for (const p of input.start) for (const i of p) current.add(i)
  if (current.size > budgetCells) fail(`refineLine: the starting line has ${current.size} cells, over the budget of ${budgetCells}`)
  const asCells = (s: Set<number>) => Int32Array.from(s).sort()
  let evaluations = 1
  let trapped = evaluate(asCells(current))
  let dropped = 0
  for (const p of [...input.start].sort((a, b) => a.length - b.length)) {
    const trial = new Set(current)
    for (const i of p) trial.delete(i)
    if (trial.size === current.size) continue
    const t = evaluate(asCells(trial))
    evaluations++
    if (t <= trapped + tolerance) {
      for (const i of p) current.delete(i)
      trapped = Math.min(trapped, t)
      dropped++
    }
  }
  let added = 0
  for (let round = 0; round < input.maxAddRounds; round++) {
    let best: Int32Array | null = null
    let bestRate = 0
    let bestTrapped = trapped
    for (const p of input.pool) {
      let extra = 0
      for (const i of p) if (!current.has(i)) extra++
      if (extra === 0 || current.size + extra > budgetCells) continue
      const trial = new Set(current)
      for (const i of p) trial.add(i)
      const t = evaluate(asCells(trial))
      evaluations++
      const rate = (trapped - t) / extra
      if (trapped - t > tolerance && rate > bestRate) {
        best = p
        bestRate = rate
        bestTrapped = t
      }
    }
    if (!best) break
    for (const i of best) current.add(i)
    trapped = bestTrapped
    added++
  }
  return { cells: asCells(current), trapped, evaluations, dropped, added }
}
