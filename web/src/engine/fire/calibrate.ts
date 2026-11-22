// Calibration against the Sentinel-2 burn scar: runs the engine on the baked dataset (web/public/data) with the
// historical weather and the preset ignitions, and scores the burned area against scar.bin (cells marked 255,
// "no data", are ignored). Every calibration number quoted in MODEL.md comes from this script.
//
//   pnpm exec tsx src/engine/fire/calibrate.ts          # score the current FIRE_MODEL / DEFAULT_FIRE_PARAMS
//   pnpm exec tsx src/engine/fire/calibrate.ts --scan   # grid search over the main knobs, best first
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lonLatToCell } from '../../data/grid'
import { parseElevation, parseFirms, parseFuel, parseGrid, parseIgnitions, parseScar, parseWeather } from '../../data/load'
import { localToMin } from '../../data/time'
import type { FireParams, WeatherSeries } from '../types'
import { DEFAULT_FIRE_PARAMS, FIRE_MODEL, SPREAD_MODEL, simulateFire } from './index'

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

function weather(windFactor: number): WeatherSeries {
  const t0Min = localToMin(grid.t0, weatherFile.times[0])
  return {
    t0Min,
    stepMin: localToMin(grid.t0, weatherFile.times[1]) - t0Min,
    samples: weatherFile.times.map((_, i) => ({
      tempC: weatherFile.tempC[i],
      rh: weatherFile.rh[i],
      windKmh: weatherFile.windKmh[i] * windFactor,
      windFromDeg: weatherFile.windFromDeg[i],
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
  params: Partial<FireParams>
}

function run(k: Knobs) {
  const saved = JSON.stringify(FIRE_MODEL)
  FIRE_MODEL.modelFactor[SPREAD_MODEL.MCARTHUR_FOREST] = k.forestShrubFactor
  FIRE_MODEL.modelFactor[SPREAD_MODEL.CSIRO_GRASS] = k.grassFactor
  FIRE_MODEL.slopeWindKmhPerDeg = k.slopeWindKmhPerDeg
  FIRE_MODEL.spotMinSourceRosMPerMin = k.spotMinSourceRosMPerMin
  const params = { ...DEFAULT_FIRE_PARAMS, ...k.params }
  const res = simulateFire({ grid, elevation, fuel, firebreak, ignitions, weather: weather(k.windFactor), params })
  Object.assign(FIRE_MODEL, JSON.parse(saved))
  return { res, end: score(res.arrivalMin, params.horizonMin), at24: score(res.arrivalMin, localToMin(grid.t0, '2024-02-03T00:00')) }
}

const fmt = (s: ReturnType<typeof score>) => `Dice ${s.dice.toFixed(3)}, IoU ${s.iou.toFixed(3)} (recall ${s.recall.toFixed(2)}, precision ${s.precision.toFixed(2)}, ${s.ha.toFixed(0)} ha)`

const current: Knobs = {
  forestShrubFactor: FIRE_MODEL.modelFactor[SPREAD_MODEL.MCARTHUR_FOREST],
  grassFactor: FIRE_MODEL.modelFactor[SPREAD_MODEL.CSIRO_GRASS],
  slopeWindKmhPerDeg: FIRE_MODEL.slopeWindKmhPerDeg,
  spotMinSourceRosMPerMin: FIRE_MODEL.spotMinSourceRosMPerMin,
  windFactor: 1,
  params: {},
}

console.log(`grid ${grid.rows} x ${grid.cols}, ${grid.cellM} m; ignitions ${presets.map((p) => `${p.id} @ ${p.timeLocal}`).join(', ')}`)
console.log(`scar: ${score(new Float32Array(n), 0).realHa.toFixed(0)} ha burned (no-data cells ignored)\n`)

if (!process.argv.includes('--scan')) {
  // The headline number: the shipped defaults, historical wind (x1), spotting on, scored at the UI horizon.
  const shipped = run({ ...current, params: {} })
  const validation = {
    note: 'Defaults as shipped, ERA5 wind x1, spotting on, preset ignitions; burned by the horizon vs the Sentinel-2 scar (final footprint, no-data cells ignored). In-sample: the model factors were fitted on this same fire.',
    evalTime: '2024-02-03T00:00',
    dice: Number(shipped.end.dice.toFixed(3)),
    iou: Number(shipped.end.iou.toFixed(3)),
    precision: Number(shipped.end.precision.toFixed(3)),
    recall: Number(shipped.end.recall.toFixed(3)),
    modelHa: Math.round(shipped.end.ha),
    scarHa: Math.round(shipped.end.realHa),
    runMs: Math.round(shipped.res.elapsedMs),
    firmsReached: firmsReached(shipped.res.arrivalMin),
  }
  writeFileSync(dir + 'validation.json', JSON.stringify(validation, null, 2) + '\n')
  console.log(`shipped defaults at the horizon: ${fmt(shipped.end)}`)
  console.log(`FIRMS detections of 2 Feb already reached by the model at detection time: ${validation.firmsReached.reached}/${validation.firmsReached.total}`)
  console.log('wrote public/data/validation.json\n')
  const raw = { ...current, forestShrubFactor: 1, grassFactor: 1, spotMinSourceRosMPerMin: 0 }
  for (const spotting of [true, false]) {
    const r = run({ ...raw, params: { spotting } })
    console.log(`uncalibrated (model factors 1, no spotting gate), spotting ${spotting ? 'on ' : 'off'}, wind x1:`)
    console.log(`   at horizon: ${fmt(r.end)}`)
  }
  for (const spotting of [true, false]) {
    for (const windFactor of [1, 1.5]) {
      const r = run({ ...current, windFactor, params: { spotting } })
      console.log(`current model, spotting ${spotting ? 'on ' : 'off'}, wind x${windFactor}: ${r.res.elapsedMs.toFixed(0)} ms`)
      console.log(`   at horizon: ${fmt(r.end)}`)
      console.log(`   by 24:00:   ${fmt(r.at24)}`)
    }
  }
} else {
  const rows: [number, string][] = []
  for (const slopeWindKmhPerDeg of [FIRE_MODEL.slopeWindKmhPerDeg, 1.5])
    for (const forestShrubFactor of [1, 2, 3, 4, 5])
      for (const grassFactor of [1, 0.6, 0.4, 0.25])
        for (const spotMinSourceRosMPerMin of [0, 15, 30, Infinity])
          for (const windFactor of [1, 1.5]) {
            const k = { forestShrubFactor, grassFactor, slopeWindKmhPerDeg, spotMinSourceRosMPerMin, windFactor, params: { spotting: true } }
            const r = run(k)
            const spot = spotMinSourceRosMPerMin === Infinity ? 'off' : `ROS>=${spotMinSourceRosMPerMin}`
            rows.push([
              r.end.iou,
              `slope ${slopeWindKmhPerDeg.toFixed(2)} forest/shrub x${forestShrubFactor} grass x${grassFactor} spotting ${spot} wind x${windFactor}: ${fmt(r.end)} | by 24:00 ${fmt(r.at24)}`,
            ])
          }
  rows.sort((a, b) => b[0] - a[0])
  for (const [, line] of rows.slice(0, 25)) console.log(line)
}
