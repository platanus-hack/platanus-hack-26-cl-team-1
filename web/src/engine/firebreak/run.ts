// Firebreak lines for one scenario, measured (MODEL.md in this folder): proposes lines for the 2 Feb 2024
// scenario as the app opens it (both ignitions, the real weather, alert 18:00), for a few budgets of line, and
// prints how many households each line keeps from being cut off: on the scenario itself, on every member of a
// small ensemble around it (wind, wind direction, ignition point) and on members the search never saw. Two
// searches are compared (tuned to the scenario alone, and to the whole ensemble) with random lines and with
// the Plan de preparación belt (public/data/plan.json) at the same treated area.
// The fire and the evacuation run exactly as the worker runs them (src/worker/sim.worker.ts).
//
//   pnpm lines                         # 5, 10 and 20 km of line
//   pnpm lines --budgets 10 --quick    # one budget, fewer proposals (a smoke run)
//   pnpm lines --dispatch file,13:00   # crews leave at brigades.json's time, and (another case) at 13:00
//   pnpm lines --out /tmp/lines.json   # also write the lines found (cell indices and finishing times)
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { EVENTS } from '../../data/events'
import { parseBrigades, parseBuildings, parseElevation, parseFuel, parseGrid, parseIgnitions, parsePlan, parseRoads, parseWeather } from '../../data/load'
import { localToMin, minToHHMM } from '../../data/time'
import { buildIgnitions, buildWeatherSeries, defaultBrigades, rasteriseFirebreaks, type Scenario, type WeatherSettings } from '../../worker/scenario'
import { asPrepared } from '../evac/prepare'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from '../evac'
import { DEFAULT_FIRE_PARAMS, nearestBurnableCell, simulateFire } from '../fire'
import { applyBelt, buildBelt, fillBudget } from '../plan'
import { TIMELINE, type EvacParams, type FireDefense, type Ignition } from '../types'
import { LINE_MODEL, LineCut, buildMinutes, buildableCells, cellsInTime, crewAccessMin, fireNearMin, lineDefense, lineSegments, refineLine, scheduleLine, type LineJob } from './index'

const T0 = performance.now()
const secs = (t: number) => ((performance.now() - t) / 1000).toFixed(1)

// ---------------------------------------------------------------------------------------------------------
// Arguments and data
// ---------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2)
const FLAGS = ['--quick']
const OPTIONS = ['--budgets', '--crews', '--dispatch', '--random', '--out']
function arg(name: string): string | undefined {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  if (i + 1 >= args.length) throw new Error(`lines: ${name} needs a value`)
  return args[i + 1]
}
for (const a of args) if (a.startsWith('--') && !FLAGS.includes(a) && !OPTIONS.includes(a)) throw new Error(`lines: unknown option ${a}`)
const QUICK = args.includes('--quick')
const BUDGETS_KM = (arg('--budgets') ?? '5,10,20').split(',').map(Number)
for (const b of BUDGETS_KM) if (!(b > 0)) throw new Error(`lines: --budgets must be positive kilometres (got ${arg('--budgets')})`)
const CREWS = Number(arg('--crews') ?? LINE_MODEL.crews.value)
if (!Number.isInteger(CREWS) || CREWS < 1) throw new Error(`lines: --crews must be a positive integer (got ${arg('--crews')})`)
const RANDOM_DRAWS = Number(arg('--random') ?? (QUICK ? 4 : 10))
if (!Number.isInteger(RANDOM_DRAWS) || RANDOM_DRAWS < 1) throw new Error(`lines: --random must be a positive integer (got ${arg('--random')})`)

const event = EVENTS[TIMELINE.VINA_2024]
const dir = fileURLToPath(new URL('../../../public/data/', import.meta.url))
const bin = (f: string) => {
  const b = readFileSync(dir + f)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const json = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'))
const grid = parseGrid(json('grid.json'))
const { rows, cols, cellM } = grid
const N = rows * cols
const fuel = parseFuel(bin('fuel.bin'), N)
const elevation = parseElevation(bin('elevation.bin'), N)
const buildings = parseBuildings(bin('buildings.bin'))
const roads = parseRoads(json('roads.json'))
const weatherFile = parseWeather(json('weather.json'))
const presets = parseIgnitions(json('ignitions.json'))
const brigades = parseBrigades(json('brigades.json'), grid)
const plan = parsePlan(json('plan.json'), grid)
const prepared = prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })
const P = asPrepared(prepared)
const belt = buildBelt(grid, fuel, buildings)
const hhmm = (min: number) => minToHHMM(grid.t0, min)
const km = (cells: number) => (cells * cellM) / 1000
console.log(`grid ${rows}x${cols} @ ${cellM} m, ${P.buildingCount} buildings; loaded in ${secs(T0)} s`)

