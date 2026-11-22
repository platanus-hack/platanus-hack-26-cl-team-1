// Evacuation engine: who gets out before the fire cuts their way. Model and assumptions: MODEL.md.
// Pure TypeScript (no DOM): runs in a Web Worker and in Node.
import type { EvacParams } from '../types'

export { prepareEvac } from './prepare'
export { simulateEvac } from './simulate'

/** Share of households that leave on environmental cues (flames, embers, smoke, neighbours leaving)
 *  without waiting for an official order. In the NIST household survey of the 2016 Chimney Tops 2 fire
 *  (Gatlinburg, TN; https://doi.org/10.6028/NIST.TN.2103), 82.0 % of households evacuated and 81.4 % of
 *  those left after observing a fire cue (77.5 % saw, heard or smelled the fire), while only 11.4 % cited
 *  an official order: about 0.82 x 0.81 = 0.67 of all households. Rounded down to 0.65. */
export const DEFAULT_CUE_SHARE = 0.65
/** Distance at which a household notices the fire (flames, ember showers) and responds. A modelling
 *  assumption, not a measured value: a little more than the fire engine's maximum ember-spotting distance
 *  at that afternoon's mean wind (25 m per km/h x 27-28 km/h in weather.json ~ 700 m), i.e. embers and
 *  flames at the edge of the neighbourhood. MODEL.md lists the sensitivity to it. */
export const DEFAULT_CUE_RADIUS_M = 900

export const DEFAULT_EVAC_PARAMS: EvacParams = {
  alertMin: 6 * 60,
  cueRadiusM: DEFAULT_CUE_RADIUS_M,
  cueShare: DEFAULT_CUE_SHARE,
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
