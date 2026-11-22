// Probabilistic ember landings (MODEL.md section 5, "Probabilistic landings (drawn firebreaks)"): the measurements
// MODEL.md quotes for them. The fire and the evacuation run exactly as the worker runs them (src/worker/sim.worker.ts)
// on App.tsx defaultScenario: each event's preset ignitions, its real weather (x1, with its own wind-direction
// correction), its alert, persons per household and share on foot, no firefighters, no preparation plan. Fire starts
// are snapped against each run's own firebreak mask, as the worker does (snapIgnitions).
//
//   pnpm embers                               # 32 members: Viña 2024 and Eaton 2025, then the Talca line
//   pnpm embers --members 8 --event talca     # a quicker run of one event
//
// (a) Viña 2024 and Eaton 2025 (observed fires, no drawn lines): the deterministic main result vs the members.
// (b) Talca (hypothetical): one line (8 km long, 1 km from the first ignition toward the head bearing at
//     the alert) at every panel width, the same seeds without and with the line (paired), summarised with the panel's
//     own summariseEmbers; plus the deterministic and embers-off references.
//     Then a sensitivity on the 120 m line: weaker wind, more humid air, and a far smaller ember yield.
// (c) Stability: medians of disjoint blocks of EMBER_MEMBERS seeds (the panel's ensemble size); the sensitivity table
//     prints them for each variant too.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkEvent, EVENT_IDS, EVENTS, type EventDef, type EventId } from '../../data/events'
import { parseBuildings, parseElevation, parseFuel, parseGrid, parseIgnitions, parseRoads, parseScar, parseWeather } from '../../data/load'
import { minToHHMM } from '../../data/time'
import { EMBER_MEMBERS, summariseEmbers, type EmberMemberOut, type EmberQuantiles } from '../../worker/embers'
import { buildIgnitions, buildWeatherSeries, FIREBREAK_WIDTHS, noBrigades, rasteriseFirebreaks, snapIgnitions, type Scenario, type WeatherSettings } from '../../worker/scenario'
import { DEFAULT_EVAC_PARAMS, prepareEvac, simulateEvac } from '../evac'
import { TIMELINE, type EvacParams, type FireResult, type IgnitionPreset, type WeatherSeries } from '../types'
import { DEFAULT_FIRE_PARAMS, FIRE_MODEL, simulateFire } from './index'
import { emberIgnitionProbability, grassMoisturePct, weatherAt } from './model'

// ---------------------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------------------
const args = process.argv.slice(2)
const OPTS = ['--members', '--event']
for (let k = 0; k < args.length; k += 2) {
  if (!OPTS.includes(args[k])) throw new Error(`ember-ensemble: unknown option ${args[k]} (options: ${OPTS.join(', ')})`)
  if (k + 1 >= args.length) throw new Error(`ember-ensemble: ${args[k]} needs a value`)
}
const arg = (name: string): string | undefined => {
  const i = args.indexOf(name)
  return i < 0 ? undefined : args[i + 1]
}
/** Members per run: seeds 1..MEMBERS, a multiple of the panel's EMBER_MEMBERS so they split into whole blocks. */
const MEMBERS = Number(arg('--members') ?? 32)
if (!Number.isInteger(MEMBERS) || MEMBERS < EMBER_MEMBERS || MEMBERS % EMBER_MEMBERS !== 0) {
  throw new Error(`ember-ensemble: --members must be a positive multiple of ${EMBER_MEMBERS} (got ${arg('--members')})`)
}
const only = arg('--event')
if (only !== undefined && !(EVENT_IDS as readonly string[]).includes(only)) throw new Error(`ember-ensemble: unknown event ${only} (events: ${EVENT_IDS.join(', ')})`)
const SEEDS = Array.from({ length: MEMBERS }, (_, k) => k + 1)
const T0 = performance.now()

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------
/** Quantile with linear interpolation between order statistics (numpy's default), as summariseEmbers computes it
 *  (src/worker/embers.ts, whose helper is not exported). */