// ---------------------------------------------------------------------------------------------------------
// The scenario and the ensemble around it
// ---------------------------------------------------------------------------------------------------------
/** App.tsx NEUTRAL_WEATHER: the real ERA5 series, no adjustment (constant-mode values unused in 'real'). */
const NEUTRAL_WEATHER: WeatherSettings = { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }
/** App.tsx defaultScenario on the 2024 timeline: both preset ignitions, alert 18:00, default behaviour. */
const scenario: Scenario = {
  weather: { ...NEUTRAL_WEATHER },
  droughtFactor: DEFAULT_FIRE_PARAMS.droughtFactor,
  spotting: DEFAULT_FIRE_PARAMS.spotting,
  spotMetresPerKmh: DEFAULT_FIRE_PARAMS.spotMetresPerKmh,
  presetIgnitions: presets.map((g) => g.id),
  userIgnitions: [],
  firebreaks: [],
  alertMin: event.evac.alertMin.value,
  cueShare: DEFAULT_EVAC_PARAMS.cueShare,
  cueRadiusM: DEFAULT_EVAC_PARAMS.cueRadiusM,
  prepMedianMin: DEFAULT_EVAC_PARAMS.prepMedianMin,
  footShare: event.evac.footShare.value,
  closedEdges: [],
  addedLinks: [],
  brigades: defaultBrigades(brigades, grid.t0),
  planTiles: [],
  planSectors: [],
}
const horizonMin = event.horizonMin

/** A fire near the scenario: the panel's wind knobs, and every ignition moved by (east, north) metres. */
interface Member {
  name: string
  windFactor: number
  windDirOffsetDeg: number
  shiftM: [number, number]
}
const member = (name: string, windFactor = 1, windDirOffsetDeg = 0, shiftM: [number, number] = [0, 0]): Member => ({ name, windFactor, windDirOffsetDeg, shiftM })
/** Members the ensemble search sees. The first is the scenario itself. */
const DESIGN: Member[] = [
  member('the scenario'),
  member('wind -20 %', 0.8),
  member('wind +20 %', 1.2),
  member('direction -10 deg', 1, -10),
  member('direction +10 deg', 1, 10),
  member('ignitions 1 km north', 1, 0, [0, 1000]),
  member('ignitions 1 km east', 1, 0, [1000, 0]),
  member('ignitions 1 km south', 1, 0, [0, -1000]),
  member('ignitions 1 km west', 1, 0, [-1000, 0]),
]
/** Members no search sees: other values of the same knobs. */
const HELD_OUT: Member[] = [
  member('wind -10 %, direction +5 deg', 0.9, 5),
  member('wind +10 %, direction -5 deg', 1.1, -5),
  member('ignitions 0.7 km north-east', 1, 0, [500, 500]),
  member('ignitions 0.7 km south-west', 1, 0, [-500, -500]),
]
const MEMBERS = [...DESIGN, ...HELD_OUT]
const DESIGN_IDX = DESIGN.map((_, k) => k)
const HELD_IDX = HELD_OUT.map((_, k) => DESIGN.length + k)
/** Design members that change only the wind, and those that only move the ignitions. */
const WEATHER_IDX = DESIGN_IDX.filter((k) => k > 0 && DESIGN[k].shiftM[0] === 0 && DESIGN[k].shiftM[1] === 0)
const MOVED_IDX = DESIGN_IDX.filter((k) => DESIGN[k].shiftM[0] !== 0 || DESIGN[k].shiftM[1] !== 0)
const NO_FIREBREAK = rasteriseFirebreaks(grid, scenario.firebreaks)
const SNAP_CELLS = 10

function ignitionsOf(m: Member): Ignition[] {
  const base = buildIgnitions(grid, presets, scenario)
  if (m.shiftM[0] === 0 && m.shiftM[1] === 0) return base
  const dc = Math.round(m.shiftM[0] / cellM)
  const dr = -Math.round(m.shiftM[1] / cellM)
  return base.map((g) => {
    const r = Math.floor(g.cell / cols) + dr
    const c = (g.cell % cols) + dc
    if (r < 0 || c < 0 || r >= rows || c >= cols) throw new Error(`lines: member "${m.name}" moves an ignition off the grid`)
    const cell = nearestBurnableCell(grid, fuel, NO_FIREBREAK, r * cols + c, SNAP_CELLS)
    if (cell < 0) throw new Error(`lines: member "${m.name}" has no burnable cell within ${SNAP_CELLS} cells of a moved ignition`)
    return { cell, tMin: g.tMin }
  })
}
const memberIgnitions = MEMBERS.map(ignitionsOf)
const memberWeather = MEMBERS.map((m) => {
  const w = { ...scenario.weather, windFactor: scenario.weather.windFactor * m.windFactor, windDirOffsetDeg: scenario.weather.windDirOffsetDeg + m.windDirOffsetDeg }
  const wb = buildWeatherSeries(weatherFile, grid.t0, w, event.windDirCorrectionDeg)
  if (wb.notes.length > 0) throw new Error(`lines: the weather needed adjusting: ${wb.notes.join(' ')}`)
  return wb.series
})

