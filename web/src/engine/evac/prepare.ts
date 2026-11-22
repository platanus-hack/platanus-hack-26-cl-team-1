// Fire-independent precomputation for the evacuation engine: projection, CSR adjacency, edge -> cells,
// node -> cell, distance to wildland, building -> nearest node. See MODEL.md.
import { FUEL, ROAD, type EvacParams, type EvacPrepared, type GridMeta, type RoadsFile } from '../types'

export const PREPARED_KIND = 'cortafuego-evac-v1'

/** Undirected graph in CSR form: the incident edges of node u are edge[start[u] .. start[u+1]-1], and
 *  node[k] is the other end of edge[k]. */
export interface Csr {
  start: Int32Array
  edge: Int32Array
  node: Int32Array
}

/** What prepareEvac returns (typed view of EvacPrepared). */
export interface Prepared extends EvacPrepared {
  kind: typeof PREPARED_KIND
  buildingCount: number
  rows: number
  cols: number
  cellM: number
  /** safeDistanceM given to prepareEvac (simulateEvac re-applies params.safeDistanceM on nodeWildM). */
  safeDistanceM: number
  /** Node position in grid metres: x east of the grid's west edge, y south of its north edge. */
  nodeX: Float64Array
  nodeY: Float64Array
  /** Grid cell of each node, -1 if the node is outside the grid. */
  nodeCell: Int32Array
  /** Distance (m) from the node's cell to the nearest wildland cell; Infinity outside the grid or when
   *  the grid has no wildland. */
  nodeWildM: Float32Array
  edgeU: Int32Array
  edgeV: Int32Array
  edgeLenM: Float64Array
  edgeCls: Uint8Array
  /** Cells each edge passes through (not dilated: simulateEvac uses a 3x3-min arrival field, which is
   *  the same as taking the min over the cells plus their 8 neighbours). */
  edgeCellStart: Int32Array
  edgeCells: Int32Array
  adj: Csr
  /** Grid cell of each building, -1 outside the grid. */
  bldCell: Int32Array
  /** Nearest node and straight-line access distance (m). Only nodes whose connected component holds a
   *  safe-zone candidate are eligible (snapNodes of them), so a building is never attached to a
   *  disconnected fragment (a parking aisle, a street cut by the data clip) nobody can leave. */
  bldNode: Int32Array
  bldAccessM: Float32Array
  /** Nearest node with a drivable edge whose drivable component holds a safe-zone candidate, within
   *  CAR_SNAP_MAX_M (where the household's car is); -1 if none (its car share walks). */
  bldCarNode: Int32Array
  bldCarAccessM: Float32Array
  nodesOutsideGrid: number
  buildingsOutsideGrid: number
  /** Nodes at least safeDistanceM from wildland (before the fire removes the ones that burn). */
  candidateSafeNodes: number
  /** Wildland patches under MIN_WILDLAND_PATCH_HA ignored for the safe-zone distance. */
  smallWildlandPatches: number
  /** Nodes eligible for snapping buildings. */
  snapNodes: number
  snapNodesCar: number
  /** Buildings with no drivable node within CAR_SNAP_MAX_M. */
  buildingsWithoutCarNode: number
  elapsedMs: number
}

const fail = (msg: string): never => {
  throw new Error(`prepareEvac: ${msg}`)
}

const isWildland = (f: number) => f === FUEL.GRASS || f === FUEL.SHRUB || f === FUEL.FOREST || f === FUEL.CROP

/** Growable Int32 buffer. */
class IntBuf {
  a: Int32Array
  n = 0
  constructor(cap: number) {
    this.a = new Int32Array(Math.max(16, cap))
  }
  push(v: number) {
    if (this.n === this.a.length) {
      const b = new Int32Array(this.a.length * 2)
      b.set(this.a)
      this.a = b
    }
    this.a[this.n++] = v
  }
  view(): Int32Array {
    return this.a.slice(0, this.n)
  }
}

export function cellOf(x: number, y: number, cellM: number, rows: number, cols: number): number {
  const c = Math.floor(x / cellM)
  const r = Math.floor(y / cellM)
  if (r < 0 || r >= rows || c < 0 || c >= cols) return -1
  return r * cols + c
}

