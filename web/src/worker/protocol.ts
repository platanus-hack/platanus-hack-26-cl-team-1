// Messages between the UI thread (client.ts) and the simulation worker (sim.worker.ts).
import type { WeatherSeries } from '../engine/types'
import type { PlannedUnit } from '../engine/brigade'
import type { Scenario } from './scenario'
import type { TimelineChoice } from '../data/timeline'
import type { EmberRangeRow } from './emberRange'

/** init: the worker loads the same dataset the UI uses (real files, or the deterministic synthetic set) and sees
 *  it from the same timeline (src/data/timeline.ts). */
export type ToWorker = { type: 'init'; synthetic: boolean; timeline: TimelineChoice } | { type: 'run'; id: number; scenario: Scenario }

export interface FireOut {
  arrivalMin: Float32Array
  rosMPerMin: Float32Array
  burnedCells: number
  elapsedMs: number
}

export interface EvacOut {
  householdRisk: Float32Array
  householdStatus: Uint8Array
  expectedTrappedHouseholds: number
  expectedTrappedPeople: number
  buildingsReached: number
  edgeFlow: Float32Array
  edgeClosesMin: Float32Array
  riskByAlert: { alertMin: number; expectedTrappedHouseholds: number }[]
  elapsedMs: number
}

/** Firefighting results (present only when Bomberos is on). The run's fire/evac are the defended ones. */
export interface BrigadesOut {
  units: PlannedUnit[]
  /** Edges closed by the historical cuts in force. */
  cutEdges: number[]
  defendedCells: number
  /** Expected households taken out by Escala / rescate units. */
  rescuedExpected: number
  /** The same scenario without firefighters (pass 1), for the comparison. */
  base: { burnedCells: number; buildingsReached: number; expectedTrappedHouseholds: number; expectedTrappedPeople: number }
  planMs: number
}

export interface RunResult {
  id: number
  /** Present only when the fire was recomputed in this run (otherwise the previous fire still holds). */
  fire?: FireOut
  evac: EvacOut
  brigades?: BrigadesOut
  /** 1 per road node that is a safe destination in this run. */
  safeNodes: Uint8Array
  weather: WeatherSeries
  notes: string[]
  /** Total time spent in the worker for this run (ms). */
  workerMs: number
}

export type FromWorker =
  | { type: 'ready'; loadMs: number; prepareMs: number }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; id: number | null; message: string }
  /** Drawn firebreaks under several ember distances (emberRange.ts), sent after the run's result when the scenario
   *  has firebreaks: rows null while it is being computed, then the rows (or an error). */
  | { type: 'emberRange'; id: number; rows: EmberRangeRow[] | null; error: string | null }
