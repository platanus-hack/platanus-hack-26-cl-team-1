// Preparation plan bake ("Plan de preparación", MODEL.md in this folder): ranks the belt tiles and the
// programme sectors over an ensemble of plausible fires, scores the ranking on fires it never saw and on
// 2 Feb 2024 (excluded from training), and writes public/data/plan.json (PlanFile in types.ts).
// The fire and the evacuation run exactly as the worker runs them (src/worker/sim.worker.ts), and the measures
// are applied with the same helpers (./index.ts), so the panel shows what this script measured.
//
//   pnpm plan                                   # full bake: writes public/data/plan.json
//   pnpm plan --fires 12 --out /tmp/plan.json   # quick smoke run on a small ensemble
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cellCentre } from '../../data/grid'
import { parseBrigades, parseBuildings, parseElevation, parseFuel, parseGrid, parseIgnitions, parsePlan, parseRoads, parseWeather } from '../../data/load'
import { localToMin } from '../../data/time'
import { buildIgnitions, buildWeatherSeries, defaultBrigades, rasteriseFirebreaks, type Scenario, type WeatherSettings } from '../../worker/scenario'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from '../evac'
import { DEFAULT_FIRE_PARAMS, ERA5_WIND_DIR_CORRECTION_DEG, simulateFire } from '../fire'
import { FUEL, PLAN_MEASURE, type EvacParams, type EvacProgramme, type PlanFile, type PlanValidation } from '../types'
import { BELT_CELL, PLAN_BELT_WIDTH_M, PLAN_PROGRAMME, PLAN_TILE_CELLS, applyBelt, buildBelt, fillBudget, programmeFor, sectorHouseholds, tileHa } from './index'

const T0 = performance.now()
const secs = (t: number) => ((performance.now() - t) / 1000).toFixed(1)

// ---------------------------------------------------------------------------------------------------------
// Arguments and data
// ---------------------------------------------------------------------------------------------------------
const dir = fileURLToPath(new URL('../../../public/data/', import.meta.url))
const args = process.argv.slice(2)
function arg(name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  if (i + 1 >= args.length) throw new Error(`bake: ${name} needs a value`)
  return args[i + 1]
}
for (const a of args) if (a.startsWith('--') && a !== '--fires' && a !== '--out') throw new Error(`bake: unknown option ${a}`)
/** Ensemble size: every third fire (k % 3 == 2) is held out for testing. */
const N_FIRES = Number(arg('--fires') ?? 120)
if (!Number.isInteger(N_FIRES) || N_FIRES < 6) throw new Error(`bake: --fires must be an integer >= 6 (got ${arg('--fires')})`)
const OUT = arg('--out') ?? dir + 'plan.json'

const bin = (f: string) => {
  const b = readFileSync(dir + f)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const json = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'))
const grid = parseGrid(json('grid.json'))
const N = grid.rows * grid.cols
const { rows, cols, cellM } = grid
const fuel = parseFuel(bin('fuel.bin'), N)
const elevation = parseElevation(bin('elevation.bin'), N)
const buildings = parseBuildings(bin('buildings.bin'))
const roads = parseRoads(json('roads.json'))
const weatherFile = parseWeather(json('weather.json'))
const presets = parseIgnitions(json('ignitions.json'))
const brigades = parseBrigades(json('brigades.json'), grid)
const prepared = prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })
const belt = buildBelt(grid, fuel, buildings)
const households = sectorHouseholds(belt)
const allTiles = [...belt.cellsByTile.keys()].sort((a, b) => a - b)
const allSectors = [...households.keys()].sort((a, b) => a - b)
const nBld = belt.sectorOfBuilding.length
console.log(
  `grid ${rows}x${cols} @ ${cellM} m, ${nBld} buildings; belt ${allTiles.length} tiles, ${tileHaSum(allTiles).toFixed(0)} ha; ` +
    `${allSectors.length} sectors with households; loaded in ${secs(T0)} s`,
)