/** Appends the grid cells along the segment (x0,y0)-(x1,y1), sampled every cellM/2, skipping repeats of
 *  the previous cell. Returns the last cell pushed (or `last` if none). */
export function sampleSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cellM: number,
  rows: number,
  cols: number,
  out: { push(v: number): void },
  last: number,
): number {
  const len = Math.hypot(x1 - x0, y1 - y0)
  const steps = Math.max(1, Math.ceil(len / (cellM / 2)))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const cell = cellOf(x0 + t * (x1 - x0), y0 + t * (y1 - y0), cellM, rows, cols)
    if (cell >= 0 && cell !== last) {
      out.push(cell)
      last = cell
    }
  }
  return last
}

export function buildCsr(n: number, us: Int32Array, vs: Int32Array): Csr {
  const m = us.length
  const start = new Int32Array(n + 1)
  for (let e = 0; e < m; e++) {
    start[us[e] + 1]++
    start[vs[e] + 1]++
  }
  for (let i = 0; i < n; i++) start[i + 1] += start[i]
  const pos = start.slice(0, n)
  const edge = new Int32Array(2 * m)
  const node = new Int32Array(2 * m)
  for (let e = 0; e < m; e++) {
    const u = us[e]
    const v = vs[e]
    edge[pos[u]] = e
    node[pos[u]++] = v
    edge[pos[v]] = e
    node[pos[v]++] = u
  }
  return { start, edge, node }
}

/** Wildland patches (8-connected GRASS/SHRUB/FOREST/CROP cells) smaller than this are urban parks,
 *  gardens or isolated tree clusters: they still burn, but do not count as wildland for the safe-zone
 *  distance. On the real 60 m grid this drops 406 of 436 patches and raises the nodes >= 800 m from
 *  wildland from 175 to about 6,000 (without it, the city centre has almost no safe zone). */
export const MIN_WILDLAND_PATCH_HA = 5

/** Two-pass chamfer distance transform (weights 1 and sqrt 2), in cells, to the nearest cell of a
 *  wildland patch of at least minPatchCells cells. */
export function wildlandDistanceCells(
  fuel: Uint8Array,
  rows: number,
  cols: number,
  minPatchCells: number,
): { dist: Float32Array; ignoredPatches: number } {
  const n = rows * cols
  const d = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const f = fuel[i]
    if (f > FUEL.URBAN_DENSE) fail(`fuel[${i}] = ${f} is not a FUEL code`)
    d[i] = isWildland(f) ? 0 : Infinity
  }
  // Drop small patches: flood-fill each patch, collecting its cells (seen: 1 = visited).
  let ignoredPatches = 0
  if (minPatchCells > 1) {
    const seen = new Uint8Array(n)
    const stack = new Int32Array(n)
    const patch = new Int32Array(n)
    for (let s = 0; s < n; s++) {
      if (d[s] !== 0 || seen[s]) continue
      let sp = 0
      let np = 0
      stack[sp++] = s
      seen[s] = 1
      while (sp > 0) {
        const i = stack[--sp]
        patch[np++] = i
        const r = (i / cols) | 0
        const c = i - r * cols
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr
          if (rr < 0 || rr >= rows) continue
          for (let dc = -1; dc <= 1; dc++) {
            const cc = c + dc
            if (cc < 0 || cc >= cols) continue
            const j = rr * cols + cc
            if (d[j] === 0 && !seen[j]) {
              seen[j] = 1
              stack[sp++] = j
            }
          }
        }
      }
      if (np < minPatchCells) {
        ignoredPatches++
        for (let k = 0; k < np; k++) d[patch[k]] = Infinity
      }
    }
  }
  const D = Math.SQRT2
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      let v = d[i]
      if (v === 0) continue
      if (c > 0 && d[i - 1] + 1 < v) v = d[i - 1] + 1
      if (r > 0) {
        const j = i - cols
        if (d[j] + 1 < v) v = d[j] + 1
        if (c > 0 && d[j - 1] + D < v) v = d[j - 1] + D
        if (c < cols - 1 && d[j + 1] + D < v) v = d[j + 1] + D
      }
      d[i] = v
    }
  }
  for (let r = rows - 1; r >= 0; r--) {
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c
      let v = d[i]
      if (v === 0) continue
      if (c < cols - 1 && d[i + 1] + 1 < v) v = d[i + 1] + 1
      if (r < rows - 1) {
        const j = i + cols
        if (d[j] + 1 < v) v = d[j] + 1
        if (c < cols - 1 && d[j + 1] + D < v) v = d[j + 1] + D
        if (c > 0 && d[j - 1] + D < v) v = d[j - 1] + D
      }
      d[i] = v
    }
  }
  return { dist: d, ignoredPatches }
}

