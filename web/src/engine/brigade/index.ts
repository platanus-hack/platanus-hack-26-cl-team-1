// Firefighting engine (pass 1 → plan → pass 2, see MODEL.md). Given the fire WITHOUT firefighters, it routes
// every unit from its cuartel (or a reinforcement's entry road) over the street graph, sends it to the most
// threatened sector it reaches before the fire, and turns each unit's work window into a per-cell FireDefense
// for the second fire run. Escala / rescate units act afterwards on the evacuation result (applyRescue).
// Pure TypeScript, no DOM.
import { CellHeap } from '../fire/heap'
import { asPrepared, type Prepared } from '../evac/prepare'
import { dilateMin3x3 } from '../evac/simulate'
import type { BrigadesFile, EvacPrepared, FireDefense, GridMeta, UnitType } from '../types'
import { FUEL, HOUSEHOLD, ROAD, UNIT, UNIT_COUNT } from '../types'
import { FIREFIGHT_MODEL } from './model'

export { FIREFIGHT_MODEL } from './model'

function fail(msg: string): never {
  throw new Error(`brigade: ${msg}`)
}

// -------------------------------------------------------------------------------------------------------
// Graph and routing
// -------------------------------------------------------------------------------------------------------

/** The part of the evacuation engine's prepared graph routing needs (tests build it by hand). */
export interface RouteGraph {
  nodeCount: number
  edgeU: Int32Array
  edgeV: Int32Array
  edgeLenM: Float64Array
  edgeCls: Uint8Array
  adj: { start: Int32Array; edge: Int32Array; node: Int32Array }
}

/** An edge is unusable while [fromMin, toMin) (toMin = Infinity: never reopens). */
export interface CutWindow {
  edge: number
  fromMin: number
  toMin: number
}

export interface Routes {
  /** Earliest arrival per node (minutes since t0), Infinity if unreachable. */
  time: Float64Array
  /** Edge used to reach each node (-1 at a source or unreachable). */
  pred: Int32Array
}

/** Time per edge at which the fire (on or next to it, minus the safety margin) closes it, as the evacuation
 *  engine computes it. */
export function edgeClosuresFromFire(prepared: EvacPrepared, arrivalMin: Float32Array, marginMin: number): Float64Array {
  const P = asPrepared(prepared)
  if (arrivalMin.length !== P.rows * P.cols) fail(`arrivalMin has ${arrivalMin.length} cells, expected ${P.rows * P.cols}`)
  const { dil } = dilateMin3x3(arrivalMin, P.rows, P.cols)
  const closes = new Float64Array(P.edgeCount)
  for (let e = 0; e < P.edgeCount; e++) {
    let m = Infinity
    for (let k = P.edgeCellStart[e]; k < P.edgeCellStart[e + 1]; k++) {
      const d = dil[P.edgeCells[k]]
      if (d < m) m = d
    }
    closes[e] = m - marginMin
  }
  return closes
}

/** Earliest-arrival search at free-flow car speeds from one or more sources (node, departure time). An edge
 *  can be driven only if the whole traversal ends before the fire closes it and does not overlap a cut
 *  window. No waiting at nodes. PATH edges (foot only) are never used. */
export function earliestArrival(
  g: RouteGraph,
  sources: { node: number; tMin: number }[],
  closesMin: Float64Array,
  cuts: CutWindow[],
  carKmhByClass: number[],
): Routes {
  const N = g.nodeCount
  const time = new Float64Array(N).fill(Infinity)
  const pred = new Int32Array(N).fill(-1)
  const cutsByEdge = new Map<number, CutWindow[]>()
  for (const c of cuts) {
    const l = cutsByEdge.get(c.edge)
    if (l) l.push(c)
    else cutsByEdge.set(c.edge, [c])
  }
  const heap = new CellHeap(time)
  const done = new Uint8Array(N)
  for (const s of sources) {
    if (!(s.node >= 0 && s.node < N)) fail(`source node ${s.node} out of range`)
    if (s.tMin < time[s.node]) {
      time[s.node] = s.tMin
      heap.pushOrDecrease(s.node)
    }
  }
  while (heap.size > 0) {
    const u = heap.pop()
    if (done[u]) continue
    done[u] = 1
    const t = time[u]
    for (let k = g.adj.start[u]; k < g.adj.start[u + 1]; k++) {
      const e = g.adj.edge[k]
      const v = g.adj.node[k]
      if (done[v]) continue
      const cls = g.edgeCls[e]
      if (cls === ROAD.PATH) continue
      const kmh = carKmhByClass[cls]
      if (!(kmh > 0)) continue
      const tv = t + g.edgeLenM[e] / ((kmh * 1000) / 60)
      if (tv > closesMin[e]) continue
      const cw = cutsByEdge.get(e)
      if (cw && cw.some((c) => t < c.toMin && tv > c.fromMin)) continue
      if (tv < time[v]) {
        time[v] = tv
        pred[v] = e
        heap.pushOrDecrease(v)
      }
    }
  }
  return { time, pred }
}

