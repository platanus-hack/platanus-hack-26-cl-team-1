// Probabilistic-ember ensemble for drawn firebreaks (engine/fire/MODEL.md section 5, "Probabilistic landings").
// When embers are on and the user has drawn firebreaks, the worker also runs the scenario EMBER_MEMBERS times with
// random ember landings (FireParams.emberSeed = 1..EMBER_MEMBERS), each seed without and with the drawn lines. The
// same seed gives both runs the same random draws, so the paired difference is due to the lines alone. The panel
// shows in how many members embers cross the lines and that paired difference in households. No firefighters in
// these runs. Pure TypeScript, no DOM: the worker supplies the fire and evacuation functions.
import type { FireLineReport } from '../engine/types'
import { fireKey, type Scenario } from './scenario'

/** Members of the ensemble. Medians of disjoint 8-seed blocks differ by under 4 % in hot, dry weather (Viña
 *  households, Talca paired cut) but by up to ~30 % in more humid air (Talca at RH +30 points), where the P10-P90
 *  range the panel shows is wide too (`pnpm embers`, MODEL.md section 5). */
export const EMBER_MEMBERS = 8
/** Seeds of the members (FireParams.emberSeed): the same after every scenario edit, so results only move when the
 *  scenario does. */
export const EMBER_SEEDS: readonly number[] = Array.from({ length: EMBER_MEMBERS }, (_, k) => k + 1)

/** What the runs without the drawn lines depend on: neither the lines nor the firefighters (the ensemble runs
 *  without them), nor the embers switch (the ensemble only runs with embers on). The plan belt stays in. */
export function emberWithoutKey(s: Scenario): string {
  return JSON.stringify([s.weather, s.droughtFactor, s.spotMetresPerKmh, s.presetIgnitions, s.userIgnitions, s.planTiles])
}

/** What the runs with the drawn lines depend on: the scenario's own fire inputs. */
export function emberWithKey(s: Scenario): string {
  return fireKey(s)
}

/** What the households of a run depend on beyond its fire: the evacuation settings, street edits and programme. */
export function emberEvacKey(s: Scenario): string {
  return JSON.stringify([s.alertMin, s.cueShare, s.cueRadiusM, s.prepMedianMin, s.footShare, s.closedEdges, s.addedLinks, s.planSectors])
}

export interface EmberSideOut {
  /** Expected households cut off (EvacResult.expectedTrappedHouseholds). */
  households: number
  burnedCells: number
}

/** One member: the same seed without and with the drawn lines. */
export interface EmberMemberOut {
  seed: number
  without: EmberSideOut
  with: EmberSideOut & { line: FireLineReport }
}

// ---------------------------------------------------------------------------------------------------------
// Cache: one simulation at a time
// ---------------------------------------------------------------------------------------------------------

export type EmberSide = 'without' | 'with'
const SIDES: readonly EmberSide[] = ['without', 'with']

/** One cached run (one seed, one side). */
export interface EmberRun {
  /** Key of the fire inputs it ran with (emberWithoutKey or emberWithKey). */
  fireKey: string
  arrivalMin: Float32Array
  burnedCells: number
  /** The drawn lines' report: with-lines runs only. */
  line: FireLineReport | null
  /** emberEvacKey the households were computed for; null until they are. */
  evacKey: string | null
  households: number | null
}

/** Runs by side and member index (seed = EMBER_SEEDS[index]). */
export interface EmberCache {
  without: (EmberRun | null)[]
  with: (EmberRun | null)[]
}

export interface EmberKeys {
  without: string
  with: string
  evac: string
}

export function emberKeys(s: Scenario): EmberKeys {
  return { without: emberWithoutKey(s), with: emberWithKey(s), evac: emberEvacKey(s) }
}

export function emptyEmberCache(): EmberCache {
  return { without: new Array<EmberRun | null>(EMBER_MEMBERS).fill(null), with: new Array<EmberRun | null>(EMBER_MEMBERS).fill(null) }
}

export type EmberTask = { kind: 'fire' | 'evac'; side: EmberSide; member: number }

/** The next simulation the cache needs for these keys, member by member (without, then with; fire, then its
 *  evacuation), or null when every member is ready. A run whose fire key changed is rerun; one whose evacuation key
 *  changed only gets its households recomputed. */
export function nextEmberTask(cache: EmberCache, keys: EmberKeys): EmberTask | null {
  for (let member = 0; member < EMBER_MEMBERS; member++)
    for (const side of SIDES) {
      const run = cache[side][member]
      if (!run || run.fireKey !== keys[side]) return { kind: 'fire', side, member }
      if (run.evacKey !== keys.evac || run.households === null) return { kind: 'evac', side, member }
    }
  return null
}

/** The fire as the ensemble needs it (FireResult's fields); `line` must be present on with-lines runs. */
export interface EmberFire {
  arrivalMin: Float32Array
  burnedCells: number
  line?: FireLineReport
}

/** Runs exactly one simulation (nextEmberTask) and stores it in the cache; false when nothing was left to run.
 *  `fire(side, seed)` runs the fire for one side and seed; `households(arrivalMin)` the evacuation on a fire. */