let fireRuns = 0
/** Fire arrival (min) as sim.worker.ts computes it, for member k. */
function runFire(k: number, opts: { defense?: FireDefense; fuel?: Uint8Array; firebreak?: Uint8Array; ignitions?: Ignition[]; onSpot?: (from: number, to: number) => void } = {}): Float32Array {
  fireRuns++
  return simulateFire(
    {
      grid,
      elevation,
      fuel: opts.fuel ?? fuel,
      firebreak: opts.firebreak ?? NO_FIREBREAK,
      ignitions: opts.ignitions ?? memberIgnitions[k],
      weather: memberWeather[k],
      params: { ...DEFAULT_FIRE_PARAMS, droughtFactor: scenario.droughtFactor, spotting: scenario.spotting, spotMetresPerKmh: scenario.spotMetresPerKmh, horizonMin },
      defense: opts.defense,
    },
    opts.onSpot,
  ).arrivalMin
}
const evacParams: EvacParams = {
  ...DEFAULT_EVAC_PARAMS,
  personsPerHousehold: event.evac.personsPerHousehold.value,
  alertMin: scenario.alertMin,
  cueShare: scenario.cueShare,
  cueRadiusM: scenario.cueRadiusM,
  prepMedianMin: scenario.prepMedianMin,
  footShare: scenario.footShare,
}
const runEvac = (arrival: Float32Array) => simulateEvac({ prepared, arrivalMin: arrival, params: evacParams, edits: { closedEdges: scenario.closedEdges, addedLinks: scenario.addedLinks } })

// ---------------------------------------------------------------------------------------------------------
// Baselines: every member without lines (arrival, households at stake per cell, ember jumps)
// ---------------------------------------------------------------------------------------------------------
class PairBuf {
  a = new Int32Array(1 << 16)
  n = 0
  push = (from: number, to: number) => {
    if (this.n + 2 > this.a.length) {
      const b = new Int32Array(this.a.length * 2)
      b.set(this.a)
      this.a = b
    }
    this.a[this.n++] = from
    this.a[this.n++] = to
  }
  view(): Int32Array {
    return this.a.subarray(0, this.n)
  }
}
interface Base {
  arrival: Float32Array
  /** Expected households that do not get out, summed per home cell. */
  value: Float32Array
  trapped: number
  jumps: Int32Array
}
const tBase = performance.now()
const base: Base[] = MEMBERS.map((_, k) => {
  const jumps = new PairBuf()
  const arrival = runFire(k, { onSpot: k < DESIGN.length ? jumps.push : undefined })
  const evac = runEvac(arrival)
  const value = new Float32Array(N)
  for (let b = 0; b < P.buildingCount; b++) if (P.bldCell[b] >= 0) value[P.bldCell[b]] += evac.householdRisk[b]
  return { arrival, value, trapped: evac.expectedTrappedHouseholds, jumps: jumps.view().slice() }
})
console.log(`baselines in ${secs(tBase)} s (households cut off without lines):`)
for (let k = 0; k < MEMBERS.length; k++) {
  let burned = 0
  let inReach = 0
  for (let i = 0; i < N; i++) {
    if (base[k].arrival[i] !== Infinity) {
      burned++
      inReach += base[k].value[i]
    }
  }
  console.log(
    `  ${(k < DESIGN.length ? 'design  ' : 'held out') + ' ' + MEMBERS[k].name.padEnd(30)} ${base[k].trapped.toFixed(0).padStart(6)} households, ${((burned * cellM * cellM) / 1e4).toFixed(0).padStart(6)} ha` +
      `, ${((100 * inReach) / Math.max(1e-9, base[k].trapped)).toFixed(0)} % of them in a home the fire reaches` +
      (k < DESIGN.length ? `, ${(base[k].jumps.length / 2 / 1e6).toFixed(2)} M ember jumps` : ''),
  )
}

