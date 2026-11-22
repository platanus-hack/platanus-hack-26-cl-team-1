// Calibration against satellite observations: runs the engine on the baked dataset (web/public/data) with the
// historical weather and the preset ignitions, and scores (1) the pace of each fire against GOES-16 fire pixels
// every 10 min (fit) and the VIIRS / MODIS passes (test, out of sample), in both directions (pacing.ts); (2) the
// burned area against the Sentinel-2 scar.bin (cells marked 255, "no data", are ignored); (3) the buildings
// reached inside / outside the scar. The times reported by the press for four neighbourhoods are printed next to
// the satellite and model times, as a contrast only. The scar, FIRMS and the reported times are used only to score and
// to fit a handful of global scalars, never to build inputs. Every calibration number quoted in MODEL.md
// comes from this script.
//
//   pnpm exec tsx src/engine/fire/calibrate.ts          # score the current FIRE_MODEL / DEFAULT_FIRE_PARAMS
//   pnpm exec tsx src/engine/fire/calibrate.ts --scan   # grid search over the main knobs, best first
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lonLatToCell } from '../../data/grid'
import { parseBuildings, parseElevation, parseFirms, parseFuel, parseGoes, parseGrid, parseIgnitions, parseScar, parseWeather } from '../../data/load'
import { localToMin, minToHHMM } from '../../data/time'
import type { FireParams, WeatherSeries } from '../types'
import { FUEL } from '../types'
import { DEFAULT_FIRE_PARAMS, ERA5_WIND_DIR_CORRECTION_DEG, FIRE_MODEL, SPREAD_MODEL, simulateFire } from './index'
import { FOOTPRINT_M, HALF_PIXEL_KM, LINK_KM, distanceKm, fireCluster, frontCurve, frontLagMin, modelFrontKm, observedFrontKm, overrunHa, type Obs } from './pacing'

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
const goes = parseGoes(json('goes.json'))

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
/** Satellite time of an anchor: first GOES-16 pixel of the western fire within this distance (one pixel). */
const ANCHOR_SAT_KM = 2
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
    const sat = Math.min(...FIRES[0].clusters.goes.filter((o) => distanceKm([a.lon, a.lat], o.lon, o.lat) <= ANCHOR_SAT_KM).map((o) => o.tMin))
    return { name: a.name, observed: a.observed.slice(11), satelliteMin: sat, modelMin: t, deltaMin: t - obs }
  })
}
const hhmm = (tMin: number) => (Number.isFinite(tMin) ? minToHHMM(grid.t0, tMin) : 'never')

/** Combined objective (higher is better): mean of the GOES-16 pace score (1 when the RMS front lag is 0, 0 at 2 h,
 *  averaged over both fires), Dice vs the scar and building F1. Press times are not in it (satellite is the
 *  reference); their timing score is printed for contrast (1 at the reported time, 0 at 2 h off or never). */