function quantile(values: readonly number[], p: number): number {
  if (values.length === 0) throw new Error('ember-ensemble: quantile of no values')
  const s = [...values].sort((a, b) => a - b)
  const h = (s.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(s.length - 1, lo + 1)
  return s[lo] + (h - lo) * (s[hi] - s[lo])
}
const int = (x: number) => Math.round(x).toLocaleString('en-US')
const fix = (d: number) => (x: number) => x.toFixed(d)
/** "median [P10-P90]" of values, or of a summariseEmbers quantile triple. */
const band = (q: EmberQuantiles | readonly number[], f: (x: number) => string = int) => {
  const t = Array.isArray(q) ? { p10: quantile(q, 0.1), p50: quantile(q, 0.5), p90: quantile(q, 0.9) } : (q as EmberQuantiles)
  return `${f(t.p50)} [${f(t.p10)}–${f(t.p90)}]`
}
const median = (xs: readonly number[]) => quantile(xs, 0.5)
/** Disjoint blocks of EMBER_MEMBERS (the panel's ensemble size), in seed order. */
const blocks = <T>(xs: readonly T[]): T[][] => Array.from({ length: xs.length / EMBER_MEMBERS }, (_, b) => xs.slice(b * EMBER_MEMBERS, (b + 1) * EMBER_MEMBERS))
const secs = () => `${((performance.now() - T0) / 1000).toFixed(0)} s elapsed`

/** App.tsx NEUTRAL_WEATHER: the real series, no adjustment (the constant-mode values are unused in 'real'). */
const NEUTRAL_WEATHER: WeatherSettings = { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }

/** App.tsx defaultScenario on the event's own timeline (Dataset.defaultAlertMin = EventDef.evac.alertMin). Firefighters
 *  off (as in defaultScenario; the ensemble runs without them anyway); no plan. */
function defaultScenario(event: EventDef, presets: IgnitionPreset[]): Scenario {
  return {
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
    brigades: noBrigades(),
    planTiles: [],
    planSectors: [],
  }
}

/** One event's data, its default scenario, and the fire and evacuation as the worker runs them. */
function loadEvent(id: EventId) {
  const event = checkEvent(EVENTS[id])
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
  const buildings = parseBuildings(bin('buildings.bin'))
  const roads = parseRoads(json('roads.json'))
  const presets = parseIgnitions(json('ignitions.json'))
  const weatherFile = parseWeather(json('weather.json'))
  const prepared = prepareEvac(grid, fuel, roads, buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })
  const s = defaultScenario(event, presets)
  const ignitions = buildIgnitions(grid, presets, s)
  const wb = buildWeatherSeries(weatherFile, grid.t0, s.weather, event.windDirCorrectionDeg)
  if (wb.notes.length > 0) throw new Error(`ember-ensemble: the weather needed adjusting: ${wb.notes.join(' ')}`)
  // sim.worker.ts: the fire's parameters from the scenario, the timeline's horizon (the event's own here).
  const params = { ...DEFAULT_FIRE_PARAMS, droughtFactor: s.droughtFactor, spotting: s.spotting, spotMetresPerKmh: s.spotMetresPerKmh, horizonMin: event.horizonMin }
  const fireMs: number[] = []
  const fire = (firebreak: Uint8Array, emberSeed: number | null, lineMask?: Uint8Array, spotting = s.spotting, weather = wb.series): FireResult => {
    const snapped = snapIgnitions(grid, fuel, firebreak, ignitions)
    const r = simulateFire({ grid, elevation, fuel, firebreak, ignitions: snapped.ignitions, weather, params: { ...params, spotting, emberSeed }, lineMask })
    fireMs.push(r.elapsedMs)
    return r
  }
  /** The real series with the panel's weather adjustments (sensitivity runs only). */
  const adjusted = (patch: Partial<WeatherSettings>): WeatherSeries => {
    const b = buildWeatherSeries(weatherFile, grid.t0, { ...s.weather, ...patch }, event.windDirCorrectionDeg)
    if (b.notes.length > 0) throw new Error(`ember-ensemble: the adjusted weather needed clamping: ${b.notes.join(' ')}`)
    return b.series
  }
  // sim.worker.ts: evacuation settings from the scenario, persons per household from the event. With no plan sectors
  // (defaultScenario) programmeFor gives no programme.
  if (s.planSectors.length > 0 || s.planTiles.length > 0) throw new Error('ember-ensemble: the default scenario has no plan')
  const evacParams: EvacParams = {
    ...DEFAULT_EVAC_PARAMS,
    personsPerHousehold: event.evac.personsPerHousehold.value,
    alertMin: s.alertMin,
    cueShare: s.cueShare,
    cueRadiusM: s.cueRadiusM,
    prepMedianMin: s.prepMedianMin,
    footShare: s.footShare,
  }
  const edits = { closedEdges: s.closedEdges, addedLinks: s.addedLinks }
  const evacMs: number[] = []
  const households = (arrivalMin: Float32Array): number => {
    const t = performance.now()
    const h = simulateEvac({ prepared, arrivalMin, params: evacParams, edits, programme: undefined }).expectedTrappedHouseholds
    evacMs.push(performance.now() - t)
    return h
  }
  /** Dice (Sørensen) of a burned mask vs the Sentinel-2 scar, no-data cells (255) skipped, as calibrate.ts scores. */
  const dice = (burned: (i: number) => boolean) => {
    let inter = 0
    let sim = 0
    let real = 0
    for (let i = 0; i < n; i++) {
      if (scar[i] === 255) continue
      const b = burned(i)
      const sc = scar[i] === 1
      if (b && sc) inter++
      if (b) sim++
      if (sc) real++
    }
    return (2 * inter) / (sim + real)
  }
  const cellHa = (grid.cellM * grid.cellM) / 1e4
  console.log(
    `\n${event.id}: grid ${grid.rows} x ${grid.cols} @ ${grid.cellM} m, t0 ${grid.t0}, horizon ${minToHHMM(grid.t0, event.horizonMin)}, ` +
      `alert ${minToHHMM(grid.t0, s.alertMin)}, ${evacParams.personsPerHousehold} persons per household, ${evacParams.footShare} on foot, ` +
      `ignitions ${presets.map((p) => `${p.id} @ ${p.timeLocal.slice(11)}`).join(', ')}; ${secs()}`,
  )
  // Ember ignition probability through the run (Schroeder 1969 on the Cheney grass moisture), and the igniting brands a
  // source cell throws over its band, B * P_ign.
  const brandsPerCell = FIRE_MODEL.spotBrandsPerHa * cellHa
  const hours: string[] = []
  for (let t = 0; t <= event.horizonMin; t += 120) {
    const w = weatherAt(wb.series, t)
    const mc = grassMoisturePct(w.tempC, w.rh)
    const p = emberIgnitionProbability(w.tempC, mc)
    hours.push(`${minToHHMM(grid.t0, t)} ${w.tempC.toFixed(1)} °C ${w.rh.toFixed(0)} % ${w.windKmh.toFixed(0)} km/h MC ${mc.toFixed(1)} % P_ign ${p.toFixed(2)} (${(brandsPerCell * p).toFixed(0)} igniting)`)
  }
  console.log(`  ${FIRE_MODEL.spotBrandsPerHa} brands per ha = ${brandsPerCell.toFixed(0)} per cell; weather: ${hours.join('; ')}`)
  return { event, grid, n, presets, s, fire, adjusted, households, dice, cellHa, fireMs, evacMs, horizon: event.horizonMin, noLines: new Uint8Array(n) }
}
type Ev = ReturnType<typeof loadEvent>
const timing = (ev: Ev) => `fire ${median(ev.fireMs).toFixed(0)} ms, evacuation ${median(ev.evacMs).toFixed(0)} ms (medians of ${ev.fireMs.length} and ${ev.evacMs.length} runs)`