/** Edge ids from a source to `node`, in driving order. */
export function pathTo(g: RouteGraph, r: Routes, node: number): number[] {
  const out: number[] = []
  let n = node
  for (let guard = 0; guard <= g.nodeCount && r.pred[n] >= 0; guard++) {
    const e = r.pred[n]
    out.push(e)
    n = g.edgeU[e] === n ? g.edgeV[e] : g.edgeU[e]
  }
  return out.reverse()
}

// -------------------------------------------------------------------------------------------------------
// Settings and plan
// -------------------------------------------------------------------------------------------------------

/** What the user can change (worker/scenario.ts holds it in the Scenario). */
export interface BrigadeSettings {
  /** Units per station id, per UnitType. */
  units: Record<string, number[]>
  /** Departure per cuerpo (minutes since t0). */
  dispatchMin: Record<string, number>
  /** Units per reinforcement id, per UnitType, and its arrival at the map edge (minutes since t0). */
  reinforcementUnits: Record<string, number[]>
  reinforcementMin: Record<string, number>
  /** Apply the historical road cuts of brigades.json. */
  historicalCuts: boolean
}

export type UnitStatus = 'deployed' | 'late' | 'no_access' | 'idle'

export interface PlannedUnit {
  /** Station or reinforcement id. */
  origin: string
  type: UnitType
  departMin: number
  status: UnitStatus
  /** Work site node and sector (-1 unless deployed). */
  siteNode: number
  sector: number
  arriveMin: number
  /** Work window (water); for Escala / rescate, arrival to the horizon. */
  workFromMin: number
  workToMin: number
  /** Edge ids from the origin to the site. */
  path: number[]
}

export interface BrigadePlan {
  defense: FireDefense
  units: PlannedUnit[]
  /** Edges closed by the historical cuts in force (empty if off). */
  cutEdges: number[]
  /** Cells with a defence window. */
  defendedCells: number
}

export interface BrigadeInput {
  prepared: EvacPrepared
  grid: GridMeta
  fuel: Uint8Array
  /** Pass-1 fire (no firefighters). */
  arrivalMin: Float32Array
  file: BrigadesFile
  settings: BrigadeSettings
  /** Minutes since t0 of the file's local times (data/time.ts localToMin bound to t0). */
  toMin: (local: string) => number
  safetyMarginMin: number
  carKmhByClass: number[]
  horizonMin: number
}

const WILDLAND = new Set<number>([FUEL.GRASS, FUEL.SHRUB, FUEL.FOREST, FUEL.CROP])
const URBAN = new Set<number>([FUEL.URBAN_LOW, FUEL.URBAN_DENSE])

/** Nearest node with at least one drivable (non-PATH) edge to grid metres (x, y). */
function nearestDrivable(P: Prepared, x: number, y: number): number {
  let best = -1
  let bd = Infinity
  for (let n = 0; n < P.nodeCount; n++) {
    let ok = false
    for (let k = P.adj.start[n]; k < P.adj.start[n + 1]; k++)
      if (P.edgeCls[P.adj.edge[k]] !== ROAD.PATH) {
        ok = true
        break
      }
    if (!ok) continue
    const d = (P.nodeX[n] - x) ** 2 + (P.nodeY[n] - y) ** 2
    if (d < bd) {
      bd = d
      best = n
    }
  }
  if (best < 0) fail('the street graph has no drivable node')
  return best
}

