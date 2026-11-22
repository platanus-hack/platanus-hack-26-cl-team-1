// Evacuation engine: who gets out before the fire cuts their way. Model and assumptions: MODEL.md.
// Pure TypeScript (no DOM): runs in a Web Worker and in Node.
import type { EvacParams } from '../types'

export { prepareEvac } from './prepare'
export { simulateEvac } from './simulate'

export const DEFAULT_EVAC_PARAMS: EvacParams = {
  alertMin: 6 * 60,
  prepMedianMin: 10,
  prepSigma: 0.6,
  footShare: 0.5,
  walkKmh: 4.5,
  // MOTORWAY, PRIMARY, SECONDARY, TERTIARY, LOCAL, PATH (PATH is foot-only: the value is ignored)
  carKmhByClass: [60, 40, 35, 30, 20, 0],
  safetyMarginMin: 5,
  safeDistanceM: 800,
  personsPerHousehold: 2.9,
}