// ---------------------------------------------------------------------------------------------------------
// (a) Observed fires: deterministic vs members, no lines
// ---------------------------------------------------------------------------------------------------------
/** Returns the per-member households, for the stability blocks. */
function observed(id: EventId): number[] {
  const ev = loadEvent(id)
  const { n, horizon, cellHa } = ev
  if (!ev.event.observedFire) throw new Error(`ember-ensemble: ${id} has no observed fire to score against`)
  const det = ev.fire(ev.noLines, null)
  const detHh = ev.households(det.arrivalMin)
  const detDice = ev.dice((i) => det.arrivalMin[i] <= horizon)
  const count = new Uint16Array(n)
  const area: number[] = []
  const dices: number[] = []
  const hh: number[] = []
  for (const seed of SEEDS) {
    const r = ev.fire(ev.noLines, seed)
    area.push(r.burnedCells * cellHa)
    dices.push(ev.dice((i) => r.arrivalMin[i] <= horizon))
    for (let i = 0; i < n; i++) if (r.arrivalMin[i] <= horizon) count[i]++
    hh.push(ev.households(r.arrivalMin))
  }
  let p50Cells = 0
  for (let i = 0; i < n; i++) if (2 * count[i] >= MEMBERS) p50Cells++
  const p50Dice = ev.dice((i) => 2 * count[i] >= MEMBERS)
  console.log(`  deterministic: ${int(det.burnedCells * cellHa)} ha, Dice ${detDice.toFixed(3)}, households cut off ${int(detHh)}`)
  console.log(
    `  ${MEMBERS} members: area ${band(area)} ha, Dice per member ${band(dices, fix(3))}, burned in >= half the members ${int(p50Cells * cellHa)} ha with Dice ${p50Dice.toFixed(3)}, ` +
      `households cut off ${band(hh)} (median ${((100 * (median(hh) - detHh)) / detHh).toFixed(1)} % vs deterministic)`,
  )
  console.log(`  ${timing(ev)}; ${secs()}`)
  console.log('\n  | Measure | Deterministic | Members, median [P10–P90] |')
  console.log('  |---|---|---|')
  console.log(`  | Area (burnedCells) | ${int(det.burnedCells * cellHa)} ha | ${band(area)} ha |`)
  console.log(`  | Dice vs the scar | ${detDice.toFixed(3)} | ${band(dices, fix(3))} per member; ${p50Dice.toFixed(3)} for P ≥ 0.5 (${int(p50Cells * cellHa)} ha) |`)
  console.log(`  | Households cut off at the ${minToHHMM(ev.grid.t0, ev.s.alertMin)} alert | ${int(detHh)} | ${band(hh)} |`)
  return hh
}

