// Evacuation simulation over a fire arrival field. See MODEL.md for the model and its assumptions.
import { HOUSEHOLD, ROAD, type EvacEdits, type EvacInput, type EvacParams, type EvacResult } from '../types'
import { makeLognormalCdf } from './lognormal'
import { minFilterOctagon, octagonWindow } from './minfilter'
import { asPrepared, buildCsr, sampleSegment, type Csr, type Prepared } from './prepare'

/** EvacResult plus the user's emergency links (appended edges are not in edgeFlow/edgeClosesMin, whose
 *  length is the original edgeCount). Index i matches edits.addedLinks[i]. */
export interface EvacResultExt extends EvacResult {
  addedLinkFlow: Float32Array
  addedLinkClosesMin: Float32Array
  /** Buildings with no drivable way out near them (no car node within CAR_SNAP_MAX_M, or the user's
   *  closures cut it off): their car share walks. */
  carHouseholdsWalking: number
  /** Buildings where the fire comes within cueRadiusM before the alert (their cue responders, a share
   *  cueShare of them, start before the alert); 0 when cues are off. */
  buildingsCuedBeforeAlert: number
}

/** Emergency links are this much longer than the straight line between their nodes. */
export const ADDED_LINK_DETOUR = 1.3
/** Resolution of the riskByAlert curve (min) and of its departure-time histogram (min). */
const ALERT_STEP_MIN = 10
const CURVE_BIN_MIN = 0.1
/** Sanity bound on the fire's time span (3 days); beyond it arrivalMin is assumed to use a sentinel. */
const MAX_HORIZON_MIN = 3 * 24 * 60
/** Car households walk to their car: access time is capped at this (the car is at home). */
const CAR_ACCESS_CAP_MIN = 1

const fail = (msg: string): never => {
  throw new Error(`simulateEvac: ${msg}`)
}

/** km/h -> minutes per metre */
const minPerM = (kmh: number) => 0.06 / kmh

function validateParams(p: EvacParams) {
  if (!p) fail('params is missing')
  const finite = (k: keyof EvacParams, v: number, ok: (v: number) => boolean, rule: string) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || !ok(v)) fail(`params.${k} = ${v}: must be ${rule}`)
  }
  finite('alertMin', p.alertMin, () => true, 'finite')
  finite('prepMedianMin', p.prepMedianMin, (v) => v > 0, '> 0')
  finite('prepSigma', p.prepSigma, (v) => v > 0, '> 0')
  finite('footShare', p.footShare, (v) => v >= 0 && v <= 1, 'in [0, 1]')
  finite('walkKmh', p.walkKmh, (v) => v > 0, '> 0')
  finite('safetyMarginMin', p.safetyMarginMin, (v) => v >= 0, '>= 0')
  finite('safeDistanceM', p.safeDistanceM, (v) => v >= 0, '>= 0')
  finite('personsPerHousehold', p.personsPerHousehold, (v) => v > 0, '> 0')
  finite('cueRadiusM', p.cueRadiusM, (v) => v >= 0, '>= 0')
  finite('cueShare', p.cueShare, (v) => v >= 0 && v <= 1, 'in [0, 1]')
  const nCls = ROAD.PATH + 1
  if (!Array.isArray(p.carKmhByClass) || p.carKmhByClass.length !== nCls)
    fail(`params.carKmhByClass must have ${nCls} entries (one per ROAD class)`)
  for (let c = 0; c < nCls; c++) {
    const v = p.carKmhByClass[c]
    if (c === ROAD.PATH) {
      if (!Number.isFinite(v)) fail(`params.carKmhByClass[PATH] = ${v}: must be finite (it is ignored: PATH is foot-only)`)
    } else if (!(Number.isFinite(v) && v > 0)) fail(`params.carKmhByClass[${c}] = ${v}: must be > 0`)
  }
}

