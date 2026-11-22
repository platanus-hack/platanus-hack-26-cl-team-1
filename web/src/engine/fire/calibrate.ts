// Calibration against the Sentinel-2 burn scar: runs the engine on the baked dataset (web/public/data) with the
// historical weather and the preset ignitions, and scores the burned area against scar.bin (cells marked 255,
// "no data", are ignored), the buildings reached inside / outside the scar, the NASA FIRMS detections and the
// times reported for four neighbourhoods. The scar, FIRMS and the reported times are used only to score and
// to fit a handful of global scalars, never to build inputs. Every calibration number quoted in MODEL.md
// comes from this script.
//
//   pnpm exec tsx src/engine/fire/calibrate.ts          # score the current FIRE_MODEL / DEFAULT_FIRE_PARAMS
//   pnpm exec tsx src/engine/fire/calibrate.ts --scan   # grid search over the main knobs, best first
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lonLatToCell } from '../../data/grid'
import { parseBuildings, parseElevation, parseFirms, parseFuel, parseGrid, parseIgnitions, parseScar, parseWeather } from '../../data/load'
import { localToMin } from '../../data/time'
import type { FireParams, WeatherSeries } from '../types'
import { FUEL } from '../types'
import { DEFAULT_FIRE_PARAMS, ERA5_WIND_DIR_CORRECTION_DEG, FIRE_MODEL, SPREAD_MODEL, simulateFire } from './index'