function tileHaSum(tiles: readonly number[]): number {
  let s = 0
  for (const t of tiles) s += tileHa(belt, t)
  return s
}
function householdSum(sectors: readonly number[]): number {
  let s = 0
  for (const x of sectors) s += households.get(x) ?? 0
  return s
}

// ---------------------------------------------------------------------------------------------------------
// Scenario, fire and evacuation exactly as the app runs them
// ---------------------------------------------------------------------------------------------------------
/** App.tsx NEUTRAL_WEATHER: the real ERA5 series, no adjustment (constant-mode values unused in 'real'). */
const NEUTRAL_WEATHER: WeatherSettings = { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }

/** App.tsx defaultScenario on the 2024 timeline: both preset ignitions, alert 18:00, default behaviour. */
function baseScenario(): Scenario {
  return {
    weather: { ...NEUTRAL_WEATHER },
    droughtFactor: DEFAULT_FIRE_PARAMS.droughtFactor,
    spotting: DEFAULT_FIRE_PARAMS.spotting,
    spotMetresPerKmh: DEFAULT_FIRE_PARAMS.spotMetresPerKmh,
    presetIgnitions: presets.map((g) => g.id),
    userIgnitions: [],
    firebreaks: [],
    alertMin: DEFAULT_EVAC_PARAMS.alertMin,
    cueShare: DEFAULT_EVAC_PARAMS.cueShare,
    cueRadiusM: DEFAULT_EVAC_PARAMS.cueRadiusM,
    prepMedianMin: DEFAULT_EVAC_PARAMS.prepMedianMin,
    footShare: DEFAULT_EVAC_PARAMS.footShare,
    closedEdges: [],
    addedLinks: [],
    brigades: defaultBrigades(brigades, grid.t0),
    planTiles: [],
    planSectors: [],
  }
}

/** Weather members: adjustments of the real series, the same knobs as the panel's weather controls. */
const MEMBERS = [
  { name: 'real', windFactor: 1, windDirOffsetDeg: 0 },
  { name: 'viento -20 %', windFactor: 0.8, windDirOffsetDeg: 0 },
  { name: 'viento +20 %', windFactor: 1.2, windDirOffsetDeg: 0 },
  { name: 'dirección -10°', windFactor: 1, windDirOffsetDeg: -10 },
  { name: 'dirección +10°', windFactor: 1, windDirOffsetDeg: 10 },
] as const
const withMember = (s: Scenario, m: (typeof MEMBERS)[number]): Scenario => ({
  ...s,
  weather: { ...s.weather, windFactor: s.weather.windFactor * m.windFactor, windDirOffsetDeg: s.weather.windDirOffsetDeg + m.windDirOffsetDeg },
})

let fireRuns = 0
let evacRuns = 0
let skippedIgnitionNotes = 0

/** Fire arrival (min) as sim.worker.ts computes it, with the belt applied in `tiles`. */
function runFire(s: Scenario, tiles: readonly number[]): Float32Array {
  const ignitions = buildIgnitions(grid, presets, s)
  const wb = buildWeatherSeries(weatherFile, grid.t0, s.weather, ERA5_WIND_DIR_CORRECTION_DEG)
  if (wb.notes.length > 0) throw new Error(`bake: the weather needed adjusting: ${wb.notes.join(' ')}`)
  let f = fuel
  let fb = rasteriseFirebreaks(grid, s.firebreaks)
  if (tiles.length > 0) {
    const a = applyBelt(belt, tiles, f, fb, ignitions.map((g) => g.cell))
    f = a.fuel
    fb = a.firebreak
    // The app leaves an ignition cell untreated (and says so); count it so the log says so too.
    if (a.skippedIgnitionCells > 0) skippedIgnitionNotes++
  }
  fireRuns++
  return simulateFire({
    grid,
    elevation,
    fuel: f,
    firebreak: fb,
    ignitions,
    weather: wb.series,
    params: { ...DEFAULT_FIRE_PARAMS, droughtFactor: s.droughtFactor, spotting: s.spotting, spotMetresPerKmh: s.spotMetresPerKmh, horizonMin: DEFAULT_FIRE_PARAMS.horizonMin },
  }).arrivalMin.slice()
}

