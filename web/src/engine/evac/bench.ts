// Benchmark on a synthetic city: ~30k-node street lattice, 50k buildings, 800 x 700 grid of 30 m cells.
// Run: pnpm exec tsx src/engine/evac/bench.ts
import { FUEL, ROAD, type GridMeta, type RoadClass, type RoadsFile } from '../types'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from './index'
import type { Prepared } from './prepare'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(42)

const CELL = 30
const ROWS = 700
const COLS = 800
const grid: GridMeta = {
  rows: ROWS,
  cols: COLS,
  latMax: -32.95,
  lonMin: -71.6,
  dLat: CELL / 111320,
  dLon: CELL / (111320 * Math.cos((33 * Math.PI) / 180)),
  cellM: CELL,
  t0: '2024-02-02T12:00:00-03:00',
  sources: {},
}
const lonOf = (x: number) => grid.lonMin + (x / CELL) * grid.dLon
const latOf = (y: number) => grid.latMax - (y / CELL) * grid.dLat

// Fuel: sea (x < 1 km), dense city (< 9 km), interface with shrub gullies (9-12 km), wildland beyond.
const fuel = new Uint8Array(ROWS * COLS)
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const x = (c + 0.5) * CELL
    const y = (r + 0.5) * CELL
    let f: number
    if (x < 1000) f = FUEL.NONE
    else if (x < 9000) f = FUEL.URBAN_DENSE
    else if (x < 12000) f = y % 1500 < 90 ? FUEL.SHRUB : FUEL.URBAN_LOW
    else f = [FUEL.FOREST, FUEL.SHRUB, FUEL.GRASS][(r + c) % 3]
    fuel[r * COLS + c] = f
  }

// Streets: 173 x 173 lattice, 120 m spacing, ~8% of edges removed, PATH tracks in the wildland.
const SIDE = 173
const SP = 120
const nodes: [number, number][] = []
const nx: number[] = []
const ny: number[] = []
for (let j = 0; j < SIDE; j++)
  for (let i = 0; i < SIDE; i++) {
    const x = 1100 + i * SP + (rand() - 0.5) * 30
    const y = 300 + j * SP + (rand() - 0.5) * 30
    nx.push(x)
    ny.push(y)
    nodes.push([lonOf(x), latOf(y)])
  }
const edges: [number, number, number, RoadClass][] = []
const classOf = (k: number, x: number): RoadClass => {
  if (x > 12000 && rand() < 0.3) return ROAD.PATH
  if (k % 20 === 0) return ROAD.PRIMARY
  if (k % 10 === 0) return ROAD.SECONDARY
  if (k % 5 === 0) return ROAD.TERTIARY
  return ROAD.LOCAL
}
for (let j = 0; j < SIDE; j++)
  for (let i = 0; i < SIDE; i++) {
    const a = j * SIDE + i
    if (i + 1 < SIDE && rand() > 0.08) {
      const b = a + 1
      edges.push([a, b, Math.hypot(nx[b] - nx[a], ny[b] - ny[a]), classOf(j, nx[a])])
    }
    if (j + 1 < SIDE && rand() > 0.08) {
      const b = a + SIDE
      edges.push([a, b, Math.hypot(nx[b] - nx[a], ny[b] - ny[a]), classOf(i, nx[a])])
    }
  }
const roads: RoadsFile = { nodes, edges }

// 50k buildings near street nodes west of 13 km.
const NB = 50000
const buildings = new Float32Array(NB * 3)
for (let b = 0; b < NB; b++) {
  let n: number
  do n = Math.floor(rand() * nodes.length)
  while (nx[n] > 13000)
  buildings[3 * b] = lonOf(nx[n] + (rand() - 0.5) * 80)
  buildings[3 * b + 1] = latOf(ny[n] + (rand() - 0.5) * 80)
  buildings[3 * b + 2] = 80 + rand() * 120
}