/** min over each cell and its 8 neighbours (separable 3x3 min filter). Throws on NaN and -Infinity. */
function dilateMin3x3(a: Float32Array, rows: number, cols: number): { dil: Float32Array; maxFinite: number } {
  const tmp = new Float32Array(a.length)
  let maxFinite = -Infinity
  for (let r = 0; r < rows; r++) {
    const base = r * cols
    for (let c = 0; c < cols; c++) {
      const i = base + c
      const v = a[i]
      if (v !== v) fail(`arrivalMin[${i}] is NaN`)
      if (v === -Infinity) fail(`arrivalMin[${i}] is -Infinity`)
      if (v !== Infinity && v > maxFinite) maxFinite = v
      let m = v
      if (c > 0 && a[i - 1] < m) m = a[i - 1]
      if (c < cols - 1 && a[i + 1] < m) m = a[i + 1]
      tmp[i] = m
    }
  }
  const dil = new Float32Array(a.length)
  for (let r = 0; r < rows; r++) {
    const base = r * cols
    for (let c = 0; c < cols; c++) {
      const i = base + c
      let m = tmp[i]
      if (r > 0 && tmp[i - cols] < m) m = tmp[i - cols]
      if (r < rows - 1 && tmp[i + cols] < m) m = tmp[i + cols]
      dil[i] = m
    }
  }
  return { dil, maxFinite }
}

/** Binary max-heap of (key, node) with lazy deletion. */
export class MaxHeap {
  keys: Float64Array
  vals: Int32Array
  size = 0
  constructor(cap: number) {
    this.keys = new Float64Array(Math.max(16, cap))
    this.vals = new Int32Array(Math.max(16, cap))
  }
  push(v: number, k: number) {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2)
      nk.set(this.keys)
      const nv = new Int32Array(this.size * 2)
      nv.set(this.vals)
      this.keys = nk
      this.vals = nv
    }
    const { keys, vals } = this
    let i = this.size++
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] >= k) break
      keys[i] = keys[p]
      vals[i] = vals[p]
      i = p
    }
    keys[i] = k
    vals[i] = v
  }
  /** Removes the max; its key is left in `poppedKey`. */
  poppedKey = 0
  pop(): number {
    const { keys, vals } = this
    const top = vals[0]
    this.poppedKey = keys[0]
    const n = --this.size
    if (n > 0) {
      const k = keys[n]
      const v = vals[n]
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && keys[c + 1] > keys[c]) c++
        if (keys[c] <= k) break
        keys[i] = keys[c]
        vals[i] = vals[c]
        i = c
      }
      keys[i] = k
      vals[i] = v
    }
    return top
  }
}

export interface Labels {
  /** Latest departure time from each node that still reaches a safe node (min since t0). */
  L: Float64Array
  /** Edge / node of the next hop towards safety, -1 if none. */
  nextEdge: Int32Array
  nextNode: Int32Array
  /** Nodes in the order they were settled (decreasing L); a node's next hop is settled before it. */
  order: Int32Array
  nOrder: number
}

/** L(safe) = +Inf; L(u) = min(deadline(u), max over e=(u,v) of (min(L(v), closes(e)) - travel(e))).
 *  Label-setting from the safe nodes in decreasing L (the update never increases a label, so the first
 *  time a node is popped its label is final). */
export function latestDeparture(
  N: number,
  adj: Csr,
  travel: Float64Array,
  closes: Float64Array,
  deadline: Float64Array,
  safe: Int32Array,
  heap: MaxHeap,
): Labels {
  const L = new Float64Array(N).fill(-Infinity)
  const nextEdge = new Int32Array(N).fill(-1)
  const nextNode = new Int32Array(N).fill(-1)
  const done = new Uint8Array(N)
  const order = new Int32Array(N)
  let nOrder = 0
  const { start, edge, node } = adj
  heap.size = 0
  for (let i = 0; i < safe.length; i++) {
    L[safe[i]] = Infinity
    heap.push(safe[i], Infinity)
  }
  while (heap.size > 0) {
    const v = heap.pop()
    if (done[v] || heap.poppedKey < L[v]) continue
    done[v] = 1
    order[nOrder++] = v
    const lv = L[v]
    for (let k = start[v]; k < start[v + 1]; k++) {
      const u = node[k]
      if (done[u]) continue
      const e = edge[k]
      const t = travel[e]
      if (t === Infinity) continue // not usable in this mode
      const c = closes[e]
      let cand = (lv < c ? lv : c) - t // -Infinity for user-closed edges: never improves
      if (cand > deadline[u]) cand = deadline[u]
      if (cand > L[u]) {
        L[u] = cand
        nextEdge[u] = e
        nextNode[u] = v
        heap.push(u, cand)
      }
    }
  }
  return { L, nextEdge, nextNode, order, nOrder }
}