function objective(dice: number, b: ReturnType<typeof buildingScore>, pace: ReturnType<typeof pacing>, a: ReturnType<typeof anchorTimes>) {
  const timing = a.reduce((s, x) => s + (Number.isFinite(x.deltaMin) ? Math.max(0, 1 - Math.abs(x.deltaMin) / 120) : 0), 0) / a.length
  return { objective: (pace.lagScore + dice + b.f1) / 3, timing }
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

// ---- Pace against satellite passes (pacing.ts) -------------------------------------------------------------
type Sensor = 'goes' | 'viirs' | 'modis'
const toObs = (pts: { lon: number; lat: number; timeLocal: string }[]): Obs[] => pts.map((p) => ({ lon: p.lon, lat: p.lat, tMin: localToMin(grid.t0, p.timeLocal) }))
const OBS: Record<Sensor, Obs[]> = {
  goes: toObs(goes),
  viirs: toObs(firms.filter((f) => f.satellite.startsWith('VIIRS'))),
  modis: toObs(firms.filter((f) => f.satellite.startsWith('MODIS'))),
}
const FIRE_LABEL: Record<string, string> = { 'las-tablas-penuelas': 'west (Las Tablas)', 'quilpue-villa-alemana-oriente': 'east (Lo Moscoso)' }
/** Each preset fire with its own detections per sensor (space-time connected to its ignition, pacing.fireCluster). */
const FIRES = presets.map((p, i) => {
  const origin: [number, number] = [p.lon, p.lat]
  // Linked through the detections of every sensor (MODIS passed once that afternoon and cannot chain on its own),
  // with GOES's link radius; each sensor's front is then measured on its own detections.
  const all = (Object.keys(OBS) as Sensor[]).flatMap((s) => OBS[s].map((o) => ({ ...o, sensor: s })))
  const linked = fireCluster(all, origin, LINK_KM.goes)
  const only = (s: Sensor) => linked.filter((o) => o.sensor === s)
  const clusters: Record<Sensor, Obs[]> = { goes: only('goes'), viirs: only('viirs'), modis: only('modis') }
  return { id: p.id, label: FIRE_LABEL[p.id] ?? p.id, origin, ignition: ignitions[i], clusters }
})
const BIN_KM = 0.1
/** Passes of the polar orbiters (test set): one entry per (time, satellite). */
const TEST_PASSES = [...new Map(firms.map((f) => [`${f.timeLocal} ${f.satellite}`, f])).values()].map((f) => ({
  timeLocal: f.timeLocal,
  satellite: f.satellite,
  sensor: (f.satellite.startsWith('VIIRS') ? 'viirs' : 'modis') as Sensor,
  tMin: localToMin(grid.t0, f.timeLocal),
}))
const GOES_FRAMES = [...new Set(OBS.goes.map((o) => o.tMin))].sort((a, b) => a - b)

/** Front lag per fire against GOES-16 frames up to the horizon (fit) and against each VIIRS / MODIS pass (test).
 *  arrivals[i] is the arrival grid of fire i run alone, so each fire's front is measured without the other. */
function pacing(arrivals: Float32Array[], horizonMin: number) {
  const fires = FIRES.map((f, i) => {
    const curve = frontCurve(arrivals[i], grid, f.origin, BIN_KM)
    const lags: { tMin: number; obsKm: number; modelKm: number; lagMin: number }[] = []
    for (const t of GOES_FRAMES) {
      if (t > horizonMin || t < f.ignition.tMin) continue
      const d = observedFrontKm(f.clusters.goes, f.origin, t)
      if (d === null) continue
      lags.push({ tMin: t, obsKm: d, modelKm: modelFrontKm(curve, BIN_KM, t), lagMin: frontLagMin(curve, BIN_KM, d, t, HALF_PIXEL_KM.goes) })
    }
    const rmsLagMin = Math.sqrt(lags.reduce((s, x) => s + x.lagMin ** 2, 0) / Math.max(1, lags.length))
    const test = TEST_PASSES.filter((p) => p.tMin <= horizonMin && p.tMin >= f.ignition.tMin).flatMap((p) => {
      const d = observedFrontKm(f.clusters[p.sensor], f.origin, p.tMin)
      if (d === null) return []
      return [{
        time: p.timeLocal.slice(11),
        satellite: p.satellite,
        fire: f.label,
        obsKm: d,
        modelKm: modelFrontKm(curve, BIN_KM, p.tMin),
        lagMin: frontLagMin(curve, BIN_KM, d, p.tMin, HALF_PIXEL_KM[p.sensor]),
        overrunHa: overrunHa(arrivals[i], grid, f.clusters[p.sensor], p.tMin, FOOTPRINT_M[p.sensor]),
      }]
    })
    return { label: f.label, lags, rmsLagMin, test }
  })
  const lagScore = fires.reduce((s, f) => s + Math.max(0, 1 - f.rmsLagMin / 120), 0) / fires.length
  const testAbsLag = fires.flatMap((f) => f.test.map((x) => Math.abs(x.lagMin)))
  return { fires, lagScore, testMeanAbsLagMin: testAbsLag.reduce((s, x) => s + x, 0) / Math.max(1, testAbsLag.length) }
}

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
  spotIntensityExponent: number
  spotRefRosMPerMin: number
  /** Ensemble: per-cell ember jitter (FIRE_MODEL.spotJitterSigma) and number of members (seeds 1..members);
   *  the scored arrival is the per-cell median over members. 1 member with sigma 0 = a single run. */
  jitterSigma: number
  members: number
  /** Per-fuel spread factors (FIRE_MODEL.fuels[...].factor) of grassland and matorral, on top of the model factors. */
  grassFuelFactor: number
  shrubFuelFactor: number
  /** Ember jump time = spotDelayMin + spotTravelMin * d / D_max (FIRE_MODEL). */
  spotDelayMin: number
  spotTravelMin: number
  params: Partial<FireParams>
}