// Fire: ignition at (16 km, 10 km) at 14:30 (t = 150 min), runs west with the wind, stops at 6 km.
const arrival = new Float32Array(ROWS * COLS).fill(Infinity)
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c
    const x = (c + 0.5) * CELL
    const y = (r + 0.5) * CELL
    if (fuel[i] === FUEL.NONE || x < 6000) continue
    const t = 150 + Math.hypot((x - 16000) * (x < 16000 ? 0.5 : 2), y - 10000) / 25
    if (t < DEFAULT_EVAC_PARAMS.alertMin + 12 * 60) arrival[i] = t
  }

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
const time = <T>(f: () => T): [T, number] => {
  const t = performance.now()
  const r = f()
  return [r, performance.now() - t]
}

console.log(`grid ${ROWS} x ${COLS} = ${ROWS * COLS} cells, ${nodes.length} nodes, ${edges.length} edges, ${NB} buildings`)

const prepTimes: number[] = []
let prepared!: Prepared
for (let k = 0; k < 5; k++) {
  const [p, ms] = time(() => prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: 800 }) as Prepared)
  prepared = p
  prepTimes.push(ms)
}
console.log(
  `prepareEvac: first ${prepTimes[0].toFixed(0)} ms, median ${median(prepTimes).toFixed(0)} ms; ` +
    `candidate safe nodes ${prepared.candidateSafeNodes}, snap nodes ${prepared.snapNodes}, edge cells ${prepared.edgeCells.length}`,
)

const scenarios = {
  'no edits': { closedEdges: [], addedLinks: [] },
  '20 closed + 5 links': {
    closedEdges: Array.from({ length: 20 }, (_, i) => i * 1500),
    addedLinks: Array.from({ length: 5 }, (_, i) => ({ u: 80 * SIDE + 40 + i * 10, v: 85 * SIDE + 45 + i * 10 })),
  },
}
for (const [name, edits] of Object.entries(scenarios)) {
  const times: number[] = []
  let res!: ReturnType<typeof simulateEvac>
  for (let k = 0; k < 7; k++) {
    const [r, ms] = time(() => simulateEvac({ prepared, arrivalMin: arrival, params: DEFAULT_EVAC_PARAMS, edits }))
    res = r
    times.push(ms)
  }
  const counts = [0, 0, 0, 0]
  for (const s of res.householdStatus) counts[s]++
  console.log(
    `simulateEvac (${name}): first ${times[0].toFixed(0)} ms, median ${median(times).toFixed(0)} ms; ` +
      `trapped ${res.expectedTrappedHouseholds.toFixed(0)} households, reached ${res.buildingsReached}, ` +
      `status [unaffected, safe, at risk, trapped] = [${counts.join(', ')}], riskByAlert ${res.riskByAlert.length} points, car households walking ${res.carHouseholdsWalking}`,
  )
}

// riskByAlert (binned) against full runs at the same alert times.
{
  const edits = { closedEdges: [], addedLinks: [] }
  const base = simulateEvac({ prepared, arrivalMin: arrival, params: DEFAULT_EVAC_PARAMS, edits })
  let worst = 0
  for (const p of base.riskByAlert) {
    if (p.alertMin % 60 !== 0) continue
    const full = simulateEvac({ prepared, arrivalMin: arrival, params: { ...DEFAULT_EVAC_PARAMS, alertMin: p.alertMin }, edits })
    const rel = Math.abs(p.expectedTrappedHouseholds - full.expectedTrappedHouseholds) / Math.max(1, full.expectedTrappedHouseholds)
    worst = Math.max(worst, rel)
  }
  const pts = base.riskByAlert.filter((p) => p.alertMin % 120 === 0)
  console.log(`riskByAlert vs full runs (hourly): worst relative difference ${(worst * 100).toFixed(3)} %`)
  console.log(`curve (every 2 h): ${pts.map((p) => `${p.alertMin}:${p.expectedTrappedHouseholds.toFixed(0)}`).join(' ')}`)
}