/** A car household's car is at most this far (straight line) from its house; farther, it walks. On the
 *  real data 24k buildings are nearest to a footway node, with a drivable node at a median 53 m. */
export const CAR_SNAP_MAX_M = 300

/** 1 for nodes whose connected component holds at least one `candidate` node (carOnly: PATH edges are
 *  not traversed). */
function componentsWithCandidate(N: number, adj: Csr, candidate: Uint8Array, cls: Uint8Array, carOnly: boolean): Uint8Array {
  const out = new Uint8Array(N)
  const seen = new Uint8Array(N)
  const stack = new Int32Array(N)
  const comp = new Int32Array(N)
  for (let s = 0; s < N; s++) {
    if (seen[s]) continue
    let sp = 0
    let nc = 0
    let has = 0
    stack[sp++] = s
    seen[s] = 1
    while (sp > 0) {
      const u = stack[--sp]
      comp[nc++] = u
      has |= candidate[u]
      for (let k = adj.start[u]; k < adj.start[u + 1]; k++) {
        if (carOnly && cls[adj.edge[k]] === ROAD.PATH) continue
        const v = adj.node[k]
        if (!seen[v]) {
          seen[v] = 1
          stack[sp++] = v
        }
      }
    }
    if (has) for (let i = 0; i < nc; i++) out[comp[i]] = 1
  }
  return out
}

/** Uniform-grid spatial hash over a subset of nodes, for nearest-node queries. */
export class NodeHash {
  private minX: number
  private minY: number
  private B: number
  private nx: number
  private ny: number
  private start: Int32Array
  private items: Int32Array
  private xs: Float64Array
  private ys: Float64Array
  readonly count: number
  /** Distance of the last nearest() result. */
  lastDist = Infinity

  constructor(xs: Float64Array, ys: Float64Array, include: Uint8Array | null) {
    this.xs = xs
    this.ys = ys
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let count = 0
    for (let i = 0; i < xs.length; i++) {
      if (include && !include[i]) continue
      count++
      if (xs[i] < minX) minX = xs[i]
      if (xs[i] > maxX) maxX = xs[i]
      if (ys[i] < minY) minY = ys[i]
      if (ys[i] > maxY) maxY = ys[i]
    }
    this.count = count
    if (count === 0) {
      minX = minY = maxX = maxY = 0
    }
    const area = Math.max(1, (maxX - minX) * (maxY - minY))
    // ~2 nodes per bucket on average.
    this.B = Math.max(10, Math.sqrt((2 * area) / Math.max(1, count)))
    this.minX = minX
    this.minY = minY
    this.nx = Math.floor((maxX - minX) / this.B) + 1
    this.ny = Math.floor((maxY - minY) / this.B) + 1
    const nb = this.nx * this.ny
    this.start = new Int32Array(nb + 1)
    const bucketOf = new Int32Array(xs.length).fill(-1)
    for (let i = 0; i < xs.length; i++) {
      if (include && !include[i]) continue
      const b = Math.floor((ys[i] - minY) / this.B) * this.nx + Math.floor((xs[i] - minX) / this.B)
      bucketOf[i] = b
      this.start[b + 1]++
    }
    for (let b = 0; b < nb; b++) this.start[b + 1] += this.start[b]
    const pos = this.start.slice(0, nb)
    this.items = new Int32Array(count)
    for (let i = 0; i < xs.length; i++) if (bucketOf[i] >= 0) this.items[pos[bucketOf[i]]++] = i
  }

  private best2 = Infinity
  private bestI = -1