const dir = fileURLToPath(new URL('../../../public/data/', import.meta.url))
const bin = (f: string) => {
  const b = readFileSync(dir + f)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const json = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'))

const grid = parseGrid(json('grid.json'))
const n = grid.rows * grid.cols
const fuel = parseFuel(bin('fuel.bin'), n)
const elevation = parseElevation(bin('elevation.bin'), n)
const scar = parseScar(bin('scar.bin'), n)
const weatherFile = parseWeather(json('weather.json'))
const presets = parseIgnitions(json('ignitions.json'))
const firebreak = new Uint8Array(n)
const firms = parseFirms(json('firms.json'))
const buildingXY = parseBuildings(bin('buildings.bin'))

/** Cell of every building, and the scar dilated by DILATE_CELLS (the 10-20 m Sentinel-2 dNBR misses burned
 *  houses inside built-up cells: Copernicus EMSR715 grades 333 ha of residential damage where the scar marks
 *  225 ha of built-up land; see MODEL.md section 6). */
const buildingCell = new Int32Array(buildingXY.length / 3)
for (let b = 0; b < buildingCell.length; b++) buildingCell[b] = lonLatToCell(grid, buildingXY[3 * b], buildingXY[3 * b + 1])
const DILATE_CELLS = 2 // 120 m
const scarNear = new Uint8Array(n)
for (let r = 0; r < grid.rows; r++)
  for (let c = 0; c < grid.cols; c++) {
    if (scar[r * grid.cols + c] !== 1) continue
    for (let dr = -DILATE_CELLS; dr <= DILATE_CELLS; dr++)
      for (let dc = -DILATE_CELLS; dc <= DILATE_CELLS; dc++) {
        const rr = r + dr
        const cc = c + dc
        if (rr >= 0 && cc >= 0 && rr < grid.rows && cc < grid.cols && dr * dr + dc * dc <= DILATE_CELLS * DILATE_CELLS) scarNear[rr * grid.cols + cc] = 1
      }
  }

/** Buildings reached by untilMin vs the buildings inside the scar (cells with no scar data are skipped). */
function buildingScore(arrival: Float32Array, untilMin: number) {
  let reached = 0
  let inScar = 0
  let scarTotal = 0
  let nearScar = 0
  for (const cell of buildingCell) {
    if (cell < 0 || scar[cell] === 255) continue
    if (scar[cell] === 1) scarTotal++
    if (!(arrival[cell] <= untilMin)) continue
    reached++
    if (scar[cell] === 1) inScar++
    if (scarNear[cell]) nearScar++
  }
  const recall = inScar / scarTotal
  const precision = reached > 0 ? inScar / reached : 0
  return {
    reached,
    inScar,
    scarTotal,
    recall,
    precision,
    /** Share of reached buildings inside the scar or within 120 m of it. */
    precisionNear: reached > 0 ? nearScar / reached : 0,
    f1: recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0,
  }
}

/** Times reported for the western fire (press and CIGIDEN, see MODEL.md section 6; OSM coordinates). Scoring
 *  only. Model time = first arrival within 300 m of the point. */
const ANCHORS = [
  { name: 'Jardín Botánico', lat: -33.048, lon: -71.492, observed: '2024-02-02T17:00', source: 'CIPER 2024-03-10; Wikipedia ES' },
  { name: 'Pompeya Sur', lat: -33.057, lon: -71.469, observed: '2024-02-02T18:10', source: 'Emol 2025-02-02; La Tercera' },
  { name: 'El Olivar', lat: -33.03, lon: -71.493, observed: '2024-02-02T18:30', source: 'The Clinic 2024-02-10; CIPER' },
  { name: 'Villa Independencia', lat: -33.021, lon: -71.491, observed: '2024-02-02T18:30', source: 'CIPER 2024-02-09; CIGIDEN' },
]
const ANCHOR_RADIUS_CELLS = 5
function anchorTimes(arrival: Float32Array) {
  return ANCHORS.map((a) => {
    const cell = lonLatToCell(grid, a.lon, a.lat)
    if (cell < 0) throw new Error(`calibrate: anchor ${a.name} is outside the grid`)
    const r0 = Math.floor(cell / grid.cols)
    const c0 = cell % grid.cols
    let t = Infinity
    for (let dr = -ANCHOR_RADIUS_CELLS; dr <= ANCHOR_RADIUS_CELLS; dr++)
      for (let dc = -ANCHOR_RADIUS_CELLS; dc <= ANCHOR_RADIUS_CELLS; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (dr * dr + dc * dc <= ANCHOR_RADIUS_CELLS ** 2 && r >= 0 && c >= 0 && r < grid.rows && c < grid.cols) t = Math.min(t, arrival[r * grid.cols + c])
      }
    const obs = localToMin(grid.t0, a.observed)
    return { name: a.name, observed: a.observed.slice(11), modelMin: t, deltaMin: t - obs }
  })
}
const hhmm = (tMin: number) => (Number.isFinite(tMin) ? `${String(Math.floor(12 + tMin / 60) % 24).padStart(2, '0')}:${String(Math.round(tMin % 60)).padStart(2, '0')}` : 'never')

/** Combined objective (higher is better): mean of Dice, building F1, FIRMS share reached and a timing score
 *  (1 at the reported time, 0 at 2 h off or never). */
function objective(dice: number, b: ReturnType<typeof buildingScore>, f: { reached: number; total: number }, a: ReturnType<typeof anchorTimes>) {
  const timing = a.reduce((s, x) => s + (Number.isFinite(x.deltaMin) ? Math.max(0, 1 - Math.abs(x.deltaMin) / 120) : 0), 0) / a.length
  return { objective: (dice + b.f1 + f.reached / f.total + timing) / 4, timing }
}

/** Share of the 2 Feb NASA FIRMS detections (VIIRS/MODIS, 375 m-1 km pixels) whose location the model fire has
 *  already reached, within 3 cells (180 m), at the satellite's detection time. */
function firmsReached(arrival: Float32Array) {
  const day = firms.filter((f) => f.timeLocal < '2024-02-03T00:00')
  let reached = 0
  let total = 0
  for (const f of day) {
    const cell = lonLatToCell(grid, f.lon, f.lat)
    if (cell < 0) continue
    total++
    const t = localToMin(grid.t0, f.timeLocal)
    const r0 = Math.floor(cell / grid.cols)
    const c0 = cell % grid.cols
    let hit = false
    for (let dr = -3; dr <= 3 && !hit; dr++)
      for (let dc = -3; dc <= 3 && !hit; dc++) {
        const r = r0 + dr
        const c = c0 + dc
        if (r >= 0 && c >= 0 && r < grid.rows && c < grid.cols && arrival[r * grid.cols + c] <= t) hit = true
      }
    if (hit) reached++
  }
  return { reached, total }
}

const ignitions = presets.map((p) => {
  const cell = lonLatToCell(grid, p.lon, p.lat)
  if (cell < 0) throw new Error(`calibrate: ignition ${p.id} is outside the grid`)
  return { cell, tMin: localToMin(grid.t0, p.timeLocal) }
})

function weather(windFactor: number, dirCorrectionDeg: number): WeatherSeries {
  const t0Min = localToMin(grid.t0, weatherFile.times[0])
  return {
    t0Min,
    stepMin: localToMin(grid.t0, weatherFile.times[1]) - t0Min,
    samples: weatherFile.times.map((_, i) => ({
      tempC: weatherFile.tempC[i],
      rh: weatherFile.rh[i],
      windKmh: weatherFile.windKmh[i] * windFactor,
      windFromDeg: (((weatherFile.windFromDeg[i] + dirCorrectionDeg) % 360) + 360) % 360,
    })),
  }
}

/** Intersection over union, recall and precision of "burned by untilMin" vs the scar. */
function score(arrival: Float32Array, untilMin: number) {
  let inter = 0
  let union = 0
  let sim = 0
  let real = 0
  for (let i = 0; i < n; i++) {
    if (scar[i] === 255) continue
    const b = arrival[i] <= untilMin ? 1 : 0 // Infinity (never) is > any untilMin
    const s = scar[i] === 1 ? 1 : 0
    inter += b & s
    union += b | s
    sim += b
    real += s
  }
  return {
    iou: inter / union,
    // Dice (Sørensen) = F1 of burned vs scar: the overlap figure quoted in the pitch.
    dice: (2 * inter) / (sim + real),
    recall: inter / real,
    precision: inter / sim,
    ha: (sim * grid.cellM ** 2) / 1e4,
    realHa: (real * grid.cellM ** 2) / 1e4,
  }
}

interface Knobs {
  forestShrubFactor: number
  grassFactor: number
  slopeWindKmhPerDeg: number
  spotMinSourceRosMPerMin: number
  windFactor: number
  windDirCorrectionDeg: number
  intermixFactor: number
  consolidatedEmbers: boolean
  params: Partial<FireParams>
}

function run(k: Knobs) {
  const saved = JSON.stringify(FIRE_MODEL)
  FIRE_MODEL.modelFactor[SPREAD_MODEL.MCARTHUR_FOREST] = k.forestShrubFactor
  FIRE_MODEL.modelFactor[SPREAD_MODEL.CSIRO_GRASS] = k.grassFactor
  FIRE_MODEL.slopeWindKmhPerDeg = k.slopeWindKmhPerDeg
  FIRE_MODEL.spotMinSourceRosMPerMin = k.spotMinSourceRosMPerMin
  FIRE_MODEL.fuels[FUEL.URBAN_LOW].factor = k.intermixFactor
  FIRE_MODEL.fuels[FUEL.URBAN_DENSE].spotTarget = k.consolidatedEmbers
  const params = { ...DEFAULT_FIRE_PARAMS, ...k.params }
  const res = simulateFire({ grid, elevation, fuel, firebreak, ignitions, weather: weather(k.windFactor, k.windDirCorrectionDeg), params })
  Object.assign(FIRE_MODEL, JSON.parse(saved))
  const end = score(res.arrivalMin, params.horizonMin)
  const bld = buildingScore(res.arrivalMin, params.horizonMin)
  const fr = firmsReached(res.arrivalMin)
  const anchors = anchorTimes(res.arrivalMin)
  return { res, end, at24: score(res.arrivalMin, localToMin(grid.t0, '2024-02-03T00:00')), bld, firms: fr, anchors, ...objective(end.dice, bld, fr, anchors) }
}

const fmtFull = (r: ReturnType<typeof run>) =>
  `${fmt(r.end)}\n   buildings: ${r.bld.reached} reached, ${r.bld.inScar}/${r.bld.scarTotal} of those in the scar (recall ${r.bld.recall.toFixed(2)}, precision ${r.bld.precision.toFixed(2)}, within 120 m of the scar ${r.bld.precisionNear.toFixed(2)})` +
  `\n   FIRMS ${r.firms.reached}/${r.firms.total}; arrival ${r.anchors.map((a) => `${a.name} ${hhmm(a.modelMin)} (reported ${a.observed})`).join(', ')}` +
  `\n   objective ${r.objective.toFixed(3)} (timing score ${r.timing.toFixed(2)})`

const fmt = (s: ReturnType<typeof score>) => `Dice ${s.dice.toFixed(3)}, IoU ${s.iou.toFixed(3)} (recall ${s.recall.toFixed(2)}, precision ${s.precision.toFixed(2)}, ${s.ha.toFixed(0)} ha)`

const current: Knobs = {
  forestShrubFactor: FIRE_MODEL.modelFactor[SPREAD_MODEL.MCARTHUR_FOREST],
  grassFactor: FIRE_MODEL.modelFactor[SPREAD_MODEL.CSIRO_GRASS],
  slopeWindKmhPerDeg: FIRE_MODEL.slopeWindKmhPerDeg,
  spotMinSourceRosMPerMin: FIRE_MODEL.spotMinSourceRosMPerMin,
  windFactor: 1,
  windDirCorrectionDeg: ERA5_WIND_DIR_CORRECTION_DEG,
  intermixFactor: FIRE_MODEL.fuels[FUEL.URBAN_LOW].factor,
  consolidatedEmbers: FIRE_MODEL.fuels[FUEL.URBAN_DENSE].spotTarget,
  params: {},
}

console.log(`grid ${grid.rows} x ${grid.cols}, ${grid.cellM} m; ignitions ${presets.map((p) => `${p.id} @ ${p.timeLocal}`).join(', ')}`)
console.log(`scar: ${score(new Float32Array(n), 0).realHa.toFixed(0)} ha burned (no-data cells ignored)\n`)

if (!process.argv.includes('--scan')) {
  // The headline numbers: the shipped defaults, historical wind (x1, direction corrected), spotting on, at the UI horizon.
  const shipped = run({ ...current, params: {} })
  const validation = {
    note: 'Defaults as shipped, ERA5 wind x1 with the calibrated direction correction, spotting on, preset ignitions; burned by the horizon vs the Sentinel-2 scar (final footprint, no-data cells ignored). In-sample: the model factors and the wind correction were fitted on this same fire.',
    evalTime: '2024-02-03T00:00',
    dice: Number(shipped.end.dice.toFixed(3)),
    iou: Number(shipped.end.iou.toFixed(3)),
    precision: Number(shipped.end.precision.toFixed(3)),
    recall: Number(shipped.end.recall.toFixed(3)),
    modelHa: Math.round(shipped.end.ha),
    scarHa: Math.round(shipped.end.realHa),
    runMs: Math.round(shipped.res.elapsedMs),
    firmsReached: shipped.firms,
    buildings: {
      reached: shipped.bld.reached,
      inScar: shipped.bld.inScar,
      scarTotal: shipped.bld.scarTotal,
      recall: Number(shipped.bld.recall.toFixed(3)),
      precision: Number(shipped.bld.precision.toFixed(3)),
      precisionWithin120m: Number(shipped.bld.precisionNear.toFixed(3)),
    },
    anchors: shipped.anchors.map((a) => ({ name: a.name, reported: a.observed, model: hhmm(a.modelMin) })),
    windDirCorrectionDeg: ERA5_WIND_DIR_CORRECTION_DEG,
  }
  writeFileSync(dir + 'validation.json', JSON.stringify(validation, null, 2) + '\n')
  console.log(`shipped defaults at the horizon: ${fmtFull(shipped)}`)
  console.log('wrote public/data/validation.json\n')
  // Before / after: what each change contributes (one at a time from the shipped model).
  const variants: [string, Partial<Knobs>][] = [
    ['no wind direction correction', { windDirCorrectionDeg: 0 }],
    ['embers also ignite consolidated city', { consolidatedEmbers: true }],
    ['intermix at x0.5 of grass (spec value)', { intermixFactor: 0.5 }],
    ['wind correction -5 deg', { windDirCorrectionDeg: -5 }],
    ['wind correction -15 deg', { windDirCorrectionDeg: -15 }],
    ['spotting off', { params: { spotting: false } }],
    ['wind x1.5', { windFactor: 1.5 }],
  ]
  for (const [name, v] of variants) {
    const r = run({ ...current, ...v })
    console.log(`${name}: ${r.res.elapsedMs.toFixed(0)} ms\n   ${fmtFull(r)}`)
  }
} else {
  const rows: [number, string][] = []
  for (const windDirCorrectionDeg of [0, -5, -10, -15, -20])
    for (const intermixFactor of [0.25, 0.5, 1])
      for (const consolidatedEmbers of [true, false])
        for (const forestShrubFactor of [2, 3, 4]) {
          const r = run({ ...current, windDirCorrectionDeg, intermixFactor, consolidatedEmbers, forestShrubFactor })
          rows.push([
            r.objective,
            `wind dir ${windDirCorrectionDeg} deg, intermix x${intermixFactor}, embers on consolidated ${consolidatedEmbers ? 'yes' : 'no'}, forest/shrub x${forestShrubFactor}:\n   ${fmtFull(r)}`,
          ])
        }
  rows.sort((a, b) => b[0] - a[0])
  for (const [, line] of rows.slice(0, 12)) console.log(line)
}