function runEvac(arrival: Float32Array, s: Scenario, programme?: EvacProgramme) {
  const params: EvacParams = { ...DEFAULT_EVAC_PARAMS, alertMin: s.alertMin, cueShare: s.cueShare, cueRadiusM: s.cueRadiusM, prepMedianMin: s.prepMedianMin, footShare: s.footShare }
  evacRuns++
  return simulateEvac({ prepared, arrivalMin: arrival, params, edits: { closedEdges: s.closedEdges, addedLinks: s.addedLinks }, programme })
}

// ---------------------------------------------------------------------------------------------------------
// Ensemble: plausible ignitions in wildland near (not in) inhabited land, never near the 2 Feb ignitions
// ---------------------------------------------------------------------------------------------------------
/** mulberry32: a small deterministic PRNG so the ensemble and the random fills are reproducible. */
function prng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const IGNITION_BAND_M: [number, number] = [400, 3000]
const EXCLUDE_NEAR_REAL_M = 2000
const EDGE_MARGIN_CELLS = 10
/** Planning assumption: the alert reaches everyone 4 h after the ignition (environmental cues as default). */
const ALERT_LAG_MIN = 240
const ENSEMBLE_SEED = 20240202
const RANDOM_FILL_SEED = 4242
const RANDOM_FILLS = 10
const BELT_BUDGETS_HA = [300, 1000, 3000]
const PROGRAMME_BUDGETS = [5000, 20000, 50000]

// Inhabited built-up cells: the same definition as buildBelt (a building within the 5 x 5 window).
const bldPerCell = new Int32Array(N)
for (let b = 0; b < nBld; b++) {
  const x = buildings[3 * b]
  const y = buildings[3 * b + 1]
  const c = Math.floor((x - grid.lonMin) / grid.dLon)
  const r = Math.floor((grid.latMax - y) / grid.dLat)
  if (r >= 0 && c >= 0 && r < rows && c < cols) bldPerCell[r * cols + c]++
}
const distInhab = new Float32Array(N).fill(Infinity)
for (let r = 0; r < rows; r++)
  for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    if (fuel[i] !== FUEL.URBAN_LOW && fuel[i] !== FUEL.URBAN_DENSE) continue
    let w = 0
    for (let a = -2; a <= 2 && !w; a++) for (let b = -2; b <= 2; b++) if (r + a >= 0 && r + a < rows && c + b >= 0 && c + b < cols && bldPerCell[(r + a) * cols + c + b] > 0) w = 1
    if (w) distInhab[i] = 0
  }
// Chamfer distance (m) to the nearest inhabited cell: forward and backward passes.
for (let pass = 0; pass < 2; pass++) {
  const fwd = pass === 0
  const nb = fwd
    ? [[0, -1, 1], [-1, 0, 1], [-1, -1, Math.SQRT2], [-1, 1, Math.SQRT2]]
    : [[0, 1, 1], [1, 0, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2]]
  for (let k = 0; k < N; k++) {
    const i = fwd ? k : N - 1 - k
    const r = (i / cols) | 0
    const c = i - r * cols
    let v = distInhab[i]
    for (const [dr, dc, w] of nb) {
      const rr = r + dr
      const cc = c + dc
      if (rr >= 0 && cc >= 0 && rr < rows && cc < cols) v = Math.min(v, distInhab[rr * cols + cc] + w * cellM)
    }
    distInhab[i] = v
  }
}