function toXY(g: GridMeta, lon: number, lat: number): [number, number] {
  return [((lon - g.lonMin) / g.dLon) * g.cellM, ((g.latMax - lat) / g.dLat) * g.cellM]
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const L = dx * dx + dy * dy
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** MOTORWAY / PRIMARY edges whose midpoint lies within cutSnapM of one of the cut's polylines. */
export function snapCut(prepared: EvacPrepared, g: GridMeta, lines: [number, number][][]): number[] {
  const P = asPrepared(prepared)
  const segs = lines.map((l) => l.map(([lon, lat]) => toXY(g, lon, lat)))
  const tol = FIREFIGHT_MODEL.cutSnapM
  const out: number[] = []
  for (let e = 0; e < P.edgeCount; e++) {
    const cls = P.edgeCls[e]
    if (cls !== ROAD.MOTORWAY && cls !== ROAD.PRIMARY) continue
    const mx = (P.nodeX[P.edgeU[e]] + P.nodeX[P.edgeV[e]]) / 2
    const my = (P.nodeY[P.edgeU[e]] + P.nodeY[P.edgeV[e]]) / 2
    let hit = false
    for (const l of segs) {
      for (let i = 0; i + 1 < l.length && !hit; i++) if (distToSegment(mx, my, l[i][0], l[i][1], l[i + 1][0], l[i + 1][1]) <= tol) hit = true
      if (hit) break
    }
    if (hit) out.push(e)
  }
  return out
}

interface Sector {
  id: number
  /** Arrival (pass 1) of each threatened building, ascending. */
  arrivals: Float64Array
  siteNode: number
  siteCell: number
}

/** Buildings per sector the pass-1 fire reaches, and each sector's work site (the drivable node of the
 *  threatened building nearest the sector's threatened-building centroid). */
function buildSectors(P: Prepared, arrivalMin: Float32Array): Sector[] {
  const S = FIREFIGHT_MODEL.sectorCells
  const scols = Math.ceil(P.cols / S)
  const by = new Map<number, number[]>()
  for (let b = 0; b < P.buildingCount; b++) {
    const c = P.bldCell[b]
    if (c < 0 || P.bldCarNode[b] < 0 || !Number.isFinite(arrivalMin[c])) continue
    const r = Math.floor(c / P.cols)
    const col = c - r * P.cols
    const s = Math.floor(r / S) * scols + Math.floor(col / S)
    const l = by.get(s)
    if (l) l.push(b)
    else by.set(s, [b])
  }
  const out: Sector[] = []
  for (const [id, bs] of by) {
    let cx = 0
    let cy = 0
    for (const b of bs) {
      const c = P.bldCell[b]
      cx += (c % P.cols) + 0.5
      cy += Math.floor(c / P.cols) + 0.5
    }
    cx /= bs.length
    cy /= bs.length
    let best = bs[0]
    let bd = Infinity
    for (const b of bs) {
      const c = P.bldCell[b]
      const d = ((c % P.cols) + 0.5 - cx) ** 2 + (Math.floor(c / P.cols) + 0.5 - cy) ** 2
      if (d < bd) {
        bd = d
        best = b
      }
    }
    const siteNode = P.bldCarNode[best]
    const arrivals = Float64Array.from(bs.map((b) => arrivalMin[P.bldCell[b]])).sort()
    out.push({ id, arrivals, siteNode, siteCell: P.nodeCell[siteNode] >= 0 ? P.nodeCell[siteNode] : P.bldCell[best] })
  }
  out.sort((a, b) => a.id - b.id)
  return out
}

/** Threatened buildings of a sector not yet reached at time t. */
function valueAt(s: Sector, t: number): number {
  let lo = 0
  let hi = s.arrivals.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (s.arrivals[m] <= t) lo = m + 1
    else hi = m
  }
  return s.arrivals.length - lo
}

function checkUnits(what: string, u: number[] | undefined): number[] {
  if (!u || u.length !== UNIT_COUNT || !u.every((x) => Number.isInteger(x) && x >= 0))
    fail(`${what}: units must be ${UNIT_COUNT} non-negative integers (got ${JSON.stringify(u)})`)
  return u
}