  private scan(b: number, px: number, py: number) {
    const { start, items, xs, ys } = this
    for (let q = start[b]; q < start[b + 1]; q++) {
      const n = items[q]
      const dx = xs[n] - px
      const dy = ys[n] - py
      const d2 = dx * dx + dy * dy
      if (d2 < this.best2) {
        this.best2 = d2
        this.bestI = n
      }
    }
  }

  /** Nearest included node to (px, py), or -1 if the hash is empty. Sets lastDist. Searches square rings
   *  of buckets outwards until no unsearched bucket can be closer than the best found. */
  nearest(px: number, py: number): number {
    const { minX, minY, B, nx, ny } = this
    const bx = Math.min(nx - 1, Math.max(0, Math.floor((px - minX) / B)))
    const by = Math.min(ny - 1, Math.max(0, Math.floor((py - minY) / B)))
    this.best2 = Infinity
    this.bestI = -1
    for (let k = 0; ; k++) {
      const x0 = bx - k
      const x1 = bx + k
      const y0 = by - k
      const y1 = by + k
      for (let j = Math.max(y0, 0); j <= Math.min(y1, ny - 1); j++) {
        if (j === y0 || j === y1) {
          for (let i = Math.max(x0, 0); i <= Math.min(x1, nx - 1); i++) this.scan(j * nx + i, px, py)
        } else {
          if (x0 >= 0) this.scan(j * nx + x0, px, py)
          if (x1 < nx && x1 !== x0) this.scan(j * nx + x1, px, py)
        }
      }
      // Lower bound on the distance to any bucket not searched yet (Infinity on sides already at the edge).
      const west = x0 <= 0 ? Infinity : px - (minX + x0 * B)
      const east = x1 >= nx - 1 ? Infinity : minX + (x1 + 1) * B - px
      const north = y0 <= 0 ? Infinity : py - (minY + y0 * B)
      const south = y1 >= ny - 1 ? Infinity : minY + (y1 + 1) * B - py
      const bound = Math.min(west, east, north, south)
      if (bound === Infinity || this.best2 <= bound * bound) break
    }
    this.lastDist = Math.sqrt(this.best2)
    return this.bestI
  }
}

