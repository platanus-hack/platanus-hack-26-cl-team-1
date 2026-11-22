// Out-of-sample check of the fire model on another event: the model exactly as shipped (FIRE_MODEL and
// DEFAULT_FIRE_PARAMS were calibrated on Viña del Mar 2024 only; nothing is tuned here) runs on the event's
// baked data and is scored against what was observed. Writes public/data/<event dir>/validation.json, which
// the app's "Validación" section shows.
//   pnpm exec tsx src/engine/fire/validate-event.ts eaton-2025      (also: make validate-eaton)
// Scored against: the Sentinel-2 dNBR scar (scar.bin, same method as Viña), the official perimeter when the
// event ships one (perimeter.bin, 1 inside / 0 outside), the buildings inside the scar, and the FIRMS
// detections. Runs with the event's own wind-direction correction and, for comparison, with Viña's fitted one.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkEvent, EVENT_IDS, EVENTS, type EventId } from '../../data/events'
import { lonLatToCell } from '../../data/grid'
import { parseBuildings, parseElevation, parseFirms, parseFuel, parseGrid, parseIgnitions, parseScar, parseWeather } from '../../data/load'
import { localToMin, minToLocalIso } from '../../data/time'
import { buildWeatherSeries } from '../../worker/scenario'
import type { WeatherSettings } from '../../worker/scenario'
import { DEFAULT_FIRE_PARAMS, ERA5_WIND_DIR_CORRECTION_DEG, simulateFire } from './index'

const arg = process.argv[2] ?? 'eaton-2025'
const id = EVENT_IDS.find((e) => e === arg) as EventId | undefined
const scorable = EVENT_IDS.filter((e) => EVENTS[e].observedFire && e !== 'vina-2024')
if (!id) throw new Error(`validate-event: unknown event "${arg}" (events: ${scorable.join(', ')})`)
const event = checkEvent(EVENTS[id])
if (event.id === 'vina-2024') throw new Error('validate-event: Viña is in-sample; its score comes from calibrate.ts (pnpm validate)')
if (!event.observedFire) throw new Error(`validate-event: ${event.id} is a hypothetical scenario (no observed fire): there is no scar or FIRMS to score against`)
const dir = fileURLToPath(new URL(`../../../public/data/${event.dir}`, import.meta.url))
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
const firms = parseFirms(json('firms.json'))
const buildingXY = parseBuildings(bin('buildings.bin'))
const firebreak = new Uint8Array(n)

/** perimeter.bin: optional, Uint8 per cell, 1 inside the official final perimeter, 0 outside. */
function loadPerimeter(): Uint8Array | null {
  if (!existsSync(dir + 'perimeter.bin')) return null
  const p = new Uint8Array(bin('perimeter.bin'))
  if (p.length !== n) throw new Error(`perimeter.bin: ${p.length} values, expected ${n}`)
  for (const v of p) if (v !== 0 && v !== 1) throw new Error(`perimeter.bin: value ${v} outside {0, 1}`)
  return p
}
const perimeter = loadPerimeter()

const ignitions = presets.map((p) => {
  const cell = lonLatToCell(grid, p.lon, p.lat)
  if (cell < 0) throw new Error(`validate-event: ignition ${p.id} is outside the grid`)
  return { cell, tMin: localToMin(grid.t0, p.timeLocal) }
})

const buildingCell = new Int32Array(buildingXY.length / 3)
for (let b = 0; b < buildingCell.length; b++) buildingCell[b] = lonLatToCell(grid, buildingXY[3 * b], buildingXY[3 * b + 1])

/** Burned by untilMin vs an observed mask (255 = no data, skipped). Dice is the figure quoted for Viña. */
function overlap(arrival: Float32Array, truth: Uint8Array, untilMin: number) {
  let inter = 0
  let sim = 0
  let real = 0
  let union = 0
  for (let i = 0; i < n; i++) {
    if (truth[i] === 255) continue
    const b = arrival[i] <= untilMin ? 1 : 0
    const s = truth[i] === 1 ? 1 : 0
    inter += b & s
    union += b | s
    sim += b
    real += s
  }
  const ha = (c: number) => Math.round((c * grid.cellM ** 2) / 1e4)
  return {
    dice: round3((2 * inter) / (sim + real)),
    iou: round3(inter / union),
    recall: round3(inter / real),
    precision: sim > 0 ? round3(inter / sim) : 0,
    modelHa: ha(sim),
    observedHa: ha(real),
  }
}