export function planBrigades(input: BrigadeInput): BrigadePlan {
  const P = asPrepared(input.prepared)
  const { grid, fuel, arrivalMin, file, settings, toMin, horizonMin } = input
  const n = P.rows * P.cols
  if (fuel.length !== n || arrivalMin.length !== n) fail('fuel / arrivalMin do not match the prepared grid')

  const closes = edgeClosuresFromFire(P, arrivalMin, input.safetyMarginMin)
  const cuts: CutWindow[] = []
  const cutEdges: number[] = []
  if (settings.historicalCuts) {
    for (const c of file.cuts) {
      const from = toMin(c.fromLocal)
      const to = c.toLocal === null ? Infinity : toMin(c.toLocal)
      const edges = snapCut(P, grid, c.lines)
      if (edges.length === 0) fail(`historical cut "${c.label}" (${c.id}) matches no motorway or primary road within ${FIREFIGHT_MODEL.cutSnapM} m of its line`)
      for (const e of edges) {
        cuts.push({ edge: e, fromMin: from, toMin: to })
        cutEdges.push(e)
      }
    }
  }

  // Units, in departure order (file order breaks ties).
  interface U {
    origin: string
    type: UnitType
    depart: number
    sources: { node: number; tMin: number }[]
  }
  const units: U[] = []
  for (const s of file.stations) {
    const u = checkUnits(`station ${s.id}`, settings.units[s.id])
    const depart = settings.dispatchMin[s.cuerpo]
    if (!Number.isFinite(depart)) fail(`no dispatch time for cuerpo ${s.cuerpo}`)
    const node = nearestDrivable(P, ...toXY(grid, s.lon, s.lat))
    for (let k = 0; k < UNIT_COUNT; k++) for (let i = 0; i < u[k]; i++) units.push({ origin: s.id, type: k as UnitType, depart, sources: [{ node, tMin: depart }] })
  }
  for (const r of file.reinforcements) {
    const u = checkUnits(`reinforcement ${r.id}`, settings.reinforcementUnits[r.id])
    const depart = settings.reinforcementMin[r.id]
    if (!Number.isFinite(depart)) fail(`no arrival time for reinforcement ${r.id}`)
    const sources = r.entries.map((e) => ({ node: nearestDrivable(P, ...toXY(grid, e.lon, e.lat)), tMin: depart + e.delayMin }))
    for (let k = 0; k < UNIT_COUNT; k++) for (let i = 0; i < u[k]; i++) units.push({ origin: r.id, type: k as UnitType, depart, sources })
  }
  units.sort((a, b) => a.depart - b.depart)

  const sectors = buildSectors(P, arrivalMin)
  const routes = new Map<string, Routes>()
  const sameType = new Map<number, number[]>() // sector id -> units per type already there
  const planned: PlannedUnit[] = []
  for (const u of units) {
    let r = routes.get(u.origin)
    if (!r) {
      r = earliestArrival(P, u.sources, closes, cuts, input.carKmhByClass)
      routes.set(u.origin, r)
    }
    let best: Sector | null = null
    let bestScore = 0
    let bestT = Infinity
    let anyReach = false
    for (const s of sectors) {
      const t = r.time[s.siteNode]
      if (!Number.isFinite(t) || t > horizonMin) continue
      anyReach = true
      const v = valueAt(s, t)
      if (v === 0) continue
      const score = v / (1 + (sameType.get(s.id)?.[u.type] ?? 0))
      if (score > bestScore || (score === bestScore && t < bestT)) {
        best = s
        bestScore = score
        bestT = t
      }
    }
    const base = { origin: u.origin, type: u.type, departMin: u.depart, siteNode: -1, sector: -1, arriveMin: Infinity, workFromMin: Infinity, workToMin: Infinity, path: [] as number[] }
    if (!best) {
      planned.push({ ...base, status: sectors.length === 0 ? 'idle' : anyReach ? 'late' : 'no_access' })
      continue
    }
    const st = sameType.get(best.id) ?? [0, 0, 0, 0]
    st[u.type]++
    sameType.set(best.id, st)
    planned.push({ ...base, status: 'deployed', siteNode: best.siteNode, sector: best.id, arriveMin: bestT, path: pathTo(P, r, best.siteNode) })
  }

  // Work windows. A unit engages when the pass-1 fire first comes within its radius (or on arrival if the
  // fire is already there); its water lasts tank / flow, plus an equal share of the aljibes at its site.
  const M = FIREFIGHT_MODEL
  const flow = M.flowLPerMin.value
  const aljibeL = new Map<number, number>()
  const users = new Map<number, number>()
  for (const p of planned) {
    if (p.status !== 'deployed') continue
    if (p.type === UNIT.ALJIBE) aljibeL.set(p.sector, (aljibeL.get(p.sector) ?? 0) + M.tankL[UNIT.ALJIBE].value)
    if (p.type === UNIT.BOMBA || p.type === UNIT.FORESTAL) users.set(p.sector, (users.get(p.sector) ?? 0) + 1)
  }
  const fromMin = new Float32Array(n).fill(Infinity)
  const toMinArr = new Float32Array(n).fill(-Infinity)
  const maxKwM = new Float32Array(n).fill(Infinity)
  const siteCellOf = new Map(sectors.map((s) => [s.id, s.siteCell]))
  for (const p of planned) {
    if (p.status !== 'deployed') continue
    if (p.type === UNIT.RESCATE) {
      p.workFromMin = p.arriveMin
      p.workToMin = horizonMin
      continue
    }
    if (p.type === UNIT.ALJIBE) {
      p.workFromMin = p.arriveMin
      p.workToMin = p.arriveMin
      continue
    }
    const radiusM = p.type === UNIT.BOMBA ? M.bombaRadiusM.value : M.forestalRadiusM.value
    const rc = Math.round(radiusM / grid.cellM)
    const site = siteCellOf.get(p.sector)!
    const r0 = Math.floor(site / P.cols)
    const c0 = site - r0 * P.cols
    const target = p.type === UNIT.BOMBA ? URBAN : WILDLAND
    const cells: number[] = []
    let firstFire = Infinity
    for (let dr = -rc; dr <= rc; dr++)
      for (let dc = -rc; dc <= rc; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || c < 0 || r >= P.rows || c >= P.cols) continue
        const i = r * P.cols + c
        if (!target.has(fuel[i])) continue
        cells.push(i)
        if (arrivalMin[i] < firstFire) firstFire = arrivalMin[i]
      }
    const water = M.tankL[p.type].value + (aljibeL.get(p.sector) ?? 0) / (users.get(p.sector) ?? 1)
    p.workFromMin = Math.max(p.arriveMin, Number.isFinite(firstFire) ? firstFire : p.arriveMin)
    p.workToMin = p.workFromMin + water / flow
    const cap = p.type === UNIT.BOMBA ? Infinity : M.directAttackMaxKwM.value
    for (const i of cells) {
      // Overlapping windows merge; a disjoint later window is dropped (one window per cell).
      if (fromMin[i] === Infinity || (p.workFromMin <= toMinArr[i] && p.workToMin >= fromMin[i])) {
        fromMin[i] = Math.min(fromMin[i], p.workFromMin)
        toMinArr[i] = Math.max(toMinArr[i], p.workToMin)
        maxKwM[i] = cap // Bomba cells are urban and Forestal cells wildland: a cell only ever gets one kind
      }
    }
  }
  let defendedCells = 0
  for (let i = 0; i < n; i++) {
    if (fromMin[i] === Infinity) {
      toMinArr[i] = Infinity
      maxKwM[i] = Infinity
    } else defendedCells++
  }
  return { defense: { fromMin, toMin: toMinArr, maxKwM }, units: planned, cutEdges, defendedCells }
}