export function runNextEmberTask(
  cache: EmberCache,
  keys: EmberKeys,
  fire: (side: EmberSide, seed: number) => EmberFire,
  households: (arrivalMin: Float32Array) => number,
): boolean {
  const task = nextEmberTask(cache, keys)
  if (!task) return false
  const slot = cache[task.side]
  if (task.kind === 'fire') {
    const r = fire(task.side, EMBER_SEEDS[task.member])
    if (task.side === 'with' && !r.line) throw new Error('El fuego con cortafuegos no informó qué pasó en las líneas')
    slot[task.member] = { fireKey: keys[task.side], arrivalMin: r.arrivalMin, burnedCells: r.burnedCells, line: r.line ?? null, evacKey: null, households: null }
  } else {
    const run = slot[task.member]!
    const h = households(run.arrivalMin)
    if (!Number.isFinite(h)) throw new Error(`La evacuación dio un número de hogares no finito (${h})`)
    run.households = h
    run.evacKey = keys.evac
  }
  return true
}

function ready(run: EmberRun | null, fireKey: string, evacKey: string): run is EmberRun & { households: number } {
  return run !== null && run.fireKey === fireKey && run.evacKey === evacKey && run.households !== null
}

/** The members whose two runs are both up to date for these keys, by seed. */
export function readyEmberMembers(cache: EmberCache, keys: EmberKeys): EmberMemberOut[] {
  const out: EmberMemberOut[] = []
  for (let m = 0; m < EMBER_MEMBERS; m++) {
    const a = cache.without[m]
    const b = cache.with[m]
    if (!ready(a, keys.without, keys.evac) || !ready(b, keys.with, keys.evac)) continue
    if (!b.line) throw new Error(`Falta el informe de las líneas en la simulación ${EMBER_SEEDS[m]}`)
    out.push({
      seed: EMBER_SEEDS[m],
      without: { households: a.households, burnedCells: a.burnedCells },
      with: { households: b.households, burnedCells: b.burnedCells, line: b.line },
    })
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------
// Summary for the panel
// ---------------------------------------------------------------------------------------------------------

export interface EmberQuantiles {
  p10: number
  p50: number
  p90: number
}

export interface EmberSummary {
  n: number
  /** Members in which the fire reaches the lines (FireLineReport.reachedMin finite). */
  reached: number
  /** Members in which at least one ember jump over the lines starts a fire (crossedCells > 0). */
  crossed: number
  /** Households cut off without and with the lines. */
  without: EmberQuantiles
  with: EmberQuantiles
  /** Paired difference per member, without - with (positive = fewer with the lines). */
  saved: EmberQuantiles
  /** 100 * saved / without per member; null when a member has no households cut off without the lines. */
  savedPct: EmberQuantiles | null
  /** Burned area at the end, without - with, per member (ha). */
  haSaved: EmberQuantiles
  /** First spot fire across the lines (minutes since t0), over the members that cross; null if none does. */
  firstCrossMin: EmberQuantiles | null
  /** First time the fire touches the lines, over the members where it does; null if it never does. */
  reachedMin: EmberQuantiles | null
}

/** Quantile with linear interpolation between order statistics (numpy's default). `sorted` ascending, non-empty. */
function quantile(sorted: readonly number[], p: number): number {
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  const hi = Math.min(sorted.length - 1, lo + 1)
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo])
}

function quantiles(values: readonly number[]): EmberQuantiles {
  const s = [...values].sort((a, b) => a - b)
  return { p10: quantile(s, 0.1), p50: quantile(s, 0.5), p90: quantile(s, 0.9) }
}

export function summariseEmbers(members: readonly EmberMemberOut[], cellM: number): EmberSummary {
  if (members.length === 0) throw new Error('summariseEmbers: no members')
  if (!(cellM > 0)) throw new Error(`summariseEmbers: cellM must be > 0 (got ${cellM})`)
  const cellHa = (cellM * cellM) / 1e4
  const saved = members.map((m) => m.without.households - m.with.households)
  const crossing = members.filter((m) => m.with.line.crossedCells > 0)
  const reaching = members.filter((m) => Number.isFinite(m.with.line.reachedMin))
  const firstCross = crossing.map((m) => m.with.line.firstCrossMin)
  if (!firstCross.every(Number.isFinite)) throw new Error('summariseEmbers: a member crosses the lines without a crossing time')
  return {
    n: members.length,
    reached: reaching.length,
    crossed: crossing.length,
    without: quantiles(members.map((m) => m.without.households)),
    with: quantiles(members.map((m) => m.with.households)),
    saved: quantiles(saved),
    savedPct: members.every((m) => m.without.households > 0) ? quantiles(members.map((m, k) => (100 * saved[k]) / m.without.households)) : null,
    haSaved: quantiles(members.map((m) => (m.without.burnedCells - m.with.burnedCells) * cellHa)),
    firstCrossMin: crossing.length > 0 ? quantiles(firstCross) : null,
    reachedMin: reaching.length > 0 ? quantiles(reaching.map((m) => m.with.line.reachedMin)) : null,
  }
}
