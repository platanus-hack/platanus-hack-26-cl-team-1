// Measures the firefighting scenarios on the real dataset (the numbers quoted in MODEL.md and the PR):
//   pnpm exec tsx src/engine/brigade/scenarios.ts
// Same pipeline as the worker: fire without firefighters, plan, defended fire, evacuation, rescue.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseBrigades, parseBuildings, parseElevation, parseFuel, parseGrid, parseIgnitions, parseRoads, parseWeather } from '../../data/load'
import { localToMin } from '../../data/time'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from '../evac'
import { DEFAULT_FIRE_PARAMS, simulateFire } from '../fire'
import type { FireInput } from '../types'
import { buildIgnitions, buildWeatherSeries, defaultBrigades, HORIZON_MIN, type BrigadeScenario, type Scenario } from '../../worker/scenario'
import { applyRescue, planBrigades } from './index'

const dir = fileURLToPath(new URL('../../../public/data/', import.meta.url))
const bin = (f: string) => {
  const b = readFileSync(dir + f)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}
const json = (f: string): unknown => JSON.parse(readFileSync(dir + f, 'utf8'))

const grid = parseGrid(json('grid.json'))
const cells = grid.rows * grid.cols
const fuel = parseFuel(bin('fuel.bin'), cells)
const elevation = parseElevation(bin('elevation.bin'), cells)
const buildings = parseBuildings(bin('buildings.bin'))
const roads = parseRoads(json('roads.json'))
const weatherFile = parseWeather(json('weather.json'))
const presets = parseIgnitions(json('ignitions.json'))
const file = parseBrigades(json('brigades.json'), grid)
const prepared = prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })

const neutral = { mode: 'real' as const, windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }
const scen = { presetIgnitions: presets.map((p) => p.id), userIgnitions: [] } as unknown as Scenario
const fireInput: FireInput = {
  grid,
  elevation,
  fuel,
  firebreak: new Uint8Array(cells),
  ignitions: buildIgnitions(grid, presets, scen),
  weather: buildWeatherSeries(weatherFile, grid.t0, neutral).series,
  params: { ...DEFAULT_FIRE_PARAMS, horizonMin: HORIZON_MIN },
}
const evacParams = { ...DEFAULT_EVAC_PARAMS, alertMin: localToMin(grid.t0, '2024-02-02T18:00') }
const edits = { closedEdges: [], addedLinks: [] }
const ha = (c: number) => Math.round((c * grid.cellM * grid.cellM) / 10000)

const pass1 = simulateFire(fireInput)
const base = simulateEvac({ prepared, arrivalMin: pass1.arrivalMin, params: evacParams, edits })
console.log(`Sin bomberos: ${ha(pass1.burnedCells)} ha, ${base.buildingsReached} edificios alcanzados, ${Math.round(base.expectedTrappedHouseholds)} hogares con la salida cortada (alerta 18:00)`)

function run(label: string, b: BrigadeScenario) {
  const t = performance.now()
  const plan = planBrigades({ prepared, grid, fuel, arrivalMin: pass1.arrivalMin, file, settings: b, toMin: (l) => localToMin(grid.t0, l), safetyMarginMin: DEFAULT_EVAC_PARAMS.safetyMarginMin, carKmhByClass: DEFAULT_EVAC_PARAMS.carKmhByClass, horizonMin: HORIZON_MIN })
  const planMs = performance.now() - t
  const fire = simulateFire({ ...fireInput, defense: plan.defense })
  const ev = simulateEvac({ prepared, arrivalMin: fire.arrivalMin, params: evacParams, edits })
  const res = applyRescue(prepared, ev.householdRisk, ev.householdStatus, plan.units, HORIZON_MIN, ev.expectedTrappedHouseholds)
  const st = (s: string) => plan.units.filter((u) => u.status === s).length
  console.log(
    `${label}: ${plan.units.length} carros (${st('deployed')} trabajando, ${st('late')} tarde, ${st('no_access')} sin acceso, ${st('idle')} sin sector); ` +
      `${ha(fire.burnedCells)} ha (${ha(fire.burnedCells - pass1.burnedCells)}), ${ev.buildingsReached} edificios (${ev.buildingsReached - base.buildingsReached}), ` +
      `${Math.round(res.expectedTrappedHouseholds)} hogares (${Math.round(res.expectedTrappedHouseholds - base.expectedTrappedHouseholds)}), rescatados ${res.rescuedExpected.toFixed(1)}; ` +
      `${plan.defendedCells} celdas defendidas, ${plan.cutEdges.length} tramos cortados; plan ${planMs.toFixed(0)} ms`,
  )
}

const d = { ...defaultBrigades(file, grid.t0), enabled: true }
const scale = (k: number) => ({
  ...d,
  units: Object.fromEntries(Object.entries(d.units).map(([id, u]) => [id, u.map((x) => Math.round(x * k))])),
  reinforcementUnits: Object.fromEntries(Object.entries(d.reinforcementUnits).map(([id, u]) => [id, u.map((x) => Math.round(x * k))])),
})
run('Por defecto', d)
run('Sin corte de la Ruta 68', { ...d, historicalCuts: false })
run('Doble de carros', scale(2))
run('Cada compañía con 2 bombas, 1 forestal y 1 aljibe', { ...d, units: Object.fromEntries(Object.keys(d.units).map((id) => [id, [2, 1, 1, 0]])) })
run('Despacho a las 14:30', { ...d, dispatchMin: Object.fromEntries(Object.keys(d.dispatchMin).map((c) => [c, localToMin(grid.t0, '2024-02-02T14:30')])) })