// ---------------------------------------------------------------------------------------------------------
// What the search knows: one fire (the scenario) or the ensemble (earliest arrival, every jump, mean value)
// ---------------------------------------------------------------------------------------------------------
interface Design {
  name: string
  members: number[]
  /** Where the search assumes the fire can start: the exact ignition cells, or every cell of the zone around
   *  them. A line inside that zone separates nothing, so the cut goes around it. */
  sourceCells: number[]
  /** Start time of the fire that reaches each cell first (a crew cannot work on a fire that has not started). */
  fireStart: Float32Array
  arrival: Float32Array
  /** When the fire is first within two cells (fireNearMin of arrival): the clock the crews work against. */
  near: Float32Array
  jumps: Int32Array
  value: Float32Array
}
/** The ensemble moves each ignition by up to this far: the zone a robust line has to go around. */
const IGNITION_ZONE_M = 1000
function designOf(name: string, members: number[], zoneM: number): Design {
  const arrival = new Float32Array(N).fill(Infinity)
  const fireStart = new Float32Array(N).fill(Infinity)
  /** Earliest arrival of a single ignition's own fire, over the members: its ignition time is fireStart. */
  const firstAlone = new Float32Array(N).fill(Infinity)
  const value = new Float32Array(N)
  let nj = 0
  for (const k of members) nj += base[k].jumps.length
  const jumps = new Int32Array(nj)
  let o = 0
  for (const k of members) {
    for (let i = 0; i < N; i++) {
      if (base[k].arrival[i] < arrival[i]) arrival[i] = base[k].arrival[i]
      value[i] += base[k].value[i] / members.length
    }
    jumps.set(base[k].jumps, o)
    o += base[k].jumps.length
    // Which fire reaches each cell first: one run per ignition.
    for (const g of memberIgnitions[k]) {
      const alone = memberIgnitions[k].length === 1 ? base[k].arrival : runFire(k, { ignitions: [g] })
      for (let i = 0; i < N; i++)
        if (alone[i] < firstAlone[i]) {
          firstAlone[i] = alone[i]
          fireStart[i] = g.tMin
        }
    }
  }
  for (let i = 0; i < N; i++) if (arrival[i] !== Infinity && fireStart[i] === Infinity) throw new Error(`lines: cell ${i} burns but no single ignition's fire reaches it`)
  const sources = new Set(members.flatMap((k) => memberIgnitions[k].map((g) => g.cell)))
  if (zoneM > 0) {
    const rad = Math.ceil(zoneM / cellM)
    for (const g of memberIgnitions[0]) {
      const r0 = Math.floor(g.cell / cols)
      const c0 = g.cell % cols
      for (let r = Math.max(0, r0 - rad); r <= Math.min(rows - 1, r0 + rad); r++)
        for (let c = Math.max(0, c0 - rad); c <= Math.min(cols - 1, c0 + rad); c++) if (Math.hypot(r - r0, c - c0) * cellM <= zoneM) sources.add(r * cols + c)
    }
  }
  return { name, members, sourceCells: [...sources], fireStart, arrival, near: fireNearMin(arrival, rows, cols), jumps, value }
}
const DESIGNS = [designOf('tuned to the scenario', [0], 0), designOf('tuned to the ensemble', DESIGN_IDX, IGNITION_ZONE_M)]

// ---------------------------------------------------------------------------------------------------------
// When: lines that exist before the fire, or built by crews that leave their bases during it
// ---------------------------------------------------------------------------------------------------------
const allIgnitionCells = [...new Set(memberIgnitions.flatMap((g) => g.map((x) => x.cell)))]
const buildable = buildableCells(fuel, P.bldCell, allIgnitionCells)
const buildMin = buildMinutes(fuel, cellM)
const MARGIN = LINE_MODEL.marginMin.value