/** Per-cell median of several arrival grids (Infinity counts as the largest value). */
function medianArrival(runs: Float32Array[]): Float32Array {
  if (runs.length === 1) return runs[0]
  const out = new Float32Array(runs[0].length)
  const v = new Float64Array(runs.length)
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < runs.length; k++) v[k] = runs[k][i]
    v.sort()
    const m = runs.length >> 1
    out[i] = runs.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
  }
  return out
}

function run(k: Knobs) {
  const saved = JSON.stringify(FIRE_MODEL)
  FIRE_MODEL.modelFactor[SPREAD_MODEL.MCARTHUR_FOREST] = k.forestShrubFactor
  FIRE_MODEL.modelFactor[SPREAD_MODEL.CSIRO_GRASS] = k.grassFactor
  FIRE_MODEL.slopeWindKmhPerDeg = k.slopeWindKmhPerDeg
  FIRE_MODEL.spotMinSourceRosMPerMin = k.spotMinSourceRosMPerMin
  FIRE_MODEL.fuels[FUEL.URBAN_LOW].factor = k.intermixFactor
  FIRE_MODEL.fuels[FUEL.URBAN_DENSE].spotTarget = k.consolidatedEmbers
  FIRE_MODEL.spotIntensityExponent = k.spotIntensityExponent
  FIRE_MODEL.spotRefRosMPerMin = k.spotRefRosMPerMin
  FIRE_MODEL.spotJitterSigma = k.jitterSigma
  FIRE_MODEL.fuels[FUEL.GRASS].factor = k.grassFuelFactor
  FIRE_MODEL.fuels[FUEL.SHRUB].factor = k.shrubFuelFactor
  FIRE_MODEL.spotDelayMin = k.spotDelayMin
  FIRE_MODEL.spotTravelMin = k.spotTravelMin
  const params = { ...DEFAULT_FIRE_PARAMS, ...k.params }
  const w = weather(k.windFactor, k.windDirCorrectionDeg)
  const combined: Float32Array[] = []
  const single: Float32Array[][] = ignitions.map(() => [])
  let elapsedMs = 0
  for (let m = 1; m <= k.members; m++) {
    FIRE_MODEL.spotJitterSeed = m
    const one = simulateFire({ grid, elevation, fuel, firebreak, ignitions, weather: w, params })
    elapsedMs += one.elapsedMs
    combined.push(one.arrivalMin)
    ignitions.forEach((ig, i) => single[i].push(simulateFire({ grid, elevation, fuel, firebreak, ignitions: [ig], weather: w, params }).arrivalMin))
  }
  const res = { arrivalMin: medianArrival(combined), elapsedMs }
  const perFire = single.map(medianArrival)
  Object.assign(FIRE_MODEL, JSON.parse(saved))
  const end = score(res.arrivalMin, params.horizonMin)
  const bld = buildingScore(res.arrivalMin, params.horizonMin)
  const fr = firmsReached(res.arrivalMin)
  const anchors = anchorTimes(res.arrivalMin)
  const pace = pacing(perFire, params.horizonMin)
  return { res, end, at24: score(res.arrivalMin, localToMin(grid.t0, '2024-02-03T00:00')), bld, firms: fr, anchors, pace, ...objective(end.dice, bld, pace, anchors) }
}

