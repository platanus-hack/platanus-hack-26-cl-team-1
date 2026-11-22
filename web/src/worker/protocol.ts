// Messages between the UI thread (client.ts) and the simulation worker (sim.worker.ts).
import type { WeatherSeries } from '../engine/types'
import type { PlannedUnit } from '../engine/brigade'
import type { Scenario } from './scenario'
import type { TimelineChoice } from '../data/timeline'
import type { EmberMemberOut } from './embers'

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

/** The probabilistic-ember ensemble for the drawn firebreaks (embers.ts). One follows each successful run's result,
 *  with that run's id; while it is 'running' another follows each completed member, then 'done' or 'error'. A newer
 *  run stops the sequence with no final message (the UI ignores ids other than its last result's). A run that fails
 *  posts only its 'error' result.
 *  - off: embers are off (or at distance 0) or there are no drawn firebreaks; nothing is computed.
 *  - running: `members` are the members already up to date for this scenario (from the cache or just computed).
 *  - done: all `total` members.
 *  - error: `error` says why; the cache was cleared. */
export interface EmbersMessage {
  type: 'embers'
  id: number
  status: 'off' | 'running' | 'done' | 'error'
  total: number
  members: EmberMemberOut[]
  error: string | null
}

export type FromWorker =
  | { type: 'ready'; loadMs: number; prepareMs: number }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; id: number | null; message: string }
  | EmbersMessage