const realIgn = presets.map((p) => [Math.floor((grid.latMax - p.lat) / grid.dLat), Math.floor((p.lon - grid.lonMin) / grid.dLon)])
const cand: number[] = []
for (let r = EDGE_MARGIN_CELLS; r < rows - EDGE_MARGIN_CELLS; r++)
  for (let c = EDGE_MARGIN_CELLS; c < cols - EDGE_MARGIN_CELLS; c++) {
    const i = r * cols + c
    const f = fuel[i]
    if (f !== FUEL.GRASS && f !== FUEL.SHRUB && f !== FUEL.FOREST) continue
    if (bldPerCell[i] > 0 || belt.cell[i] !== BELT_CELL.NONE) continue
    if (distInhab[i] < IGNITION_BAND_M[0] || distInhab[i] > IGNITION_BAND_M[1]) continue
    if (realIgn.some(([rr, cc]) => Math.hypot(r - rr, c - cc) * cellM <= EXCLUDE_NEAR_REAL_M)) continue
    cand.push(i)
  }
if (cand.length < N_FIRES) throw new Error(`bake: only ${cand.length} ignition candidates for ${N_FIRES} fires`)

// Farthest-point sampling from a random start: ignitions spread over the whole interface.
const rndEnsemble = prng(ENSEMBLE_SEED)
const picked: number[] = [cand[Math.floor(rndEnsemble() * cand.length)]]
{
  const dmin = new Float64Array(cand.length).fill(Infinity)
  while (picked.length < N_FIRES) {
    const last = picked[picked.length - 1]
    const lr = (last / cols) | 0
    const lc = last - lr * cols
    let best = -1
    let bestD = -1
    for (let k = 0; k < cand.length; k++) {
      const r = (cand[k] / cols) | 0
      const c = cand[k] - r * cols
      const d = Math.hypot(r - lr, c - lc)
      if (d < dmin[k]) dmin[k] = d
      if (dmin[k] > bestD) {
        bestD = dmin[k]
        best = k
      }
    }
    picked.push(cand[best])
  }
}

interface Fire {
  id: string
  s: Scenario
}
const noonMin = localToMin(grid.t0, `${grid.t0.slice(0, 10)}T12:00`)
const ensemble = picked.map((cell, k) => {
  const [lon, lat] = cellCentre(grid, cell)
  const tMin = noonMin + 60 * (k % 4) // 12:00, 13:00, 14:00, 15:00
  const m = MEMBERS[k % MEMBERS.length]
  const s = withMember({ ...baseScenario(), presetIgnitions: [], userIgnitions: [{ id: `plan-${k}`, lon, lat, tMin }], alertMin: tMin + ALERT_LAG_MIN }, m)
  return { fire: { id: `foco ${k} (${m.name}, ${12 + k % 4}:00)`, s } as Fire, test: k % 3 === 2 }
})
const train = ensemble.filter((e) => !e.test).map((e) => e.fire)
const test = ensemble.filter((e) => e.test).map((e) => e.fire)
const feb2: Fire[] = MEMBERS.map((m) => ({ id: `2 feb 2024 (${m.name})`, s: withMember(baseScenario(), m) }))
console.log(
  `ensemble: ${cand.length} ignition candidates (wildland ${IGNITION_BAND_M[0]}-${IGNITION_BAND_M[1]} m from inhabited land, outside the belt, ` +
    `> ${EXCLUDE_NEAR_REAL_M} m from the 2 Feb ignitions); ${N_FIRES} fires = ${train.length} train + ${test.length} test; alert = ignition + ${ALERT_LAG_MIN} min`,
)