interface Mode {
  name: string
  /** Cells a line may use, for a design. */
  eligible: (d: Design) => Uint8Array
  /** When each cell of a line is finished. */
  ready: (d: Design, cells: Int32Array) => Float64Array
  /** Thresholds and prices of the proposals (fewer when every proposal has to be scheduled and repaired). */
  untilMin: number[]
  lambdas: number[]
  /** How many times a proposal is cut again without the cells the crews would finish too late. */
  repairs: number
}
const fromAlert = (xs: number[]) => [...new Set(xs.map((x) => (x === Infinity ? horizonMin : Math.min(horizonMin, scenario.alertMin + x))))]
const PREBUILT: Mode = {
  name: 'line in place before the fire',
  eligible: () => buildable,
  ready: (_d, cells) => new Float64Array(cells.length).fill(-Infinity),
  untilMin: fromAlert(QUICK ? [120, Infinity] : [0, 60, 120, 240, Infinity]),
  lambdas: QUICK ? [0.005, 0.02, 0.1, 0.5, 5] : [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 5, 50],
  repairs: 0,
}
/** Crews leave every base of brigades.json at `departMin` (null = each cuerpo's own time in the scenario). */
function responseMode(departMin: number | null): Mode {
  const bases = brigades.stations.map((s) => {
    const t = departMin ?? scenario.brigades.dispatchMin[s.cuerpo]
    if (!Number.isFinite(t)) throw new Error(`lines: no dispatch time for cuerpo ${s.cuerpo}`)
    return { lon: s.lon, lat: s.lat, departMin: t }
  })
  const accessByDesign = new Map<Design, Float32Array>()
  /** When work can start on each cell: a crew is there, and the fire that reaches the cell has started (nobody
   *  builds a line for a fire that does not exist yet; detection is taken as immediate once crews are out). */
  const accessOf = (d: Design): Float32Array => {
    let a = accessByDesign.get(d)
    if (!a) {
      a = crewAccessMin({ prepared, grid, arrivalMin: d.arrival, bases, carKmhByClass: DEFAULT_EVAC_PARAMS.carKmhByClass, safetyMarginMin: DEFAULT_EVAC_PARAMS.safetyMarginMin })
      for (let i = 0; i < N; i++) if (d.fireStart[i] !== Infinity && d.fireStart[i] > a[i]) a[i] = d.fireStart[i]
      accessByDesign.set(d, a)
    }
    return a
  }
  return {
    name: `line built during the fire (${CREWS} crews leave at ${[...new Set(bases.map((b) => hhmm(b.departMin)))].join(' / ')})`,
    eligible: (d) => cellsInTime(buildable, accessOf(d), buildMin, d.near, MARGIN),
    ready: (d, cells) => {
      const access = accessOf(d)
      const jobs: LineJob[] = Array.from(cells, (cell) => ({ cell, releaseMin: access[cell], buildMin: buildMin[cell], deadlineMin: d.near[cell] - MARGIN }))
      return scheduleLine(jobs, CREWS).readyMin
    },
    untilMin: fromAlert(QUICK ? [Infinity] : [120, Infinity]),
    lambdas: QUICK ? [0.02, 0.5] : [0.01, 0.05, 0.2, 1, 5],
    repairs: QUICK ? 2 : 4,
  }
}
/** --dispatch 12:30,15:10: one "built during the fire" case per departure time; "file" = brigades.json's times. */
const dispatchTimes = (arg('--dispatch') ?? 'file,12:30').split(',').map((x) => {
  if (x === 'file') return null
  const t = localToMin(grid.t0, `${grid.t0.slice(0, 10)}T${x}`)
  if (!/^\d\d:\d\d$/.test(x) || !Number.isFinite(t)) throw new Error(`lines: --dispatch takes HH:MM or "file", comma separated (got ${x})`)
  return t
})
const MODES = [PREBUILT, ...dispatchTimes.map(responseMode)]

// ---------------------------------------------------------------------------------------------------------
// Scoring a line on the real engines
// ---------------------------------------------------------------------------------------------------------
const cache = new Map<string, number>()
/** Households cut off in member k with this line (cells finished at readyMin). */
function trappedWith(k: number, cells: Int32Array, readyMin: Float64Array): number {
  if (cells.length === 0) return base[k].trapped
  const key = `${k}|${Array.from(cells).join(',')}|${Array.from(readyMin, (x) => Math.round(x * 10)).join(',')}`
  let t = cache.get(key)
  if (t === undefined) {
    t = runEvac(runFire(k, { defense: lineDefense(N, cells, readyMin) })).expectedTrappedHouseholds
    cache.set(key, t)
  }
  return t
}
/** Mean households cut off over a design's members: what the search minimises. */
const objective = (d: Design, mode: Mode, cells: Int32Array): number => {
  const ready = mode.ready(d, cells)
  let s = 0
  for (const k of d.members) s += trappedWith(k, cells, ready)
  return s / d.members.length
}

// ---------------------------------------------------------------------------------------------------------
// Proposals (minimum cuts), then greedy add / remove on the real engines
// ---------------------------------------------------------------------------------------------------------
const POOL_MAX = QUICK ? 10 : 20
const ADD_ROUNDS = QUICK ? 2 : 3
const TOLERANCE = 0.5

interface Proposal {
  untilMin: number
  lambda: number
  cells: Int32Array
  protectedValue: number
}
function proposals(d: Design, mode: Mode): Proposal[] {
  const t = performance.now()
  const eligible = mode.eligible(d)
  let nEligible = 0
  for (let i = 0; i < N; i++) if (eligible[i] && d.arrival[i] !== Infinity) nEligible++
  const out: Proposal[] = []
  const seen = new Set<string>()
  let flows = 0
  let graph = ''
  let repaired = 0
  const curve: string[] = []
  for (const untilMin of mode.untilMin) {
    const cut = new LineCut({ rows, cols, arrivalMin: d.arrival, jumps: d.jumps, ignitionCells: d.sourceCells, eligible, value: d.value, untilMin })
    if (untilMin === horizonMin) graph = `${cut.cellCount} cells, ${(cut.jumpCount / 1e6).toFixed(2)} M ember jumps, ${cut.totalValue.toFixed(0)} households at stake`
    for (const lambda of mode.lambdas) {
      // Cut, schedule the crews, forbid the cells they would finish too late, cut again. Every pass is kept as
      // a proposal: the pieces of a cut the crews cannot finish whole are still candidates for the search.
      const forbidden = new Set<number>()
      const keep = (r: { cells: Int32Array; protectedValue: number }) => {
        if (r.cells.length === 0) return
        const key = Array.from(r.cells).join(',')
        if (seen.has(key)) return
        seen.add(key)
        out.push({ untilMin, lambda, cells: r.cells, protectedValue: r.protectedValue })
      }
      let r = cut.solve(lambda)
      flows++
      keep(r)
      if (untilMin === horizonMin) curve.push(`    cut to the end (${hhmm(horizonMin)}) at ${String(lambda).padStart(5)} cells per household: ${km(r.cells.length).toFixed(1).padStart(6)} km keeps the fire from ${r.protectedValue.toFixed(0).padStart(5)} of ${cut.totalValue.toFixed(0)} households (by the graph, before scheduling crews)`)
      for (let pass = 0; pass < mode.repairs && r.cells.length > 0; pass++) {
        const ready = mode.ready(d, r.cells)
        let late = 0
        for (let q = 0; q < r.cells.length; q++)
          if (ready[q] > d.near[r.cells[q]] - MARGIN) {
            forbidden.add(r.cells[q])
            late++
          }
        if (late === 0) break
        r = cut.solve(lambda, forbidden)
        flows++
        repaired++
        keep(r)
      }
    }
  }
  console.log(`  proposals: ${nEligible} cells may hold a line; spread graph ${graph}; ${flows} minimum cuts (${repaired} repairs) in ${secs(t)} s -> ${out.length} distinct lines`)
  for (const line of curve) console.log(line)
  return out
}

