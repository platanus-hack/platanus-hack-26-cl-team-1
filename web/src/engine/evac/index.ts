// STUB (replaced by the evacuation-engine work): returns "nobody at risk" so the UI can be built in parallel.
import type { EvacInput, EvacParams, EvacPrepared, EvacResult, GridMeta, RoadsFile } from '../types'

export const DEFAULT_EVAC_PARAMS: EvacParams = {
  alertMin: 6 * 60,
  prepMedianMin: 10,
  prepSigma: 0.6,
  footShare: 0.5,
  walkKmh: 4.5,
  carKmhByClass: [60, 40, 35, 30, 20, 0],
  safetyMarginMin: 5,
  safeDistanceM: 800,
  personsPerHousehold: 2.9,
}

export function prepareEvac(
  _grid: GridMeta,
  _fuel: Uint8Array,
  roads: RoadsFile,
  buildings: Float32Array,
  _params: Pick<EvacParams, 'safeDistanceM'>,
): EvacPrepared {
  return { nodeCount: roads.nodes.length, edgeCount: roads.edges.length, buildingCount: buildings.length / 3 }
}

export function simulateEvac(input: EvacInput): EvacResult {
  const n = input.prepared.buildingCount as number
  return {
    householdRisk: new Float32Array(n),
    householdStatus: new Uint8Array(n),
    expectedTrappedHouseholds: 0,
    expectedTrappedPeople: 0,
    buildingsReached: 0,
    edgeFlow: new Float32Array(input.prepared.edgeCount),
    edgeClosesMin: new Float32Array(input.prepared.edgeCount).fill(Infinity),
    riskByAlert: [],
    elapsedMs: 0,
  }
}