/** Buildings reached by untilMin vs the buildings inside the scar. */
function buildings(arrival: Float32Array, untilMin: number) {
  let reached = 0
  let inScar = 0
  let scarTotal = 0
  for (const cell of buildingCell) {
    if (cell < 0 || scar[cell] === 255) continue
    if (scar[cell] === 1) scarTotal++
    if (!(arrival[cell] <= untilMin)) continue
    reached++
    if (scar[cell] === 1) inScar++
  }
  return { reached, inScar, scarTotal, recall: round3(inScar / scarTotal), precision: reached > 0 ? round3(inScar / reached) : 0 }
}

/** FIRMS detections up to untilMin that the simulated fire had reached (within 3 cells) by their pass time. */
function firmsReached(arrival: Float32Array, untilMin: number) {
  let reached = 0
  let total = 0
  for (const f of firms) {
    const t = localToMin(grid.t0, f.timeLocal)
    if (t < 0 || t > untilMin) continue
    const cell = lonLatToCell(grid, f.lon, f.lat)
    if (cell < 0) continue
    total++
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

const round3 = (x: number) => Math.round(x * 1000) / 1000
const NEUTRAL: WeatherSettings = { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }
/** Checkpoints: the same 12 h span as Viña's score (12:00 to midnight), and the event's own horizon. */
const checkpoints = [...new Set([Math.min(12 * 60, event.horizonMin), event.horizonMin])]

function runVariant(dirCorrectionDeg: number) {
  const weather = buildWeatherSeries(weatherFile, grid.t0, NEUTRAL, dirCorrectionDeg).series
  const res = simulateFire({ grid, elevation, fuel, firebreak, ignitions, weather, params: { ...DEFAULT_FIRE_PARAMS, horizonMin: event.horizonMin } })
  return {
    windDirCorrectionDeg: dirCorrectionDeg,
    elapsedMs: Math.round(res.elapsedMs),
    at: checkpoints.map((t) => ({
      timeLocal: minToLocalIso(grid.t0, t),
      scar: overlap(res.arrivalMin, scar, t),
      perimeter: perimeter ? overlap(res.arrivalMin, perimeter, t) : null,
      buildings: buildings(res.arrivalMin, t),
      firms: firmsReached(res.arrivalMin, t),
    })),
  }
}

const own = runVariant(event.windDirCorrectionDeg)
const vinaFit = ERA5_WIND_DIR_CORRECTION_DEG !== event.windDirCorrectionDeg ? runVariant(ERA5_WIND_DIR_CORRECTION_DEG) : null
const out = {
  event: event.id,
  note:
    'Out of sample: the fire model and its defaults as calibrated on Viña del Mar 2024, unchanged; real ERA5 weather (x1), spotting on, preset ignitions. ' +
    'Burned by each checkpoint vs the Sentinel-2 scar (final footprint, no-data cells ignored) and vs the official final perimeter. No firefighting in the model.',
  windDirCorrectionDeg: event.windDirCorrectionDeg,
  own,
  vinaWindCorrection: vinaFit,
}
writeFileSync(dir + 'validation.json', JSON.stringify(out, null, 1) + '\n')

const line = (v: typeof own) =>
  v.at
    .map((a) => {
      const p = a.perimeter ? ` | perimeter Dice ${a.perimeter.dice} (recall ${a.perimeter.recall}, precision ${a.perimeter.precision}, ${a.perimeter.observedHa} ha)` : ''
      return `  ${a.timeLocal}: scar Dice ${a.scar.dice} (recall ${a.scar.recall}, precision ${a.scar.precision}; model ${a.scar.modelHa} ha vs ${a.scar.observedHa} ha)${p}; buildings in scar reached ${a.buildings.inScar}/${a.buildings.scarTotal}; FIRMS ${a.firms.reached}/${a.firms.total}`
    })
    .join('\n')
console.log(`${event.id}: out-of-sample check, ${grid.rows} x ${grid.cols} cells, t0 ${grid.t0}`)
console.log(`wind correction ${own.windDirCorrectionDeg}° (the event's own), fire ${own.elapsedMs} ms\n${line(own)}`)
if (vinaFit) console.log(`wind correction ${vinaFit.windDirCorrectionDeg}° (Viña's fit), fire ${vinaFit.elapsedMs} ms\n${line(vinaFit)}`)
console.log(`wrote public/data/${event.dir}validation.json`)