interface Line {
  cells: Int32Array
  readyMin: Float64Array
  note: string
}
/** What a search hands to the search of the next (larger) budget: its line and the pieces it tried, so that
 *  more line never gives a worse result on what the search minimises. */
interface Carry {
  cells: Int32Array
  pool: Int32Array[]
}
function search(d: Design, mode: Mode, props: Proposal[], budgetCells: number, carry: Carry | null): { line: Line; carry: Carry } {
  const t = performance.now()
  const fits = props.filter((p) => p.cells.length <= budgetCells)
  // Per threshold, the two largest proposals inside the budget, scored on the real engines; and the line the
  // smaller budget ended with.
  const shortlist: { label: string; cells: Int32Array }[] = []
  for (const untilMin of mode.untilMin)
    for (const p of fits.filter((q) => q.untilMin === untilMin).sort((a, b) => b.cells.length - a.cells.length).slice(0, 2))
      shortlist.push({ label: `the cut to ${hhmm(p.untilMin)} at ${p.lambda} cells per household (${km(p.cells.length).toFixed(1)} km)`, cells: p.cells })
  if (carry && carry.cells.length > 0) shortlist.push({ label: `the line of the smaller budget (${km(carry.cells.length).toFixed(1)} km)`, cells: carry.cells })
  let start: { label: string; cells: Int32Array } | null = null
  let startScore = objective(d, mode, new Int32Array(0))
  for (const p of shortlist) {
    const s = objective(d, mode, p.cells)
    if (s < startScore - TOLERANCE) {
      start = p
      startScore = s
    }
  }
  const pieces = new Map<string, Int32Array>()
  for (const p of props.filter((q) => q.cells.length <= 3 * budgetCells))
    for (const seg of lineSegments(rows, cols, p.cells)) if (seg.length <= budgetCells) pieces.set(Array.from(seg).join(','), seg)
  // The largest pieces of this budget, plus every piece the smaller budgets tried.
  const poolByKey = new Map<string, Int32Array>()
  for (const seg of [...pieces.values()].sort((a, b) => b.length - a.length).slice(0, POOL_MAX)) poolByKey.set(Array.from(seg).join(','), seg)
  for (const seg of carry?.pool ?? []) poolByKey.set(Array.from(seg).join(','), seg)
  const pool = [...poolByKey.values()]
  const r = refineLine({
    start: start ? lineSegments(rows, cols, start.cells) : [],
    pool,
    budgetCells,
    evaluate: (cells) => objective(d, mode, cells),
    tolerance: TOLERANCE,
    maxAddRounds: ADD_ROUNDS,
  })
  return {
    line: {
      cells: r.cells,
      readyMin: mode.ready(d, r.cells),
      note: `${start ? `starts from ${start.label}` : 'no proposal inside the budget helps on its own'}; dropped ${r.dropped} pieces, added ${r.added} of ${pool.length}; ${r.evaluations} engine checks, ${secs(t)} s`,
    },
    carry: { cells: r.cells, pool },
  }
}

