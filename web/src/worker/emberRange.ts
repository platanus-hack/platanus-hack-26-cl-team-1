// Drawn firebreaks under several ember distances (D-034). Whether a 30-120 m firebreak holds depends mostly on how
// far the model throws embers (engine/fire/MODEL.md section 5), a knob calibrated only on Viña 2024. So when the user
// has drawn firebreaks, the worker also runs the scenario at each distance below and at the scenario's own ember
// setting, without and with the lines, and the panel shows the range instead of one number. No firefighters in these
// runs. Pure TypeScript, no DOM.
import { simulateFire } from '../engine/fire'
import type { FireInput } from '../engine/types'
import type { Scenario } from './scenario'

/** Ember distances (m per km/h of wind) the fire calibration on Viña 2024 tried: 12 (an earlier fit), 15 (the
 *  ensemble runs) and 25 (shipped). engine/fire/MODEL.md section 6. */
export const EMBER_RANGE_M_PER_KMH = [12, 15, 25] as const

/** An ember setting: a distance in m per km/h of wind, or null for embers off. */
export type EmberSetting = number | null

export interface EmberOutcome {
  burnedCells: number
  /** Expected households cut off (EvacResult.expectedTrappedHouseholds). */
  households: number
}

export interface EmberRangeRow {
  /** null: embers off (only when the scenario itself has them off). */
  spotMetresPerKmh: EmberSetting
  without: EmberOutcome
  with: EmberOutcome
}

/** The settings the range shows: the scenario's own (so one row always matches the main result without firefighters),
 *  then the calibration's distances, without repeats. */
export function emberSettings(s: Pick<Scenario, 'spotting' | 'spotMetresPerKmh'>): EmberSetting[] {
  const own: EmberSetting = s.spotting ? s.spotMetresPerKmh : null
  return [own, ...EMBER_RANGE_M_PER_KMH.filter((m) => m !== own)]
}

/** Cache key of a setting. */
export const emberLabel = (e: EmberSetting): string => (e === null ? 'off' : String(e))

/** The scenario's fire at one ember setting with the given firebreak mask. Inputs are not modified. */
export function emberFire(input: FireInput, firebreak: Uint8Array, e: EmberSetting): { arrivalMin: Float32Array; burnedCells: number } {
  if (firebreak.length !== input.firebreak.length) throw new Error('emberFire: las máscaras de cortafuegos no tienen el mismo tamaño')
  const params = e === null ? { ...input.params, spotting: false } : { ...input.params, spotting: true, spotMetresPerKmh: e }
  const r = simulateFire({ ...input, firebreak, params, defense: undefined })
  return { arrivalMin: r.arrivalMin, burnedCells: r.burnedCells }
}

/** One ember setting: the fire without the drawn lines (`noLinesFirebreak`: the scenario's mask minus the drawn lines,
 *  so the plan's belt stays) and with them (`withLines`, the scenario's fire input), and the expected households cut
 *  off on each (`trapped`). */
export function emberRangeRow(withLines: FireInput, noLinesFirebreak: Uint8Array, e: EmberSetting, trapped: (arrivalMin: Float32Array) => number): EmberRangeRow {
  const a = emberFire(withLines, noLinesFirebreak, e)
  const b = emberFire(withLines, withLines.firebreak, e)
  return {
    spotMetresPerKmh: e,
    without: { burnedCells: a.burnedCells, households: trapped(a.arrivalMin) },
    with: { burnedCells: b.burnedCells, households: trapped(b.arrivalMin) },
  }
}

/** What the range's fires depend on: the scenario's fire inputs minus the ember settings (each row sets its own). */
export function emberRangeFireKey(s: Scenario): string {
  return JSON.stringify([s.weather, s.droughtFactor, s.presetIgnitions, s.userIgnitions, s.firebreaks, s.planTiles])
}

/** What the range's evacuations add on top: a change here reruns the evacuations only, not the fires. */
export function emberRangeEvacKey(s: Scenario): string {
  return JSON.stringify([s.planSectors, s.alertMin, s.cueShare, s.cueRadiusM, s.prepMedianMin, s.footShare, s.closedEdges, s.addedLinks])
}

/** Households cut off: percentage the lines remove (positive = fewer), null when there were none without them. */
export function linesCutPct(row: EmberRangeRow): number | null {
  return row.without.households > 0 ? (100 * (row.without.households - row.with.households)) / row.without.households : null
}