export function prepareEvac(
  grid: GridMeta,
  fuel: Uint8Array,
  roads: RoadsFile,
  buildings: Float32Array,
  params: Pick<EvacParams, 'safeDistanceM'>,
): EvacPrepared {
  const tStart = performance.now()
  if (!grid) fail('grid is missing')
  const { rows, cols, cellM, latMax, lonMin, dLat, dLon } = grid
  if (!Number.isInteger(rows) || rows <= 0 || !Number.isInteger(cols) || cols <= 0)
    fail(`grid rows/cols must be positive integers (got ${rows} x ${cols})`)
  for (const [k, v] of [
    ['cellM', cellM],
    ['dLat', dLat],
    ['dLon', dLon],
  ] as const)
    if (!(Number.isFinite(v) && v > 0)) fail(`grid.${k} must be a positive number (got ${v})`)
  if (!Number.isFinite(latMax) || !Number.isFinite(lonMin)) fail('grid.latMax / grid.lonMin must be finite')
  const nCells = rows * cols
  if (!(fuel instanceof Uint8Array) || fuel.length !== nCells)
    fail(`fuel must be a Uint8Array of rows*cols = ${nCells} (got ${fuel?.length})`)
  if (!(buildings instanceof Float32Array)) fail('buildings must be a Float32Array')
  if (buildings.length % 3 !== 0) fail(`buildings length ${buildings.length} is not a multiple of 3`)
  const safeDistanceM = params?.safeDistanceM
  if (!(Number.isFinite(safeDistanceM) && safeDistanceM >= 0))
    fail(`safeDistanceM must be a finite number >= 0 (got ${safeDistanceM})`)
  if (!roads || !Array.isArray(roads.nodes) || !Array.isArray(roads.edges))
    fail('roads must have nodes[] and edges[]')

  const N = roads.nodes.length
  const E = roads.edges.length
  const nB = buildings.length / 3
  if (nB > 0 && N === 0) fail('there are buildings but the road graph has no nodes')

  const toX = (lon: number) => ((lon - lonMin) / dLon) * cellM
  const toY = (lat: number) => ((latMax - lat) / dLat) * cellM

  // Nodes
  const nodeX = new Float64Array(N)
  const nodeY = new Float64Array(N)
  const nodeCell = new Int32Array(N)
  let nodesOutsideGrid = 0
  for (let i = 0; i < N; i++) {
    const p = roads.nodes[i]
    if (!Array.isArray(p) || p.length < 2) fail(`node ${i} is not a [lon, lat] pair`)
    const lon = p[0]
    const lat = p[1]
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) fail(`node ${i} has non-finite coordinates (${lon}, ${lat})`)
    nodeX[i] = toX(lon)
    nodeY[i] = toY(lat)
    nodeCell[i] = cellOf(nodeX[i], nodeY[i], cellM, rows, cols)
    if (nodeCell[i] < 0) nodesOutsideGrid++
  }

  // Edges
  const edgeU = new Int32Array(E)
  const edgeV = new Int32Array(E)
  const edgeLenM = new Float64Array(E)
  const edgeCls = new Uint8Array(E)
  for (let e = 0; e < E; e++) {
    const ed = roads.edges[e]
    if (!Array.isArray(ed) || ed.length < 4) fail(`edge ${e} is not [u, v, lengthM, cls]`)
    const [u, v, len, cls] = ed
    if (!Number.isInteger(u) || u < 0 || u >= N) fail(`edge ${e}: node index u = ${u} out of range [0, ${N})`)
    if (!Number.isInteger(v) || v < 0 || v >= N) fail(`edge ${e}: node index v = ${v} out of range [0, ${N})`)
    if (!(Number.isFinite(len) && len >= 0)) fail(`edge ${e}: lengthM = ${len} must be finite and >= 0`)
    if (!Number.isInteger(cls) || cls < ROAD.MOTORWAY || cls > ROAD.PATH) fail(`edge ${e}: cls = ${cls} is not a ROAD class`)
    edgeU[e] = u
    edgeV[e] = v
    edgeLenM[e] = len
    edgeCls[e] = cls
  }
  const adj = buildCsr(N, edgeU, edgeV)

  // Edge -> cells
  const geoms = roads.geoms
  if (geoms !== undefined && (!Array.isArray(geoms) || geoms.length !== E))
    fail(`geoms must have one polyline per edge (${E}), got ${Array.isArray(geoms) ? geoms.length : typeof geoms}`)
  const edgeCellStart = new Int32Array(E + 1)
  const cellBuf = new IntBuf(E * 4)
  for (let e = 0; e < E; e++) {
    const g = geoms?.[e]
    if (g && g.length >= 2) {
      let last = -1
      let px = NaN
      let py = NaN
      for (let k = 0; k < g.length; k++) {
        const q = g[k]
        if (!Array.isArray(q) || !Number.isFinite(q[0]) || !Number.isFinite(q[1]))
          fail(`geoms[${e}][${k}] is not a finite [lon, lat]`)
        const x = toX(q[0])
        const y = toY(q[1])
        if (k > 0) last = sampleSegment(px, py, x, y, cellM, rows, cols, cellBuf, last)
        px = x
        py = y
      }
    } else {
      if (g && g.length === 1) fail(`geoms[${e}] has a single point`)
      sampleSegment(nodeX[edgeU[e]], nodeY[edgeU[e]], nodeX[edgeV[e]], nodeY[edgeV[e]], cellM, rows, cols, cellBuf, -1)
    }
    edgeCellStart[e + 1] = cellBuf.n
  }
  const edgeCells = cellBuf.view()

  // Distance to wildland
  const minPatchCells = Math.ceil((MIN_WILDLAND_PATCH_HA * 10000) / (cellM * cellM))
  const { dist: dt, ignoredPatches: smallWildlandPatches } = wildlandDistanceCells(fuel, rows, cols, minPatchCells)
  const nodeWildM = new Float32Array(N)
  let candidateSafeNodes = 0
  for (let i = 0; i < N; i++) {
    const c = nodeCell[i]
    nodeWildM[i] = c < 0 ? Infinity : dt[c] * cellM
    if (nodeWildM[i] >= safeDistanceM) candidateSafeNodes++
  }

  // Buildings -> nearest non-isolated node whose connected component holds a safe-zone candidate. If no
  // node qualifies, every node is eligible (simulateEvac then fails loudly with "no safe destination"
  // for lack of candidates; Prepared.snapNodes exposes the count).
  const candidate = new Uint8Array(N)
  for (let i = 0; i < N; i++) candidate[i] = nodeWildM[i] >= safeDistanceM ? 1 : 0
  const eligible = componentsWithCandidate(N, adj, candidate, edgeCls, false)
  let nEligible = 0
  for (let i = 0; i < N; i++) {
    if (adj.start[i + 1] === adj.start[i]) eligible[i] = 0 // an isolated node is not a street
    nEligible += eligible[i]
  }
  const hash = new NodeHash(nodeX, nodeY, nEligible > 0 ? eligible : null)
  // Car: nodes with a drivable edge in a drivable component that holds a candidate.
  const carEligible = componentsWithCandidate(N, adj, candidate, edgeCls, true)
  const hasDrivable = new Uint8Array(N)
  for (let e = 0; e < E; e++) if (edgeCls[e] !== ROAD.PATH) hasDrivable[edgeU[e]] = hasDrivable[edgeV[e]] = 1
  for (let i = 0; i < N; i++) carEligible[i] &= hasDrivable[i]
  const hashCar = new NodeHash(nodeX, nodeY, carEligible)
  const bldCarNode = new Int32Array(nB)
  const bldCarAccessM = new Float32Array(nB)
  let buildingsWithoutCarNode = 0
  const bldCell = new Int32Array(nB)
  const bldNode = new Int32Array(nB)
  const bldAccessM = new Float32Array(nB)
  let buildingsOutsideGrid = 0
  for (let b = 0; b < nB; b++) {
    const lon = buildings[3 * b]
    const lat = buildings[3 * b + 1]
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) fail(`building ${b} has non-finite coordinates (${lon}, ${lat})`)
    const x = toX(lon)
    const y = toY(lat)
    bldCell[b] = cellOf(x, y, cellM, rows, cols)
    if (bldCell[b] < 0) buildingsOutsideGrid++
    bldNode[b] = hash.nearest(x, y)
    bldAccessM[b] = hash.lastDist
    if (carEligible[bldNode[b]]) {
      // the nearest eligible node is also the nearest car-eligible one (car-eligible is a subset)
      bldCarNode[b] = bldNode[b]
      bldCarAccessM[b] = bldAccessM[b]
    } else {
      const cn = hashCar.nearest(x, y)
      if (cn >= 0 && hashCar.lastDist <= CAR_SNAP_MAX_M) {
        bldCarNode[b] = cn
        bldCarAccessM[b] = hashCar.lastDist
      } else {
        bldCarNode[b] = -1
        bldCarAccessM[b] = Infinity
        buildingsWithoutCarNode++
      }
    }
  }

  const prepared: Prepared = {
    kind: PREPARED_KIND,
    nodeCount: N,
    edgeCount: E,
    buildingCount: nB,
    rows,
    cols,
    cellM,
    safeDistanceM,
    nodeX,
    nodeY,
    nodeCell,
    nodeWildM,
    edgeU,
    edgeV,
    edgeLenM,
    edgeCls,
    edgeCellStart,
    edgeCells,
    adj,
    bldCell,
    bldNode,
    bldAccessM,
    bldCarNode,
    bldCarAccessM,
    nodesOutsideGrid,
    buildingsOutsideGrid,
    candidateSafeNodes,
    smallWildlandPatches,
    snapNodes: hash.count,
    snapNodesCar: hashCar.count,
    buildingsWithoutCarNode,
    elapsedMs: 0,
  }
  prepared.elapsedMs = performance.now() - tStart
  return prepared
}

/** Typed view of an EvacPrepared; throws if it was not produced by prepareEvac. */
export function asPrepared(p: EvacPrepared): Prepared {
  if (!p || p.kind !== PREPARED_KIND) throw new Error('simulateEvac: `prepared` was not produced by prepareEvac')
  return p as Prepared
}