// ---------------------------------------------------------------------------------------------------------
// Comparisons: random lines, and the Plan de preparación belt at the same treated area
// ---------------------------------------------------------------------------------------------------------
/** mulberry32, as in plan/bake.ts: reproducible draws. */
function prng(seed: number): () => number {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const RANDOM_SEED = 20240202
/** Straight segments of about 1 km, anywhere a line may go inside the area the scenario burns. */
const RANDOM_SEGMENT_CELLS = Math.round(1000 / cellM)
function randomLine(rnd: () => number, eligible: Uint8Array, burned: Float32Array, budgetCells: number): Int32Array {
  const where: number[] = []
  for (let i = 0; i < N; i++) if (eligible[i] && burned[i] !== Infinity) where.push(i)
  if (where.length === 0) return new Int32Array(0)
  const cells = new Set<number>()
  for (let guard = 0; guard < 10000 && cells.size < budgetCells; guard++) {
    const startCell = where[Math.floor(rnd() * where.length)]
    const ang = rnd() * Math.PI
    let r = Math.floor(startCell / cols)
    let c = startCell % cols
    let pr = r
    let pc = c
    for (let s = 0; s < RANDOM_SEGMENT_CELLS && cells.size < budgetCells; s++) {
      r = Math.floor(startCell / cols) + Math.round(s * Math.sin(ang))
      c = (startCell % cols) + Math.round(s * Math.cos(ang))
      if (r < 0 || c < 0 || r >= rows || c >= cols) break
      // 8-connected chain (the engine's corner rules make it watertight).
      if (Math.abs(r - pr) > 1 || Math.abs(c - pc) > 1) throw new Error('lines: random segment is not connected')
      const i = r * cols + c
      if (eligible[i] && burned[i] !== Infinity) cells.add(i)
      pr = r
      pc = c
    }
  }
  return Int32Array.from(cells).sort()
}

// ---------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------
interface Row {
  label: string
  cells: number
  /** Households saved per member (baseline minus with the measure). */
  saved: number[]
}
const stat = (xs: number[]) => ({ mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs) })
function rowOfLine(label: string, line: Line): Row {
  return { label, cells: line.cells.length, saved: MEMBERS.map((_, k) => base[k].trapped - trappedWith(k, line.cells, line.readyMin)) }
}
function printRows(rowsOut: Row[]) {
  console.log(
    `    ${'measure'.padEnd(34)} ${'km'.padStart(5)} ${'scenario'.padStart(9)} ${'wind/dir.'.padStart(9)} ${'ign. moved'.padStart(10)} ${'ens. mean'.padStart(9)} ${'ens. worst'.padStart(10)} ${'unseen mean'.padStart(11)} ${'unseen worst'.padStart(12)}`,
  )
  for (const r of rowsOut) {
    const e = stat(DESIGN_IDX.map((k) => r.saved[k]))
    const h = stat(HELD_IDX.map((k) => r.saved[k]))
    // Mean households saved over some members, and its share of their mean baseline.
    const pct = (k: number[]) => {
      const x = stat(k.map((q) => r.saved[q])).mean
      return `${x.toFixed(0)}`.padStart(6) + ` ${((100 * x) / stat(k.map((q) => base[q].trapped)).mean).toFixed(0).padStart(2)}%`
    }
    console.log(
      `    ${r.label.padEnd(34)} ${km(r.cells).toFixed(1).padStart(5)} ${pct([0]).padStart(9)} ${pct(WEATHER_IDX).padStart(9)} ${pct(MOVED_IDX).padStart(10)} ${pct(DESIGN_IDX).padStart(9)} ${e.min.toFixed(0).padStart(10)} ${pct(HELD_IDX).padStart(11)} ${h.min.toFixed(0).padStart(12)}`,
    )
  }
}

const cellHa = (cellM * cellM) / 1e4
console.log(`\nhouseholds saved = households cut off without the measure minus with it (expectedTrappedHouseholds); % of the baseline of the same members`)
console.log(`ensemble = the ${DESIGN.length} design members: the scenario, wind/dir. (wind x0.8 / x1.2, direction +-10 deg) and ign. moved (ignitions 1 km N/E/S/W); unseen = ${HELD_OUT.length} members no search saw`)
const detail: { title: string; row: Row }[] = []
/** The lines found, for --out: cell indices (row-major) and when each is finished (minutes since t0; null = in
 *  place before the fire). */