// ---------------------------------------------------------------------------------------------------------
// (b) Talca: one 8 km line across the fire's path, paired seeds
// ---------------------------------------------------------------------------------------------------------
/** The Talca line (as D-034 measured it): lengthKm long, perpendicular to the head bearing at the alert
 *  (the burned cell farthest from the first ignition by the alert, on the deterministic fire without lines), centred
 *  aheadKm from the first ignition. */
function talcaLine(ev: Ev, aheadKm = 1, lengthKm = 8) {
  const { grid, n, presets, s } = ev
  const base = ev.fire(ev.noLines, null)
  const [lon0, lat0] = [presets[0].lon, presets[0].lat]
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110540
  let hx = 0
  let hy = 0
  for (let i = 0; i < n; i++) {
    if (!(base.arrivalMin[i] <= s.alertMin)) continue
    const r = Math.floor(i / grid.cols)
    const c = i - r * grid.cols
    const x = (grid.lonMin + (c + 0.5) * grid.dLon - lon0) * kx
    const y = (grid.latMax - (r + 0.5) * grid.dLat - lat0) * ky
    if (Math.hypot(x, y) > Math.hypot(hx, hy)) [hx, hy] = [x, y]
  }
  if (hx === 0 && hy === 0) throw new Error('ember-ensemble: the fire burned nothing before the alert')
  const [ux, uy] = [hx / Math.hypot(hx, hy), hy / Math.hypot(hx, hy)]
  const ll = (x: number, y: number): [number, number] => [lon0 + x / kx, lat0 + y / ky]
  const [cx, cy, px, py] = [ux * aheadKm * 1000, uy * aheadKm * 1000, -uy * lengthKm * 500, ux * lengthKm * 500]
  const points: [number, number][] = [ll(cx - px, cy - py), ll(cx + px, cy + py)]
  return { points, bearing: ((Math.atan2(ux, uy) * 180) / Math.PI + 360) % 360, aheadKm, lengthKm }
}