// ---------------------------------------------------------------------------------------------------------
// Baselines: fire without the plan, evacuation without and with the programme everywhere
// ---------------------------------------------------------------------------------------------------------
interface Base {
  arrival: Float32Array
  /** Per building risk without / with the programme in every sector (households do not interact). */
  riskD: Float32Array
  riskP: Float32Array
  total: number
}
const allProgramme = programmeFor(belt, allSectors)
if (!allProgramme) throw new Error('bake: no sector has households')
const base = new Map<Fire, Base>()
const tBase = performance.now()
for (const f of [...train, ...test, ...feb2]) {
  const arrival = runFire(f.s, [])
  const d = runEvac(arrival, f.s)
  const p = runEvac(arrival, f.s, allProgramme)
  base.set(f, { arrival, riskD: d.householdRisk.slice(), riskP: p.householdRisk.slice(), total: d.expectedTrappedHouseholds })
}
const sumTotal = (fs: Fire[]) => fs.reduce((a, f) => a + base.get(f)!.total, 0)
console.log(
  `baselines in ${secs(tBase)} s: train mean ${(sumTotal(train) / train.length).toFixed(1)}, test mean ${(sumTotal(test) / test.length).toFixed(1)} ` +
    `expected households cut off; 2 Feb ${feb2.map((f) => `${f.id} ${base.get(f)!.total.toFixed(0)}`).join(', ')}`,
)

/** Expected households cut off with the programme in `sectors`, from the baseline's per-building risks.
 *  Exact because households do not interact in the evacuation engine (checked below against the engine). */
function mixTotal(b: Base, sectors: ReadonlySet<number>): number {
  let t = 0
  for (let i = 0; i < nBld; i++) t += sectors.has(belt.sectorOfBuilding[i]) ? b.riskP[i] : b.riskD[i]
  return t
}
/** A belt tile can only change a fire that reaches at least one of its treated cells. */
function reaches(arrival: Float32Array, tile: number): boolean {
  for (const i of belt.cellsByTile.get(tile)!) if (arrival[i] !== Infinity) return true
  return false
}

// ---------------------------------------------------------------------------------------------------------
// Ranking on the training fires
// ---------------------------------------------------------------------------------------------------------
const tTiles = performance.now()
const tileGain = new Map<number, number>(allTiles.map((t) => [t, 0]))
let pairs = 0
for (const f of train) {
  const b = base.get(f)!
  if (b.total < 1) continue // nothing to gain worth a fire run
  for (const t of allTiles) {
    if (!reaches(b.arrival, t)) continue
    pairs++
    tileGain.set(t, tileGain.get(t)! + b.total - runEvac(runFire(f.s, [t]), f.s).expectedTrappedHouseholds)
  }
}
const rankedTiles = allTiles
  .map((t) => ({ tile: t, ha: tileHa(belt, t), savedPerFire: tileGain.get(t)! / train.length }))
  .filter((x) => x.savedPerFire > 0)
  .sort((a, b) => b.savedPerFire / b.ha - a.savedPerFire / a.ha || a.tile - b.tile)
console.log(`belt ranking: ${pairs} (tile, fire) solo runs in ${secs(tTiles)} s; ${rankedTiles.length} of ${allTiles.length} tiles with a positive gain`)

const sectorGain = new Map<number, number>()
for (const f of train) {
  const b = base.get(f)!
  for (let i = 0; i < nBld; i++) {
    const s = belt.sectorOfBuilding[i]
    const d = b.riskD[i] - b.riskP[i]
    if (s < 0 || d === 0) continue
    sectorGain.set(s, (sectorGain.get(s) ?? 0) + d)
  }
}
const rankedSectors = [...sectorGain.entries()]
  .map(([s, g]) => ({ sector: s, households: households.get(s)!, savedPerFire: g / train.length }))
  .filter((x) => x.savedPerFire > 0)
  .sort((a, b) => b.savedPerFire / b.households - a.savedPerFire / a.households || a.sector - b.sector)
console.log(`programme ranking: ${rankedSectors.length} of ${allSectors.length} sectors with a positive gain`)

