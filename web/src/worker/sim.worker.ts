/// <reference lib="webworker" />
// Simulation worker: loads its own copy of the dataset (fetching and parsing here is much faster than a
// structured clone of ~200k small arrays from the UI thread), prepares the evacuation graph once, then on each
// request reruns the fire only when its inputs changed and always reruns the (cheap) evacuation.
import { simulateFire, DEFAULT_FIRE_PARAMS } from '../engine/fire'
import { prepareEvac, simulateEvac, DEFAULT_EVAC_PARAMS } from '../engine/evac'
import type { EvacPrepared, FireResult } from '../engine/types'
import type { FromWorker, RunResult, ToWorker } from './protocol'
import type { Dataset } from '../data/load'
import { loadRealDataset } from '../data/load'
import { makeMockDataset } from '../data/mock'
import { buildIgnitions, buildWeatherSeries, fireKey, HORIZON_MIN, rasteriseFirebreaks, safeNodes, wildlandDistanceM } from './scenario'

const ctx = self as unknown as DedicatedWorkerGlobalScope

let data: Dataset | null = null
let prepared: EvacPrepared | null = null
let wildDist: Float32Array | null = null
let lastFireKey = ''
let lastFire: FireResult | null = null

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer)
}

async function init(synthetic: boolean) {
  const t = performance.now()
  const d: Dataset | null = synthetic ? makeMockDataset() : await loadRealDataset()
  if (!d) throw new Error('El simulador no encontró los datos reales en /data/ (grid.json)')
  data = d
  const loadMs = performance.now() - t
  prepared = prepareEvac(d.grid, d.fuel, d.roads, d.buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })
  wildDist = wildlandDistanceM(d.grid, d.fuel)
  lastFireKey = ''
  lastFire = null
  post({ type: 'ready', loadMs, prepareMs: performance.now() - t - loadMs })
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  if (msg.type === 'init') {
    init(msg.synthetic).catch((e: unknown) => post({ type: 'error', id: null, message: e instanceof Error ? e.message : String(e) }))
    return
  }
  try {
    if (!data || !prepared || !wildDist) throw new Error('El simulador aún no tiene datos')
    const t = performance.now()
    const s = msg.scenario
    const wb = buildWeatherSeries(data.weather, data.grid.t0, s.weather)
    const key = fireKey(s)
    let fireChanged = false
    if (key !== lastFireKey || !lastFire) {
      lastFire = simulateFire({
        grid: data.grid,
        elevation: data.elevation,
        fuel: data.fuel,
        firebreak: rasteriseFirebreaks(data.grid, s.firebreaks),
        ignitions: buildIgnitions(data.grid, data.ignitions, s),
        weather: wb.series,
        params: {
          ...DEFAULT_FIRE_PARAMS,
          droughtFactor: s.droughtFactor,
          spotting: s.spotting,
          spotMetresPerKmh: s.spotMetresPerKmh,
          horizonMin: HORIZON_MIN,
        },
      })
      lastFireKey = key
      fireChanged = true
    }
    const evac = simulateEvac({
      prepared,
      arrivalMin: lastFire.arrivalMin,
      params: {
        ...DEFAULT_EVAC_PARAMS,
        alertMin: s.alertMin,
        cueShare: s.cueShare,
        cueRadiusM: s.cueRadiusM,
        prepMedianMin: s.prepMedianMin,
        footShare: s.footShare,
      },
      edits: { closedEdges: s.closedEdges, addedLinks: s.addedLinks },
    })
    const safe = safeNodes(data.grid, data.roads.nodes, wildDist, lastFire.arrivalMin, DEFAULT_EVAC_PARAMS.safeDistanceM)
    const result: RunResult = {
      id: msg.id,
      // Copies, so transferring them never detaches buffers the engine might keep.
      evac: {
        householdRisk: evac.householdRisk.slice(),
        householdStatus: evac.householdStatus.slice(),
        expectedTrappedHouseholds: evac.expectedTrappedHouseholds,
        expectedTrappedPeople: evac.expectedTrappedPeople,
        buildingsReached: evac.buildingsReached,
        edgeFlow: evac.edgeFlow.slice(),
        edgeClosesMin: evac.edgeClosesMin.slice(),
        riskByAlert: evac.riskByAlert,
        elapsedMs: evac.elapsedMs,
      },
      safeNodes: safe,
      weather: wb.series,
      notes: wb.notes,
      workerMs: 0,
    }
    const e = result.evac
    const transfer: Transferable[] = [e.householdRisk.buffer, e.householdStatus.buffer, e.edgeFlow.buffer, e.edgeClosesMin.buffer, safe.buffer]
    if (fireChanged) {
      // The worker keeps its own copy of the fire for later evacuation-only runs; the copies are transferred.
      const arrival = lastFire.arrivalMin.slice()
      const ros = lastFire.rosMPerMin.slice()
      result.fire = { arrivalMin: arrival, rosMPerMin: ros, burnedCells: lastFire.burnedCells, elapsedMs: lastFire.elapsedMs }
      transfer.push(arrival.buffer, ros.buffer)
    }
    result.workerMs = performance.now() - t
    post({ type: 'result', result }, transfer)
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
  }
}