/** Returns the 120 m line's members and Talca's cell size, for the stability blocks. */
function talca(): { members120: EmberMemberOut[]; cellM: number } {
  const ev = loadEvent(TIMELINE.TALCA)
  const { grid, cellHa } = ev
  const hhmm = (t: number) => (Number.isFinite(t) ? minToHHMM(grid.t0, t) : 'never')
  const line = talcaLine(ev)
  console.log(
    `  line: ${line.lengthKm} km, ${line.aheadKm} km from ${ev.presets[0].id} toward ${line.bearing.toFixed(0)}° ` +
      `(${line.points.map(([a, b]) => `${a.toFixed(4)}, ${b.toFixed(4)}`).join(' to ')})`,
  )
  // The worker's two sides: "with" = the scenario's firebreak mask (the drawn line), reported on as lineMask;
  // "without" = zeros (no plan belt).
  const masks = FIREBREAK_WIDTHS.map((w) => {
    const sc: Scenario = { ...ev.s, firebreaks: [{ id: 'linea', points: line.points, widthM: w }] }
    const mask = rasteriseFirebreaks(grid, sc.firebreaks)
    let cells = 0
    for (let i = 0; i < mask.length; i++) cells += mask[i]
    return { w, mask, cells }
  })
  const sameAs = (k: number) => masks.findIndex((m, j) => j < k && m.mask.every((v, i) => v === masks[k].mask[i]))
  console.log(
    '  masks: ' +
      masks.map((m, k) => `${m.w} m ${m.cells} cells (${((m.cells * grid.cellM * grid.cellM) / (line.lengthKm * 1000)).toFixed(0)} m effective)${sameAs(k) >= 0 ? `, identical to ${masks[sameAs(k)].w} m` : ''}`).join('; '),
  )

  // References: deterministic (the main result) and embers off.
  const det0 = ev.fire(ev.noLines, null)
  const detHh0 = ev.households(det0.arrivalMin)
  const off0 = ev.fire(ev.noLines, null, undefined, false)
  const offHh0 = ev.households(off0.arrivalMin)
  const ref: string[] = []
  for (const m of masks) {
    const d = ev.fire(m.mask, null, m.mask)
    const dh = ev.households(d.arrivalMin)
    const o = ev.fire(m.mask, null, m.mask, false)
    const oh = ev.households(o.arrivalMin)
    ref.push(
      `  | ${m.w} m | ${int(detHh0)} → ${int(dh)} (${((100 * (dh - detHh0)) / detHh0).toFixed(1)} %), ${d.line!.crossedCells > 0 ? 'crossed' : 'not crossed'}, reached ${hhmm(d.line!.reachedMin)}, first crossing ${hhmm(d.line!.firstCrossMin)}, ${d.line!.crossedCells} spot cells | ` +
        `${int(offHh0)} → ${int(oh)}, ${o.line!.crossedCells > 0 ? 'crossed' : 'not crossed'}, reached ${hhmm(o.line!.reachedMin)} |`,
    )
  }
  console.log('\n  References (one run each):')
  console.log('  | Width | Deterministic spotting (main result): households cut off | Embers off: households cut off |')
  console.log('  |---|---|---|')
  for (const r of ref) console.log(r)

  // The ensemble: each seed without the line once, then with each width (paired: the same seed).
  const without = SEEDS.map((seed) => {
    const r = ev.fire(ev.noLines, seed)
    return { households: ev.households(r.arrivalMin), burnedCells: r.burnedCells }
  })
  console.log(`\n  ${MEMBERS} members without the line: households cut off ${band(without.map((x) => x.households))}, area ${band(without.map((x) => x.burnedCells * cellHa))} ha; ${secs()}`)
  console.log('\n  | Width | Mask cells | Reached | Crossed | Households without | Households with | Saved (paired) | Saved % | Line reached | First spot fire beyond | Spot cells beyond | Area saved (ha) |')
  console.log('  |---|---|---|---|---|---|---|---|---|---|---|---|')
  let members120: EmberMemberOut[] | null = null
  for (const m of masks) {
    const members: EmberMemberOut[] = SEEDS.map((seed, k) => {
      const r = ev.fire(m.mask, seed, m.mask)
      return { seed, without: without[k], with: { households: ev.households(r.arrivalMin), burnedCells: r.burnedCells, line: r.line! } }
    })
    const sm = summariseEmbers(members, grid.cellM)
    const spots = members.map((x) => x.with.line.crossedCells)
    console.log(
      `  | ${m.w} m | ${m.cells} | ${sm.reached}/${sm.n} | ${sm.crossed}/${sm.n} | ${band(sm.without)} | ${band(sm.with)} | ${band(sm.saved)} | ${sm.savedPct ? band(sm.savedPct, fix(1)) : 'n/a'} | ` +
        `${sm.reachedMin ? hhmm(sm.reachedMin.p50) : 'never'} | ${sm.firstCrossMin ? hhmm(sm.firstCrossMin.p50) : 'none'} | ${band(spots)} | ${band(sm.haSaved)} |`,
    )
    if (m.w === 120) members120 = members
  }
  console.log(`\n  ${timing(ev)}; ${secs()}`)
  if (members120 === null) throw new Error('ember-ensemble: FIREBREAK_WIDTHS has no 120 m width')

  // Sensitivity on the 120 m line (the same line and seeds): where the wind and ROS gates switch spotting off, more
  // humid air (lower P_ign), and an ember yield of about 1 brand per cell (which no longer reproduces Viña).
  const mask120 = masks.find((m) => m.w === 120)!.mask
  const variants: { label: string; weather?: Partial<WeatherSettings>; brandsPerHa?: number }[] = [
    { label: 'wind x0.55', weather: { windFactor: 0.55 } },
    { label: 'wind x0.6', weather: { windFactor: 0.6 } },
    { label: 'wind x0.65', weather: { windFactor: 0.65 } },
    { label: 'wind x0.7', weather: { windFactor: 0.7 } },
    { label: 'RH +30 points', weather: { rhOffset: 30 } },
    { label: `1 brand per cell (${(1e4 / grid.cellM ** 2).toFixed(1)} per ha)`, brandsPerHa: 1e4 / grid.cellM ** 2 },
  ]
  console.log(`\n  Sensitivity, 120 m line, ${MEMBERS} paired members:`)
  console.log(`  | Variant | Deterministic: households without → with | Crossed | Households without | Households with | Saved (paired) | Saved % | Saved, medians of ${EMBER_MEMBERS}-seed blocks |`)
  console.log('  |---|---|---|---|---|---|---|---|')
  const shippedBrands = FIRE_MODEL.spotBrandsPerHa
  for (const v of variants) {
    const weather = ev.adjusted(v.weather ?? {})
    const d0 = ev.households(ev.fire(ev.noLines, null, undefined, true, weather).arrivalMin)
    const d1run = ev.fire(mask120, null, mask120, true, weather)
    const d1 = ev.households(d1run.arrivalMin)
    try {
      if (v.brandsPerHa !== undefined) FIRE_MODEL.spotBrandsPerHa = v.brandsPerHa
      const members: EmberMemberOut[] = SEEDS.map((seed) => {
        const a = ev.fire(ev.noLines, seed, undefined, true, weather)
        const b = ev.fire(mask120, seed, mask120, true, weather)
        return { seed, without: { households: ev.households(a.arrivalMin), burnedCells: a.burnedCells }, with: { households: ev.households(b.arrivalMin), burnedCells: b.burnedCells, line: b.line! } }
      })
      const sm = summariseEmbers(members, grid.cellM)
      console.log(
        `  | ${v.label} | ${int(d0)} → ${int(d1)} (${d1run.line!.crossedCells > 0 ? 'crossed' : 'not crossed'}) | ${sm.crossed}/${sm.n} | ${band(sm.without)} | ${band(sm.with)} | ${band(sm.saved)} | ${sm.savedPct ? band(sm.savedPct, fix(1)) : 'n/a'} | ${blocks(members).map((b) => int(summariseEmbers(b, grid.cellM).saved.p50)).join(' / ')} |`,
      )
    } finally {
      FIRE_MODEL.spotBrandsPerHa = shippedBrands
    }
  }
  console.log(`  ${secs()}`)
  return { members120, cellM: grid.cellM }
}