const saved: { case: string; budgetKm: number; search: string; km: number; cells: number[]; readyMin: (number | null)[] }[] = []
/** Where a line is: its pieces and how far its cells are from the scenario's ignition points. */
function whereIs(cells: Int32Array): string {
  let lo = Infinity
  let hi = 0
  for (const i of cells) {
    let d = Infinity
    for (const g of memberIgnitions[0]) d = Math.min(d, Math.hypot(Math.floor(i / cols) - Math.floor(g.cell / cols), (i % cols) - (g.cell % cols)) * cellM)
    lo = Math.min(lo, d)
    hi = Math.max(hi, d)
  }
  const segs = lineSegments(rows, cols, cells)
  return `${segs.length} pieces (the longest ${km(segs[0].length).toFixed(1)} km), ${(lo / 1000).toFixed(1)} to ${(hi / 1000).toFixed(1)} km from the nearest ignition point of the scenario`
}
for (const mode of MODES) {
  console.log(`\n=== ${mode.name} ===`)
  const props = new Map<Design, Proposal[]>()
  for (const d of DESIGNS) {
    console.log(`  search ${d.name}:`)
    props.set(d, proposals(d, mode))
  }
  const carry = new Map<Design, Carry>()
  for (const budgetKm of [...BUDGETS_KM].sort((a, b) => a - b)) {
    const budgetCells = Math.floor((budgetKm * 1000) / cellM)
    console.log(`\n  budget ${budgetKm} km of line (${budgetCells} cells, ${(budgetCells * cellHa).toFixed(0)} ha at the grid's 60 m):`)
    const out: Row[] = []
    for (const d of DESIGNS) {
      const found = search(d, mode, props.get(d)!, budgetCells, carry.get(d) ?? null)
      carry.set(d, found.carry)
      const line = found.line
      console.log(`    ${d.name}: ${line.note}`)
      if (line.cells.length > 0) console.log(`      ${whereIs(line.cells)}`)
      saved.push({ case: mode.name, budgetKm, search: d.name, km: km(line.cells.length), cells: Array.from(line.cells), readyMin: Array.from(line.readyMin, (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null)) })
      if (mode !== PREBUILT && line.cells.length > 0) {
        const fin = Array.from(line.readyMin).filter(Number.isFinite)
        const jobsLate = Array.from(line.cells).filter((c, q) => line.readyMin[q] > d.near[c] - MARGIN).length
        console.log(`      crews finish the first cell at ${hhmm(Math.min(...fin))} and the last at ${hhmm(Math.max(...fin))}; ${jobsLate} of ${line.cells.length} cells are finished less than ${MARGIN} min before the fire is within two cells`)
      }
      const row = rowOfLine(`line ${d.name}`, line)
      out.push(row)
      detail.push({ title: `${mode.name}, ${budgetKm} km, ${d.name}`, row })
    }
    // Random lines with the same budget, where the same mode allows a line (scheduled the same way).
    const rnd = prng(RANDOM_SEED + budgetCells)
    const d0 = DESIGNS[0]
    const elig = mode.eligible(d0)
    const draws: Row[] = []
    for (let q = 0; q < RANDOM_DRAWS; q++) {
      const cells = randomLine(rnd, elig, d0.arrival, budgetCells)
      draws.push(rowOfLine('random', { cells, readyMin: mode.ready(d0, cells), note: '' }))
    }
    const meanRow: Row = { label: `random lines (mean of ${RANDOM_DRAWS})`, cells: stat(draws.map((r) => r.cells)).mean, saved: MEMBERS.map((_, k) => stat(draws.map((r) => r.saved[k])).mean) }
    const bestDraw = draws.reduce((a, b) => (stat(DESIGN_IDX.map((k) => b.saved[k])).mean > stat(DESIGN_IDX.map((k) => a.saved[k])).mean ? b : a))
    out.push(meanRow, { ...bestDraw, label: `random lines (best of ${RANDOM_DRAWS})` })
    if (mode === PREBUILT) {
      // The belt of the preparation plan, best tiles first, filled to the same treated area.
      for (const ha of [budgetCells * cellHa, 1000]) {
        const tiles = fillBudget(plan.tiles, (t) => t.ha, ha).map((t) => t.tile)
        let used = 0
        for (const t of plan.tiles) if (tiles.includes(t.tile)) used += t.ha
        const saved = MEMBERS.map((_, k) => {
          if (tiles.length === 0) return 0
          const a = applyBelt(belt, tiles, fuel, NO_FIREBREAK, memberIgnitions[k].map((g) => g.cell))
          return base[k].trapped - runEvac(runFire(k, { fuel: a.fuel, firebreak: a.firebreak })).expectedTrappedHouseholds
        })
        out.push({ label: `plan.json belt, ${used.toFixed(0)} ha (${tiles.length} tiles)`, cells: used / cellHa, saved })
      }
    }
    printRows(out)
  }
}

console.log('\nper member (households saved):')
console.log(`  ${'line'.padEnd(78)} ${MEMBERS.map((_, k) => `m${k}`.padStart(6)).join('')}`)
for (const { title, row } of detail) console.log(`  ${title.padEnd(78)} ${row.saved.map((x) => x.toFixed(0).padStart(6)).join('')}`)
console.log(`  members: ${MEMBERS.map((m, k) => `m${k} ${m.name}`).join('; ')}`)
const OUT = arg('--out')
if (OUT !== undefined) {
  writeFileSync(OUT, JSON.stringify({ event: event.id, grid: { rows, cols, cellM, t0: grid.t0 }, lines: saved }))
  console.log(`\nwrote ${saved.length} lines to ${OUT}`)
}
console.log(`\n${fireRuns} fire runs, ${secs(T0)} s in all. The lines are the best this search found, checked by the simulator; they are not an optimum.`)