// -------------------------------------------------------------------------------------------------------
// Rescue (after the pass-2 evacuation)
// -------------------------------------------------------------------------------------------------------

export interface RescueResult {
  householdRisk: Float32Array
  householdStatus: Uint8Array
  expectedTrappedHouseholds: number
  /** Expected households taken out by Escala / rescate units (sum of the risk they removed). */
  rescuedExpected: number
}

/** Each deployed Escala / rescate unit takes out, from its arrival to the horizon, up to rescuePerHour
 *  households per hour among those within rescueRadiusM of its site, highest risk first: their risk
 *  becomes 0. */
export function applyRescue(
  prepared: EvacPrepared,
  risk: Float32Array,
  status: Uint8Array,
  units: PlannedUnit[],
  horizonMin: number,
  /** The evacuation's expectedTrappedHouseholds (kept exact when nobody is rescued). */
  evacExpectedTrapped: number,
): RescueResult {
  const P = asPrepared(prepared)
  if (risk.length !== P.buildingCount || status.length !== P.buildingCount) fail('risk / status do not match the buildings')
  const out = risk.slice()
  const st = status.slice()
  const M = FIREFIGHT_MODEL
  const R2 = M.rescueRadiusM.value ** 2
  let rescued = 0
  for (const u of units) {
    if (u.type !== UNIT.RESCATE || u.status !== 'deployed') continue
    const cap = Math.floor((M.rescuePerHour.value * Math.max(0, horizonMin - u.arriveMin)) / 60)
    if (cap <= 0) continue
    const sx = P.nodeX[u.siteNode]
    const sy = P.nodeY[u.siteNode]
    const cand: number[] = []
    for (let b = 0; b < P.buildingCount; b++) {
      if (!(out[b] > 0)) continue
      const c = P.bldCell[b]
      if (c < 0) continue
      const x = ((c % P.cols) + 0.5) * P.cellM
      const y = (Math.floor(c / P.cols) + 0.5) * P.cellM
      if ((x - sx) ** 2 + (y - sy) ** 2 <= R2) cand.push(b)
    }
    cand.sort((a, b) => out[b] - out[a] || a - b)
    for (const b of cand.slice(0, cap)) {
      rescued += out[b]
      out[b] = 0
      if (st[b] !== HOUSEHOLD.UNAFFECTED) st[b] = HOUSEHOLD.SAFE
    }
  }
  return { householdRisk: out, householdStatus: st, expectedTrappedHouseholds: evacExpectedTrapped - rescued, rescuedExpected: rescued }
}
