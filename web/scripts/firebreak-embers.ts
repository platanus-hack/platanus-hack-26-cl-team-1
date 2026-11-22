// Measures what the Cortafuegos panel shows under a drawn firebreak (src/worker/emberRange.ts, D-034): one line drawn
// across the fire's path, at each ember distance of EMBER_RANGE_M_PER_KMH (plus embers off, for reference), with the
// event's preset ignitions, real weather and alert, no firefighters. Uses the worker's own helpers.
//
//   pnpm exec tsx scripts/firebreak-embers.ts                       # Talca: 8 km x 120 m, 1 km ahead of the fire
//   pnpm exec tsx scripts/firebreak-embers.ts --event talca --ahead-km 2 --length-km 8 --width 60
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBuildings, parseElevation, parseFuel, parseGrid, parseIgnitions, parseRoads, parseWeather } from '../src/data/load'
import { checkEvent, EVENTS } from '../src/data/events'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from '../src/engine/evac'
import { DEFAULT_FIRE_PARAMS, simulateFire } from '../src/engine/fire'
import type { FireInput } from '../src/engine/types'
import { EMBER_RANGE_M_PER_KMH, emberRangeRow, linesCutPct } from '../src/worker/emberRange'
import { buildIgnitions, buildWeatherSeries, FIREBREAK_WIDTHS, rasteriseFirebreaks, type FirebreakWidth, type Scenario, type WeatherSettings } from '../src/worker/scenario'

const args = process.argv.slice(2)
const OPTS = ['--event', '--ahead-km', '--length-km', '--width']
for (const a of args) if (a.startsWith('--') && !OPTS.includes(a)) throw new Error(`firebreak-embers: unknown option ${a}`)
const arg = (k: string, d: string) => {
  const i = args.indexOf(k)
  if (i < 0) return d
  if (i + 1 >= args.length) throw new Error(`firebreak-embers: ${k} needs a value`)
  return args[i + 1]
}
const eventId = arg('--event', 'talca')
const aheadKm = Number(arg('--ahead-km', '1'))
const lengthKm = Number(arg('--length-km', '8'))
const widthM = Number(arg('--width', '120')) as FirebreakWidth
if (!(eventId in EVENTS)) throw new Error(`firebreak-embers: unknown event ${eventId} (${Object.keys(EVENTS).join(', ')})`)
if (!(aheadKm > 0) || !(lengthKm > 0)) throw new Error('firebreak-embers: --ahead-km and --length-km must be > 0')
if (!FIREBREAK_WIDTHS.includes(widthM)) throw new Error(`firebreak-embers: --width must be one of ${FIREBREAK_WIDTHS.join(', ')}`)
const event = checkEvent(EVENTS[eventId as keyof typeof EVENTS])

const dir = fileURLToPath(new URL(`../public/data/${event.dir}`, import.meta.url))
const bin = (f: string) => {
  const b = readFileSync(dir + f)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const json = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'))
const grid = parseGrid(json('grid.json'))
const N = grid.rows * grid.cols
const fuel = parseFuel(bin('fuel.bin'), N)
const elevation = parseElevation(bin('elevation.bin'), N)
const buildings = parseBuildings(bin('buildings.bin'))
const roads = parseRoads(json('roads.json'))
const presets = parseIgnitions(json('ignitions.json'))
const weatherFile = parseWeather(json('weather.json'))
const prepared = prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })

const weather: WeatherSettings = { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }
const s = { weather, presetIgnitions: presets.map((p) => p.id), userIgnitions: [], firebreaks: [] } as unknown as Scenario
const ignitions = buildIgnitions(grid, presets, s)
const wb = buildWeatherSeries(weatherFile, grid.t0, weather, event.windDirCorrectionDeg)
if (wb.notes.length > 0) throw new Error(`firebreak-embers: the weather needed adjusting: ${wb.notes.join(' ')}`)
const alertMin = event.evac.alertMin.value
const trapped = (arrivalMin: Float32Array) =>
  simulateEvac({ prepared, arrivalMin, params: { ...DEFAULT_EVAC_PARAMS, alertMin }, edits: { closedEdges: [], addedLinks: [] } }).expectedTrappedHouseholds
const params = { ...DEFAULT_FIRE_PARAMS, horizonMin: event.horizonMin }
const noLines = new Uint8Array(N)
const input = (firebreak: Uint8Array): FireInput => ({ grid, elevation, fuel, firebreak, ignitions, weather: wb.series, params })

// Head bearing: the burned cell farthest from the first ignition by the alert, on the fire without lines.
const base = simulateFire(input(noLines))
const [lon0, lat0] = [presets[0].lon, presets[0].lat]
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
const ky = 110540
let hx = 0
let hy = 0
for (let i = 0; i < N; i++) {
  if (!(base.arrivalMin[i] <= alertMin)) continue
  const r = Math.floor(i / grid.cols)
  const c = i - r * grid.cols
  const x = (grid.lonMin + (c + 0.5) * grid.dLon - lon0) * kx
  const y = (grid.latMax - (r + 0.5) * grid.dLat - lat0) * ky
  if (Math.hypot(x, y) > Math.hypot(hx, hy)) [hx, hy] = [x, y]
}
if (hx === 0 && hy === 0) throw new Error('firebreak-embers: the fire burned nothing before the alert')
const [ux, uy] = [hx / Math.hypot(hx, hy), hy / Math.hypot(hx, hy)]
const ll = (x: number, y: number): [number, number] => [lon0 + x / kx, lat0 + y / ky]
const [cx, cy, px, py] = [ux * aheadKm * 1000, uy * aheadKm * 1000, -uy * lengthKm * 500, ux * lengthKm * 500]
const firebreaks = [{ id: 'linea', points: [ll(cx - px, cy - py), ll(cx + px, cy + py)], widthM }]
const withLines = input(rasteriseFirebreaks(grid, firebreaks))
const bearing = ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360
console.log(
  `${event.id}: line ${lengthKm} km x ${widthM} m, ${aheadKm} km from the ignition toward ${bearing.toFixed(0)} deg ` +
    `(${firebreaks[0].points.map(([a, b]) => `${a.toFixed(4)}, ${b.toFixed(4)}`).join(' to ')}); alert ${alertMin} min after t0; no firefighters`,
)
const cellHa = (grid.cellM * grid.cellM) / 1e4
const show = (label: string, row: ReturnType<typeof emberRangeRow>) => {
  const pct = linesCutPct(row)
  console.log(
    `${label}: households cut off ${row.without.households.toFixed(0)} -> ${row.with.households.toFixed(0)} (${pct === null ? 'none without lines' : `-${pct.toFixed(1)} %`}), ` +
      `burned ${(row.without.burnedCells * cellHa).toFixed(0)} -> ${(row.with.burnedCells * cellHa).toFixed(0)} ha`,
  )
}
for (const m of EMBER_RANGE_M_PER_KMH) show(`embers ${m} m per km/h`, emberRangeRow(withLines, noLines, m, trapped))
// Embers off: the panel's first row when the scenario has them off.
show('embers off', emberRangeRow(withLines, noLines, null, trapped))
