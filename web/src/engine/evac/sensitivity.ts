// Evacuation on the real data (web/public/data) with the default fire: the households that do not get out
// with the alert at 18:00, for a grid of environmental-cue settings, plus why (cue lead times) and where
// (inside or outside the Sentinel-2 scar, used here only to score). The cue numbers in MODEL.md come from
// this script.
//
//   pnpm exec tsx src/engine/evac/sensitivity.ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { lonLatToCell } from '../../data/grid'
import { parseBuildings, parseElevation, parseFuel, parseGrid, parseIgnitions, parseRoads, parseScar, parseWeather } from '../../data/load'
import { localToMin } from '../../data/time'
import { DEFAULT_FIRE_PARAMS, ERA5_WIND_DIR_CORRECTION_DEG, simulateFire } from '../fire'
import type { EvacParams } from '../types'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from './index'
import { minFilterOctagon, octagonWindow } from './minfilter'
import type { Prepared } from './prepare'

const dir = fileURLToPath(new URL('../../../public/data/', import.meta.url))
const bin = (f: string) => {
  const b = readFileSync(dir + f)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const json = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'))

const grid = parseGrid(json('grid.json'))
const n = grid.rows * grid.cols
const fuel = parseFuel(bin('fuel.bin'), n)
const scar = parseScar(bin('scar.bin'), n)
const wf = parseWeather(json('weather.json'))
const ignitions = parseIgnitions(json('ignitions.json')).map((p) => {
  const cell = lonLatToCell(grid, p.lon, p.lat)
  if (cell < 0) throw new Error(`sensitivity: ignition ${p.id} is outside the grid`)
  return { cell, tMin: localToMin(grid.t0, p.timeLocal) }
})
const fire = simulateFire({
  grid,
  elevation: parseElevation(bin('elevation.bin'), n),
  fuel,
  firebreak: new Uint8Array(n),
  ignitions,
  weather: {
    t0Min: localToMin(grid.t0, wf.times[0]),
    stepMin: localToMin(grid.t0, wf.times[1]) - localToMin(grid.t0, wf.times[0]),
    samples: wf.times.map((_, i) => ({ tempC: wf.tempC[i], rh: wf.rh[i], windKmh: wf.windKmh[i], windFromDeg: (wf.windFromDeg[i] + ERA5_WIND_DIR_CORRECTION_DEG + 360) % 360 })),
  },
  params: DEFAULT_FIRE_PARAMS,
})
const arrival = fire.arrivalMin
const P = prepareEvac(grid, fuel, parseRoads(json('roads.json')), parseBuildings(bin('buildings.bin')), {
  safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM,
}) as Prepared
const edits = { closedEdges: [], addedLinks: [] }
const run = (p: Partial<EvacParams>) => simulateEvac({ prepared: P, arrivalMin: arrival, params: { ...DEFAULT_EVAC_PARAMS, ...p }, edits })
const ALERT = 6 * 60 // 18:00
const fmt = (x: number) => Math.round(x).toLocaleString('en-US')

console.log(`fire: ${fire.burnedCells} cells burned by midnight; ${P.buildingCount} buildings`)

// Timing with the defaults (first run is cold).
const times: number[] = []
for (let k = 0; k < 7; k++) {
  const t = performance.now()
  run({ alertMin: ALERT })
  times.push(performance.now() - t)
}
const cold = times[0]
times.sort((a, b) => a - b)
console.log(`simulateEvac with the default cues: median ${times[3].toFixed(0)} ms, cold ${cold.toFixed(0)} ms`)

// Grid of cue settings.
const radii = [300, 600, 900, 1200, 1500, 2000, 3000]
console.log(`\nExpected households that do not get out, alert 18:00 (rows cueShare, columns cueRadiusM):`)
console.log(`| cueShare \\ cueRadiusM | ${radii.map((r) => `${fmt(r)} m`).join(' | ')} |`)
console.log(`| --- |${radii.map(() => ' --- |').join('')}`)
for (const share of [0, 0.5, DEFAULT_EVAC_PARAMS.cueShare, 0.8, 1])
  console.log(`| ${share} | ${radii.map((r) => fmt(run({ alertMin: ALERT, cueShare: share, cueRadiusM: r }).expectedTrappedHouseholds)).join(' | ')} |`)

// Lead time between the cue and the fire at the house, over the buildings the fire reaches.
console.log('\nMinutes from "fire within R" to "fire at the house" (buildings the fire reaches):')
for (const R of [600, 900, 1500, 3000]) {
  const near = minFilterOctagon(arrival, grid.rows, grid.cols, octagonWindow(R / grid.cellM))
  const leads: number[] = []
  for (let b = 0; b < P.buildingCount; b++) {
    const c = P.bldCell[b]
    if (c >= 0 && arrival[c] !== Infinity) leads.push(arrival[c] - near[c])
  }
  leads.sort((a, b) => a - b)
  const q = (p: number) => leads[Math.floor(p * (leads.length - 1))].toFixed(0)
  console.log(`  R = ${fmt(R)} m: p10 ${q(0.1)}, p25 ${q(0.25)}, p50 ${q(0.5)}, p75 ${q(0.75)} (${leads.length} buildings)`)
}

// Where: inside or outside the real scar (scoring only).
console.log('\nExpected households that do not get out, alert 18:00, by the real scar (Sentinel-2, scoring only):')
for (const [label, p] of [
  ['alert only', { cueShare: 0 }],
  ['default cues', {}],
] as const) {
  const r = run({ alertMin: ALERT, ...p })
  let inside = 0
  let outside = 0
  for (let b = 0; b < P.buildingCount; b++) {
    const c = P.bldCell[b]
    if (c < 0) continue
    if (scar[c] === 1) inside += r.householdRisk[b]
    else outside += r.householdRisk[b]
  }
  console.log(
    `  ${label}: ${fmt(r.expectedTrappedHouseholds)} = ${fmt(inside)} inside the scar + ${fmt(outside)} outside; ` +
      `${fmt(r.buildingsCuedBeforeAlert)} buildings see the fire before the alert`,
  )
}