interface Components {
  comp: Int32Array
  /** Per component: the fire touches it (a node deadline or an edge closure is finite). */
  threatened: Uint8Array
  /** Per component: it has a street (2+ nodes) and holds a node at least safeDistanceM from wildland
   *  (burning or not), i.e. this mode has a way out of it in the street network. */
  wayOut: Uint8Array
}

/** Connected components of this mode's graph (usable edges, without user-closed ones, with added links). */
function components(
  N: number,
  adj: Csr,
  travel: Float64Array,
  closes: Float64Array,
  closesFire: Float64Array,
  deadline: Float64Array,
  candidate: Uint8Array,
): Components {
  const comp = new Int32Array(N).fill(-1)
  const threatened: number[] = []
  const wayOut: number[] = []
  const stack = new Int32Array(N)
  const { start, edge, node } = adj
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0) continue
    const id = threatened.length
    let thr = 0
    let cand = 0
    let size = 0
    let sp = 0
    stack[sp++] = s
    comp[s] = id
    while (sp > 0) {
      const u = stack[--sp]
      size++
      if (deadline[u] !== Infinity) thr = 1
      cand |= candidate[u]
      for (let k = start[u]; k < start[u + 1]; k++) {
        const e = edge[k]
        if (travel[e] === Infinity || closes[e] === -Infinity) continue
        if (closesFire[e] !== Infinity) thr = 1
        const v = node[k]
        if (comp[v] < 0) {
          comp[v] = id
          stack[sp++] = v
        }
      }
    }
    threatened.push(thr)
    wayOut.push(size > 1 ? cand : 0)
  }
  return { comp, threatened: Uint8Array.from(threatened), wayOut: Uint8Array.from(wayOut) }
}

function validateEdits(edits: EvacEdits, N: number, E: number) {
  if (!edits || !Array.isArray(edits.closedEdges) || !Array.isArray(edits.addedLinks))
    fail('edits must have closedEdges[] and addedLinks[]')
  for (const e of edits.closedEdges)
    if (!Number.isInteger(e) || e < 0 || e >= E) fail(`closed edge ${e} out of range [0, ${E})`)
  edits.addedLinks.forEach((l, i) => {
    if (!l || !Number.isInteger(l.u) || l.u < 0 || l.u >= N || !Number.isInteger(l.v) || l.v < 0 || l.v >= N)
      fail(`added link ${i} has node indices out of range [0, ${N})`)
    if (l.u === l.v) fail(`added link ${i} connects node ${l.u} to itself`)
  })
}

/** Cue responders, for riskByAlert: a share of the households starts at min(alert, cueMin). */
interface CurveCues {
  share: number
  /** Per building: earliest fire arrival within cueRadiusM of it (Infinity if none). */
  cueMin: Float64Array
}

/** Expected trapped households if the alert had been at 0, 10, 20, ... horizon min. Departure deadlines
 *  D do not depend on the alert, so this bins D (CURVE_BIN_MIN) per mode and correlates the histogram
 *  with a tabulated lognormal CDF.
 *  With cues, the responders' term at alert j splits the buildings by their cue time, binned the same
 *  way (q bins): those not cued yet (j * S <= q) start at the alert, like everyone else (a second
 *  histogram, filled while sweeping j downwards); those cued before keep their risk at the cue time
 *  (prefix sums). Each building's risk is then exactly non-decreasing in j. */
