// Drawn firebreaks under several ember distances (D-034). Whether a 30-120 m firebreak holds depends mostly on how
// far the model throws embers (engine/fire/MODEL.md section 5), a knob calibrated only on Viña 2024. So when the user
// has drawn firebreaks, the worker also runs the scenario at each distance below, without and with the lines, and
// the panel shows the range instead of one number. No firefighters in these runs. Pure TypeScript, no DOM.
import { simulateFire } from '../engine/fire'
import type { FireInput } from '../engine/types'
import type { Scenario } from './scenario'

/** Ember distances (m per km/h of wind) the fire calibration on Viña 2024 tried: 12 (an earlier fit), 15 (the
 *  ensemble runs) and 25 (shipped). engine/fire/MODEL.md section 6. */
export const EMBER_RANGE_M_PER_KMH = [12, 15, 25] as const

export interface EmberOutcome {
  burnedCells: number
  /** Expected households cut off (EvacResult.expectedTrappedHouseholds). */
  households: number
}

export interface EmberRangeRow {
  spotMetresPerKmh: number
  without: EmberOutcome
  with: EmberOutcome
}

/** One ember distance: the scenario's fire with embers on at `spotMetresPerKmh`, without the drawn lines
 *  (`noLinesFirebreak`: the same mask minus the drawn lines, so the plan's belt stays) and with them (`withLines`,
 *  the scenario's fire input), and the expected households cut off on each (`trapped`). Inputs are not modified. */
export function emberRangeRow(
  withLines: FireInput,
  noLinesFirebreak: Uint8Array,
  spotMetresPerKmh: number,
  trapped: (arrivalMin: Float32Array) => number,
): EmberRangeRow {
  if (noLinesFirebreak.length !== withLines.firebreak.length) throw new Error('emberRangeRow: las máscaras de cortafuegos no tienen el mismo tamaño')
  const params = { ...withLines.params, spotting: true, spotMetresPerKmh }
  const a = simulateFire({ ...withLines, firebreak: noLinesFirebreak, params, defense: undefined })
  const b = simulateFire({ ...withLines, params, defense: undefined })
  return {
    spotMetresPerKmh,
    without: { burnedCells: a.burnedCells, households: trapped(a.arrivalMin) },
    with: { burnedCells: b.burnedCells, households: trapped(b.arrivalMin) },
  }
}

/** Everything the range depends on: the scenario minus the ember settings (overridden) and the firefighters (off). */
export function emberRangeKey(s: Scenario): string {
  return JSON.stringify([
    s.weather,
    s.droughtFactor,
    s.presetIgnitions,
    s.userIgnitions,
    s.firebreaks,
    s.planTiles,
    s.planSectors,
    s.alertMin,
    s.cueShare,
    s.cueRadiusM,
    s.prepMedianMin,
    s.footShare,
    s.closedEdges,
    s.addedLinks,
  ])
}

/** Households cut off: percentage the lines remove (positive = fewer), null when there were none without them. */
export function linesCutPct(row: EmberRangeRow): number | null {
  return row.without.households > 0 ? (100 * (row.without.households - row.with.households)) / row.without.households : null
}