// ---------------------------------------------------------------------------------------------------------
// Validation: held-out fires, random fills of the same budget, 2 Feb 2024 (never used to rank)
// ---------------------------------------------------------------------------------------------------------
const pct = (saved: number, total: number) => (total > 0 ? (100 * saved) / total : 0)
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = (s.length - 1) / 2
  return (s[Math.floor(m)] + s[Math.ceil(m)]) / 2
}
function shuffled<T>(a: readonly T[], rnd: () => number): T[] {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
function beltSaved(f: Fire, tiles: readonly number[]): number {
  const b = base.get(f)!
  if (!tiles.some((t) => reaches(b.arrival, t))) return 0
  return b.total - runEvac(runFire(f.s, tiles), f.s).expectedTrappedHouseholds
}
const beltPct = (fs: Fire[], tiles: readonly number[]) => pct(fs.reduce((a, f) => a + beltSaved(f, tiles), 0), sumTotal(fs))
const programmeSavedEngine = (f: Fire, sectors: readonly number[]) => {
  const b = base.get(f)!
  return b.total - runEvac(b.arrival, f.s, programmeFor(belt, sectors)).expectedTrappedHouseholds
}
const programmePctMix = (fs: Fire[], sectors: ReadonlySet<number>) => pct(fs.reduce((a, f) => a + base.get(f)!.total - mixTotal(base.get(f)!, sectors), 0), sumTotal(fs))
const feb2Pcts = (saved: (f: Fire) => number) => feb2.map((f) => pct(saved(f), base.get(f)!.total))
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length

const validation: PlanValidation[] = []
const tVal = performance.now()
const rndFill = prng(RANDOM_FILL_SEED)
const fmtPcts = (a: number[]) => a.map((x) => x.toFixed(1)).join(' / ')
for (const budget of BELT_BUDGETS_HA) {
  const tiles = fillBudget(rankedTiles, (x) => x.ha, budget).map((x) => x.tile)
  const unseen = beltPct(test, tiles)
  const random: number[] = []
  for (let r = 0; r < RANDOM_FILLS; r++) random.push(beltPct(test, fillBudget(shuffled(allTiles, rndFill), (t) => tileHa(belt, t), budget)))
  const f2 = feb2Pcts((f) => beltSaved(f, tiles))
  validation.push({ measure: PLAN_MEASURE.BELT, budget, unseenPct: unseen, randomUnseenPct: [Math.min(...random), median(random), Math.max(...random)], feb2Pct: f2[0], feb2MeanPct: mean(f2) })
  console.log(
    `belt ${budget} ha (${tiles.length} tiles, ${tileHaSum(tiles).toFixed(0)} ha): unseen ${unseen.toFixed(1)} % | random ${fmtPcts([Math.min(...random), median(random), Math.max(...random)])} % ` +
      `| 2 Feb real ${f2[0].toFixed(1)} %, mean ${mean(f2).toFixed(1)} % [${fmtPcts(f2)}]  (${secs(tVal)} s)`,
  )
}
for (const budget of PROGRAMME_BUDGETS) {
  const sectors = fillBudget(rankedSectors, (x) => x.households, budget).map((x) => x.sector)
  // Ranked fill through the engine with programmeFor (what the app runs); random fills by the exact mixture.
  const unseen = pct(test.reduce((a, f) => a + programmeSavedEngine(f, sectors), 0), sumTotal(test))
  const random: number[] = []
  for (let r = 0; r < RANDOM_FILLS; r++) random.push(programmePctMix(test, new Set(fillBudget(shuffled(allSectors, rndFill), (s) => households.get(s)!, budget))))
  const f2 = feb2Pcts((f) => programmeSavedEngine(f, sectors))
  // Self-check: the mixture used for the random fills equals the engine (2 Feb, real weather, this fill).
  const mix = base.get(feb2[0])!.total - mixTotal(base.get(feb2[0])!, new Set(sectors))
  const eng = programmeSavedEngine(feb2[0], sectors)
  if (Math.abs(mix - eng) > 1e-3 * Math.max(1, Math.abs(eng))) throw new Error(`bake: the programme mixture is not exact (${mix} vs engine ${eng})`)
  validation.push({ measure: PLAN_MEASURE.PROGRAMME, budget, unseenPct: unseen, randomUnseenPct: [Math.min(...random), median(random), Math.max(...random)], feb2Pct: f2[0], feb2MeanPct: mean(f2) })
  console.log(
    `programme ${budget} households (${sectors.length} sectors, ${householdSum(sectors)} households): unseen ${unseen.toFixed(1)} % | random ${fmtPcts([Math.min(...random), median(random), Math.max(...random)])} % ` +
      `| 2 Feb real ${f2[0].toFixed(1)} %, mean ${mean(f2).toFixed(1)} % [${fmtPcts(f2)}]  (${secs(tVal)} s)`,
  )
}
// Reference only (not written): each measure everywhere.
{
  const f2 = feb2Pcts((f) => beltSaved(f, allTiles))
  console.log(`reference, belt in every tile (${tileHaSum(allTiles).toFixed(0)} ha): unseen ${beltPct(test, allTiles).toFixed(1)} % | 2 Feb real ${f2[0].toFixed(1)} %, mean ${mean(f2).toFixed(1)} % [${fmtPcts(f2)}]`)
  const all = new Set(allSectors)
  const p2 = feb2Pcts((f) => base.get(f)!.total - mixTotal(base.get(f)!, all))
  console.log(`reference, programme in every sector (${householdSum(allSectors)} households): unseen ${programmePctMix(test, all).toFixed(1)} % | 2 Feb real ${p2[0].toFixed(1)} %, mean ${mean(p2).toFixed(1)} % [${fmtPcts(p2)}]`)
}

// ---------------------------------------------------------------------------------------------------------
// plan.json
// ---------------------------------------------------------------------------------------------------------
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
const plan: PlanFile = {
  method:
    `Orden calculado sobre ${train.length} incendios simulados con el clima de la tarde del 2 feb 2024 (viento ±20 %, dirección ±10°), ` +
    `con focos en vegetación a ${IGNITION_BAND_M[0]}–${IGNITION_BAND_M[1]} m de zonas habitadas, entre las 12:00 y las 15:00, ` +
    `y la alerta ${ALERT_LAG_MIN / 60} h después del inicio. Se comprobó en otros ${test.length} incendios que el orden no vio y en el 2 feb 2024, ` +
    `que quedó fuera del cálculo (ningún foco a menos de ${EXCLUDE_NEAR_REAL_M / 1000} km de los focos reales).`,
  tileCells: PLAN_TILE_CELLS,
  beltWidthM: PLAN_BELT_WIDTH_M,
  programme: { prepMedianMin: PLAN_PROGRAMME.prepMedianMin, cueShare: PLAN_PROGRAMME.cueShare },
  ensemble: {
    fires: N_FIRES,
    trainFires: train.length,
    testFires: test.length,
    alertLagMin: ALERT_LAG_MIN,
    ignitionBandM: IGNITION_BAND_M,
    excludeNearRealM: EXCLUDE_NEAR_REAL_M,
  },
  tiles: rankedTiles.map((x) => ({ tile: x.tile, ha: r2(x.ha), savedPerFire: r3(x.savedPerFire) })),
  sectors: rankedSectors.map((x) => ({ sector: x.sector, households: x.households, savedPerFire: r3(x.savedPerFire) })),
  validation: validation.map((v) => ({
    ...v,
    unseenPct: r2(v.unseenPct),
    randomUnseenPct: [r2(v.randomUnseenPct[0]), r2(v.randomUnseenPct[1]), r2(v.randomUnseenPct[2])],
    feb2Pct: r2(v.feb2Pct),
    feb2MeanPct: r2(v.feb2MeanPct),
  })),
}
writeFileSync(OUT, JSON.stringify(plan) + '\n')
// The app must accept what was written.
parsePlan(JSON.parse(readFileSync(OUT, 'utf8')), grid)
if (skippedIgnitionNotes > 0) console.log(`note: ${skippedIgnitionNotes} runs left an ignition cell of the belt untreated (as the app does)`)
console.log(`wrote ${OUT} (${(readFileSync(OUT).length / 1024).toFixed(1)} kB, parsePlan ok); ${fireRuns} fire runs, ${evacRuns} evac runs, wall ${secs(T0)} s`)