function riskCurve(
  nB: number,
  horizonMin: number,
  modes: { share: number; D: Float64Array }[],
  prepMedianMin: number,
  prepSigma: number,
  cues: CurveCues | null,
): { alertMin: number; expectedTrappedHouseholds: number }[] {
  const nAlerts = Math.floor(horizonMin / ALERT_STEP_MIN) + 1
  const S = Math.round(ALERT_STEP_MIN / CURVE_BIN_MIN)
  const out = new Float64Array(nAlerts)
  const alertShare = cues ? 1 - cues.share : 1
  // Cue responders: building b is not cued yet at alert j while j <= u[b] = floor(q / S) (capped at the
  // last alert; -1 for a cue before t0). Buildings sorted by u (counting sort): bucket B = u + 1 spans
  // byU[uStart[B] .. uStart[B + 1]).
  let qBin: Float64Array | null = null
  let byU: Int32Array | null = null
  let uStart: Int32Array | null = null
  if (cues) {
    qBin = new Float64Array(nB)
    const u = new Int32Array(nB)
    uStart = new Int32Array(nAlerts + 2)
    for (let b = 0; b < nB; b++) {
      const q = Math.floor(cues.cueMin[b] / CURVE_BIN_MIN) // Infinity stays Infinity
      qBin[b] = q
      u[b] = q < 0 ? -1 : Math.min(nAlerts - 1, Math.floor(q / S))
      uStart[u[b] + 2]++
    }
    for (let B = 0; B <= nAlerts; B++) uStart[B + 1] += uStart[B]
    byU = new Int32Array(nB)
    const pos = uStart.slice()
    for (let b = 0; b < nB; b++) byU[pos[u[b] + 1]++] = b
  }
  for (const { share, D } of modes) {
    let maxD = 0
    let infCount = 0
    for (let b = 0; b < nB; b++) {
      const d = D[b]
      if (d === Infinity) infCount++
      else if (d > maxD) maxD = d
    }
    const nBins = Math.floor(maxD / CURVE_BIN_MIN) + 1
    const hist = new Float64Array(nBins)
    for (let b = 0; b < nB; b++) {
      const d = D[b]
      if (d > 0 && d !== Infinity) hist[Math.floor(d / CURVE_BIN_MIN)]++
    }
    const F = new Float64Array(nBins)
    const cdf = makeLognormalCdf(prepMedianMin, prepSigma)
    for (let i = 0; i < nBins; i++) F[i] = cdf((i + 0.5) * CURVE_BIN_MIN)
    for (let j = 0; j < nAlerts; j++) {
      const o = j * S
      let gotOut = infCount
      for (let k = o; k < nBins; k++) gotOut += hist[k] * F[k - o]
      out[j] += alertShare * share * (nB - gotOut)
    }
    if (!cues || !qBin || !byU || !uStart) continue
    // Responders cued before alert j (u < j): their risk at the cue time, summed per bucket. D and the
    // cue are both taken at their bin centres, so their difference is a whole number of bins: G[i] is
    // the CDF at i bins (G[k - q] <= F[k - j S] for j S <= q keeps each building monotone).
    const G = new Float64Array(nBins)
    for (let i = 0; i < nBins; i++) G[i] = cdf(i * CURVE_BIN_MIN)
    const cued = new Float64Array(nAlerts)
    for (let B = 0; B < nAlerts; B++) {
      let sum = 0
      for (let i = uStart[B]; i < uStart[B + 1]; i++) {
        const b = byU[i]
        const d = D[b]
        if (d === Infinity) continue
        const q = qBin[b]
        if (q < 0) sum += 1 - cdf(d - cues.cueMin[b]) // cue before t0: never compared with an alert
        else if (d <= 0) sum += 1
        else {
          const idx = Math.floor(d / CURVE_BIN_MIN) - q
          sum += idx <= 0 ? 1 : 1 - G[idx]
        }
      }
      cued[B] = sum
    }
    // Responders not cued yet at alert j (u >= j): same histogram correlation, on a histogram that
    // gains bucket u = j as j goes down.
    const hist2 = new Float64Array(nBins)
    const uncued = new Float64Array(nAlerts)
    let n2 = 0
    let inf2 = 0
    for (let j = nAlerts - 1; j >= 0; j--) {
      for (let i = uStart[j + 1]; i < uStart[j + 2]; i++) {
        const d = D[byU[i]]
        n2++
        if (d === Infinity) inf2++
        else if (d > 0) hist2[Math.floor(d / CURVE_BIN_MIN)]++
      }
      const o = j * S
      let gotOut = inf2
      for (let k = o; k < nBins; k++) gotOut += hist2[k] * F[k - o]
      uncued[j] = n2 - gotOut
    }
    const c = cues.share * share
    let cuedSoFar = 0
    for (let j = 0; j < nAlerts; j++) {
      cuedSoFar += cued[j] // buckets B <= j, i.e. u < j
      out[j] += c * (uncued[j] + cuedSoFar)
    }
  }
  const res: { alertMin: number; expectedTrappedHouseholds: number }[] = []
  for (let j = 0; j < nAlerts; j++) res.push({ alertMin: j * ALERT_STEP_MIN, expectedTrappedHouseholds: out[j] })
  return res
}