// ---------------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------------
console.log(
  `Probabilistic ember landings: ${MEMBERS} members (seeds 1..${MEMBERS}), FIRE_MODEL.spotBrandsPerHa ${FIRE_MODEL.spotBrandsPerHa}, ` +
    `D_max ${DEFAULT_FIRE_PARAMS.spotMetresPerKmh} m per km/h; Node ${process.version}`,
)
const want = (id: EventId) => only === undefined || only === id
const blockHouseholds = new Map<EventId, number[]>()
console.log('\n(a) Observed fires, no drawn lines: deterministic main result vs members')
for (const id of [TIMELINE.VINA_2024, TIMELINE.EATON_2025] as const) if (want(id)) blockHouseholds.set(id, observed(id))
let talca120: ReturnType<typeof talca> | null = null
if (want(TIMELINE.TALCA)) {
  console.log('\n(b) Talca: an 8 km line 1 km ahead of the fire, the same seeds without and with it')
  talca120 = talca()
}

console.log(`\n(c) Stability: medians over disjoint blocks of ${EMBER_MEMBERS} seeds (the panel's ensemble)`)
for (const [id, hh] of blockHouseholds) console.log(`  ${id} households cut off: ${blocks(hh).map((b) => int(median(b))).join(' / ')} (all ${MEMBERS}: ${int(median(hh))})`)
if (talca120 !== null) {
  const { members120: members, cellM } = talca120
  const all = summariseEmbers(members, cellM)
  console.log(
    `  talca 120 m line, households saved (paired): ${blocks(members)
      .map((b) => {
        const sm = summariseEmbers(b, cellM)
        return `${int(sm.saved.p50)} (crossed ${sm.crossed}/${sm.n})`
      })
      .join(' / ')} (all ${MEMBERS}: ${int(all.saved.p50)})`,
  )
}
console.log(`\ndone, ${secs()}`)