const fmtFull = (r: ReturnType<typeof run>) =>
  `${fmt(r.end)}\n   buildings: ${r.bld.reached} reached, ${r.bld.inScar}/${r.bld.scarTotal} of those in the scar (recall ${r.bld.recall.toFixed(2)}, precision ${r.bld.precision.toFixed(2)}, within 120 m of the scar ${r.bld.precisionNear.toFixed(2)})` +
  `\n   FIRMS ${r.firms.reached}/${r.firms.total}; arrival ${r.anchors.map((a) => `${a.name} ${hhmm(a.modelMin)} (GOES ${hhmm(a.satelliteMin)}, press ${a.observed})`).join(', ')}` +
  `\n   pace: GOES RMS lag ${r.pace.fires.map((f) => `${f.label} ${f.rmsLagMin.toFixed(0)} min`).join(', ')}; VIIRS/MODIS mean |lag| ${r.pace.testMeanAbsLagMin.toFixed(0)} min` +
  `\n   objective ${r.objective.toFixed(3)} (pace score ${r.pace.lagScore.toFixed(2)}; press timing score, not in the objective, ${r.timing.toFixed(2)})`

/** Full pace tables: GOES every 30 min and every VIIRS / MODIS pass, per fire. */
function printPace(r: ReturnType<typeof run>) {
  for (const f of r.pace.fires) {
    console.log(`   ${f.label}, GOES-16 (fit): time obs km / model km / lag min`)
    console.log('     ' + f.lags.filter((x) => x.tMin % 30 === 5).map((x) => `${hhmm(x.tMin)} ${x.obsKm.toFixed(1)}/${x.modelKm.toFixed(1)}/${x.lagMin.toFixed(0)}`).join('  '))
    console.log(`   ${f.label}, VIIRS/MODIS (test): ` + f.test.map((x) => `${x.time} ${x.satellite} ${x.obsKm.toFixed(1)}/${x.modelKm.toFixed(1)} km lag ${x.lagMin.toFixed(0)} min overrun ${x.overrunHa.toFixed(0)} ha`).join('; '))
  }
}

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
  spotIntensityExponent: FIRE_MODEL.spotIntensityExponent,
  spotRefRosMPerMin: FIRE_MODEL.spotRefRosMPerMin,
  jitterSigma: FIRE_MODEL.spotJitterSigma,
  members: 1,
  grassFuelFactor: FIRE_MODEL.fuels[FUEL.GRASS].factor,
  shrubFuelFactor: FIRE_MODEL.fuels[FUEL.SHRUB].factor,
  spotDelayMin: FIRE_MODEL.spotDelayMin,
  spotTravelMin: FIRE_MODEL.spotTravelMin,
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
    anchors: shipped.anchors.map((a) => ({ name: a.name, reported: a.observed, satellite: hhmm(a.satelliteMin), model: hhmm(a.modelMin) })),
    pacing: {
      note: 'Front lag = minutes the model is late (+) or early (-) at reaching the farthest satellite detection of each fire, 12:00-24:00. Fit: GOES-16 every 10 min (in sample). Test: VIIRS / MODIS passes (not used to fit).',
      fit: { sensor: 'GOES-16 ABI', rmsLagMin: Object.fromEntries(shipped.pace.fires.map((f) => [f.label, Math.round(f.rmsLagMin)])) },
      test: shipped.pace.fires.flatMap((f) => f.test.map((x) => ({ ...x, obsKm: Number(x.obsKm.toFixed(1)), modelKm: Number(x.modelKm.toFixed(1)), lagMin: Math.round(x.lagMin), overrunHa: Math.round(x.overrunHa) }))),
      testMeanAbsLagMin: Math.round(shipped.pace.testMeanAbsLagMin),
    },
    windDirCorrectionDeg: ERA5_WIND_DIR_CORRECTION_DEG,
  }
  writeFileSync(dir + 'validation.json', JSON.stringify(validation, null, 2) + '\n')
  console.log(`shipped defaults at the horizon: ${fmtFull(shipped)}`)
  printPace(shipped)
  console.log('wrote public/data/validation.json\n')
  // Before / after: what each change contributes (one at a time from the shipped model).
  const variants: [string, Partial<Knobs>][] = [
    ['before the pace fit (matorral as forest, McArthur x3)', { shrubFuelFactor: 1, forestShrubFactor: 3 }],
    ['ember distance x source intensity (exponent 1, 20 m per km/h) on the old fuel factors: best in-sample, knife edge', { shrubFuelFactor: 1, forestShrubFactor: 3, spotIntensityExponent: 1, spotRefRosMPerMin: 30, params: { spotMetresPerKmh: 20 } }],
    ['the same at wind x1.1', { shrubFuelFactor: 1, forestShrubFactor: 3, spotIntensityExponent: 1, spotRefRosMPerMin: 30, windFactor: 1.1, params: { spotMetresPerKmh: 20 } }],
    ['no wind direction correction', { windDirCorrectionDeg: 0 }],
    ['spotting off', { params: { spotting: false } }],
    ['wind x0.9', { windFactor: 0.9 }],
    ['wind x1.1', { windFactor: 1.1 }],
    ['wind x1.5', { windFactor: 1.5 }],
  ]
  for (const [name, v] of variants) {
    const r = run({ ...current, ...v })
    console.log(`${name}: ${r.res.elapsedMs.toFixed(0)} ms\n   ${fmtFull(r)}`)
  }
} else {
  // Pace knobs (MODEL.md section 6): ember distance per km/h, its growth with source intensity, the McArthur
  // factor and the ERA5 direction correction. Urban knobs stay at the values chosen on 2026-11-22 01:30.
  // Robust scan: every configuration is scored at ERA5 wind x0.9, x1 and x1.1 and ranked by the mean objective,
  // so a set of knobs that only works at one exact wind (a knife edge) does not win. MODEL.md section 6 quotes it.
  const rows: [number, string][] = []
  const configs: Partial<Knobs>[] = []
  for (const shrubFuelFactor of [0.35, 0.5, 1])
    for (const forestShrubFactor of [3, 4])
      for (const spotMetresPerKmh of [20, 25])
        for (const [spotIntensityExponent, spotRefRosMPerMin] of [[0, 30], [1, 30]])
          configs.push({ shrubFuelFactor, forestShrubFactor, spotIntensityExponent, spotRefRosMPerMin, params: { spotMetresPerKmh } })
  // Ensemble with per-cell ember jitter (median of 7 seeds) and faster ember jumps, on the shipped fuel factors.
  configs.push({ jitterSigma: 0.5, members: 7, params: { spotMetresPerKmh: 15 } })
  configs.push({ spotDelayMin: 2, spotTravelMin: 2, params: { spotMetresPerKmh: 12 } })
  for (const cfg of configs) {
    const rs = [0.9, 1, 1.1].map((windFactor) => run({ ...current, ...cfg, windFactor }))
    const m = (f: (r: (typeof rs)[number]) => number) => rs.reduce((x, r) => x + f(r), 0) / rs.length
    const j = (f: (r: (typeof rs)[number]) => number, d = 0) => rs.map((r) => f(r).toFixed(d)).join('/')
    rows.push([
      m((r) => r.objective),
      `shrub x${cfg.shrubFuelFactor ?? current.shrubFuelFactor}, McArthur x${cfg.forestShrubFactor ?? current.forestShrubFactor}, spotting ${cfg.params?.spotMetresPerKmh}, intensity exponent ${cfg.spotIntensityExponent ?? 0}, jitter ${cfg.jitterSigma ?? 0} x${cfg.members ?? 1}, ember time ${cfg.spotDelayMin ?? current.spotDelayMin}+${cfg.spotTravelMin ?? current.spotTravelMin}: robust objective ${m((r) => r.objective).toFixed(3)} | W RMS ${j((r) => r.pace.fires[0].rmsLagMin)} E RMS ${j((r) => r.pace.fires[1].rmsLagMin)} | test ${j((r) => r.pace.testMeanAbsLagMin)} | Dice ${j((r) => r.end.dice, 2)} | bld ${j((r) => r.bld.inScar)}`,
    ])
  }
  rows.sort((a, b) => b[0] - a[0])
  for (const [, line] of rows.slice(0, 30)) console.log(line)
}