export function simulateEvac(input: EvacInput): EvacResultExt {
  const tStart = performance.now()
  if (!input) fail('input is missing')
  const P: Prepared = asPrepared(input.prepared)
  const { params, edits, arrivalMin } = input
  validateParams(params)
  const N = P.nodeCount
  const E = P.edgeCount
  const nB = P.buildingCount
  const { rows, cols, cellM } = P
  if (!(arrivalMin instanceof Float32Array) || arrivalMin.length !== rows * cols)
    fail(`arrivalMin must be a Float32Array of rows*cols = ${rows * cols} (got ${arrivalMin?.length})`)
  validateEdits(edits, N, E)
  const A = edits.addedLinks.length
  const M = E + A
  const margin = params.safetyMarginMin

  const { dil, maxFinite } = dilateMin3x3(arrivalMin, rows, cols)

  // Edges (original + added): closure time from the fire, then with the user's closures.
  const closesFire = new Float64Array(M)
  const lenM = new Float64Array(M)
  const cls = new Uint8Array(M)
  for (let e = 0; e < E; e++) {
    let m = Infinity
    for (let k = P.edgeCellStart[e]; k < P.edgeCellStart[e + 1]; k++) {
      const d = dil[P.edgeCells[k]]
      if (d < m) m = d
    }
    closesFire[e] = m - margin
    lenM[e] = P.edgeLenM[e]
    cls[e] = P.edgeCls[e]
  }
  const linkCells: number[] = []
  for (let i = 0; i < A; i++) {
    const { u, v } = edits.addedLinks[i]
    const x0 = P.nodeX[u]
    const y0 = P.nodeY[u]
    const x1 = P.nodeX[v]
    const y1 = P.nodeY[v]
    linkCells.length = 0
    sampleSegment(x0, y0, x1, y1, cellM, rows, cols, linkCells, -1)
    let m = Infinity
    for (const c of linkCells) if (dil[c] < m) m = dil[c]
    closesFire[E + i] = m - margin
    lenM[E + i] = ADDED_LINK_DETOUR * Math.hypot(x1 - x0, y1 - y0)
    cls[E + i] = ROAD.LOCAL
  }
  const closes = closesFire.slice()
  for (const e of edits.closedEdges) closes[e] = -Infinity

  let adj = P.adj
  if (A > 0) {
    const us = new Int32Array(M)
    const vs = new Int32Array(M)
    us.set(P.edgeU)
    vs.set(P.edgeV)
    for (let i = 0; i < A; i++) {
      us[E + i] = edits.addedLinks[i].u
      vs[E + i] = edits.addedLinks[i].v
    }
    adj = buildCsr(N, us, vs)
  }

  // Nodes: deadline and safe destinations.
  const deadline = new Float64Array(N)
  const candidate = new Uint8Array(N)
  const safeList: number[] = []
  for (let i = 0; i < N; i++) {
    const c = P.nodeCell[i]
    const d = c < 0 ? Infinity : dil[c]
    deadline[i] = d - margin
    candidate[i] = P.nodeWildM[i] >= params.safeDistanceM ? 1 : 0
    if (d === Infinity && candidate[i]) safeList.push(i)
  }
  if (safeList.length === 0)
    fail(
      `no safe destination: no street node is at least ${params.safeDistanceM} m from wildland with its cell ` +
        'and neighbours unburned (lower safeDistanceM)',
    )
  const safe = Int32Array.from(safeList)

  // Latest departure per mode.
  const footShare = params.footShare
  const carShare = 1 - footShare
  const heap = new MaxHeap(2 * M + N)
  const solve = (travel: Float64Array): { lab: Labels; cc: Components } => {
    const lab = latestDeparture(N, adj, travel, closes, deadline, safe, heap)
    const cc = components(N, adj, travel, closes, closesFire, deadline, candidate)
    // A component the fire never touches is a refuge in this scenario, even without a safe node in it
    // (otherwise a fire-free pocket, e.g. streets cut off by a user closure, would count as trapped).
    for (let u = 0; u < N; u++) if (lab.L[u] === -Infinity && !cc.threatened[cc.comp[u]]) lab.L[u] = Infinity
    return { lab, cc }
  }
  // Foot is always solved: car households whose street has no drivable way out walk.
  const footTravel = new Float64Array(M)
  for (let e = 0; e < M; e++) footTravel[e] = lenM[e] * minPerM(params.walkKmh)
  const foot = solve(footTravel).lab
  let car: Labels | null = null
  let carCc: Components | null = null
  if (carShare > 0) {
    const travel = new Float64Array(M)
    for (let e = 0; e < M; e++)
      travel[e] = cls[e] === ROAD.PATH ? Infinity : lenM[e] * minPerM(params.carKmhByClass[cls[e]])
    const r = solve(travel)
    car = r.lab
    carCc = r.cc
  }

  // Environmental cues: a share cueShare of the households starts its response when the fire comes within
  // cueRadiusM of the home (earliest arrival in an octagon window around its cell), if before the alert.
  const { alertMin, prepMedianMin, prepSigma } = params
  const cueOn = params.cueShare > 0 && params.cueRadiusM > 0
  const cueShare = cueOn ? params.cueShare : 0
  const cueMin = new Float64Array(cueOn ? nB : 0)
  if (cueOn) {
    const near = minFilterOctagon(arrivalMin, rows, cols, octagonWindow(params.cueRadiusM / cellM))
    for (let b = 0; b < nB; b++) {
      const c = P.bldCell[b]
      cueMin[b] = c < 0 ? Infinity : near[c]
    }
  }

  // Households.
  const walkMinPerM = minPerM(params.walkKmh)
  const cdf = makeLognormalCdf(prepMedianMin, prepSigma)
  const householdRisk = new Float32Array(nB)
  const householdStatus = new Uint8Array(nB)
  const Dfoot = new Float64Array(nB)
  const Dcar = new Float64Array(nB)
  const startFoot = new Float64Array(N)
  const startCar = new Float64Array(N)
  let expectedTrapped = 0
  let buildingsReached = 0
  let carHouseholdsWalking = 0
  let buildingsCuedBeforeAlert = 0
  for (let b = 0; b < nB; b++) {
    const c = P.bldCell[b]
    const arr = c < 0 ? Infinity : arrivalMin[c]
    if (arr !== Infinity) buildingsReached++
    const own = arr - margin
    const n = P.bldNode[b]
    const cn = P.bldCarNode[b]
    const accessFoot = P.bldAccessM[b] * walkMinPerM
    const lf = foot.L[n]
    const dF = Math.min(own, lf - accessFoot)
    let footUsed = footShare > 0
    let risk = footUsed ? footShare * (1 - cdf(dF - alertMin)) : 0
    let dC = dF
    let carUsed = false
    let lc = Infinity
    if (car && carCc) {
      if (cn >= 0 && carCc.wayOut[carCc.comp[cn]]) {
        carUsed = true
        lc = car.L[cn]
        dC = Math.min(own, lc - Math.min(P.bldCarAccessM[b] * walkMinPerM, CAR_ACCESS_CAP_MIN))
      } else {
        footUsed = true // no drivable way out near the house (or the user closed it): the car share walks
        carHouseholdsWalking++
      }
      risk += carShare * (1 - cdf(dC - alertMin))
    }
    if (cueOn && cueMin[b] < alertMin) {
      // Cue responders start at the cue; the others still wait for the alert.
      const cue = cueMin[b]
      buildingsCuedBeforeAlert++
      let riskCue = footShare > 0 ? footShare * (1 - cdf(dF - cue)) : 0
      if (car && carCc) riskCue += carShare * (1 - cdf(dC - cue))
      risk = (1 - cueShare) * risk + cueShare * riskCue
    }
    Dfoot[b] = dF
    Dcar[b] = dC
    householdRisk[b] = risk
    expectedTrapped += risk
    if (arr === Infinity && (!footUsed || lf === Infinity) && (!carUsed || lc === Infinity))
      householdStatus[b] = HOUSEHOLD.UNAFFECTED
    else {
      householdStatus[b] = risk >= 0.5 ? HOUSEHOLD.TRAPPED : risk >= 0.1 ? HOUSEHOLD.AT_RISK : HOUSEHOLD.SAFE
      startFoot[n] += carUsed ? footShare : 1
      if (carUsed) startCar[cn] += carShare
    }
  }

  // Flow of threatened households along each mode's next-hop forest, leaves first (increasing L).
  const flowAll = new Float64Array(M)
  const propagate = (lab: Labels, cnt: Float64Array) => {
    for (let i = lab.nOrder - 1; i >= 0; i--) {
      const u = lab.order[i]
      const w = cnt[u]
      if (w === 0) continue
      const e = lab.nextEdge[u]
      if (e < 0) continue
      flowAll[e] += w
      cnt[lab.nextNode[u]] += w
    }
  }
  propagate(foot, startFoot)
  if (car) propagate(car, startCar)

  const horizonMin = maxFinite > 0 ? Math.ceil(maxFinite / 60) * 60 : 0
  if (horizonMin > MAX_HORIZON_MIN)
    fail(`arrivalMin has finite values up to ${maxFinite} min; unburned cells must be Infinity, not a large number`)
  const curveModes: { share: number; D: Float64Array }[] = []
  if (footShare > 0) curveModes.push({ share: footShare, D: Dfoot })
  if (carShare > 0) curveModes.push({ share: carShare, D: Dcar })
  const riskByAlert = riskCurve(nB, horizonMin, curveModes, prepMedianMin, prepSigma, cueOn ? { share: cueShare, cueMin } : null)

  return {
    householdRisk,
    householdStatus,
    expectedTrappedHouseholds: expectedTrapped,
    expectedTrappedPeople: expectedTrapped * params.personsPerHousehold,
    buildingsReached,
    edgeFlow: Float32Array.from(flowAll.subarray(0, E)),
    edgeClosesMin: Float32Array.from(closes.subarray(0, E)),
    riskByAlert,
    addedLinkFlow: Float32Array.from(flowAll.subarray(E)),
    addedLinkClosesMin: Float32Array.from(closes.subarray(E)),
    carHouseholdsWalking,
    buildingsCuedBeforeAlert,
    elapsedMs: performance.now() - tStart,
  }
}
