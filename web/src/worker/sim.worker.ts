/// <reference lib="webworker" />
// Simulation worker: loads its own copy of the dataset (fetching and parsing here is much faster than a
// structured clone of ~200k small arrays from the UI thread), prepares the evacuation graph once, then on each
// request reruns the fire only when its inputs changed and always reruns the (cheap) evacuation. With embers on and
// drawn firebreaks, it then runs the probabilistic-ember ensemble (embers.ts) in the background, one simulation per
// task, so a new request never waits for more than one of them.
import { simulateFire, DEFAULT_FIRE_PARAMS } from '../engine/fire'
import { prepareEvac, simulateEvac, DEFAULT_EVAC_PARAMS } from '../engine/evac'
import { applyRescue, planBrigades, type BrigadePlan } from '../engine/brigade'
import { applyBelt, buildBelt, checkPlanAgainstData, programmeFor, type Belt } from '../engine/plan'
import type { EvacParams, EvacPrepared, FireInput, FireResult, Ignition } from '../engine/types'
import type { BrigadesOut, EmbersMessage, FromWorker, RunResult, ToWorker } from './protocol'
import { localToMin } from '../data/time'
import type { Dataset } from '../data/load'
import { loadRealDataset } from '../data/load'
import { makeMockDataset } from '../data/mock'
import { timelineDataset, type TimelineChoice } from '../data/timeline'
import { checkEvent, EVENTS, eventOfTimeline } from '../data/events'
import { brigadeKey, buildIgnitions, buildWeatherSeries, fireKey, rasteriseFirebreaks, safeNodes, snapIgnitions, wildlandDistanceM } from './scenario'
import { EMBER_MEMBERS, emberKeys, emptyEmberCache, readyEmberMembers, runNextEmberTask, type EmberCache, type EmberFire, type EmberKeys, type EmberSide } from './embers'

const ctx = self as unknown as DedicatedWorkerGlobalScope

let data: Dataset | null = null
let prepared: EvacPrepared | null = null
let wildDist: Float32Array | null = null
/** The 200 m belt around inhabited land, by plan tile (src/engine/plan), built once per dataset. */
let belt: Belt | null = null
/** Visible notes about the last fire's inputs (plan ignition cells left untreated, ignitions moved off cells that
 *  cannot burn). */
let fireNotes: string[] = []
let lastFireKey = ''
let lastFire: FireResult | null = null
let lastFireInput: FireInput | null = null
/** For the last fire: the drawn lines alone (the ensemble's FireInput.lineMask), and the firebreak mask without them
 *  (the plan belt only, zeros without a plan) with the fire starts snapped against it, which the ensemble's runs
 *  without the lines use (snapped against the lines, a start could move with them, and the runs without the lines
 *  must not depend on the lines). */
let lastLineMask: Uint8Array | null = null
let lastNoLinesIgnitions: Ignition[] | null = null
let lastNoLinesFirebreak: Uint8Array | null = null
/** Pass 2 (defended fire) cache, keyed by fireKey + brigadeKey. */
let lastDefKey = ''
let lastDef: { fire: FireResult; plan: BrigadePlan; planMs: number } | null = null
let lastSentKey = ''
/** Probabilistic-ember ensemble (embers.ts): the pending background step, and the runs kept per seed and side. */
let emberTimer: ReturnType<typeof setTimeout> | null = null
let emberCache: EmberCache = emptyEmberCache()

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer)
}

async function init(synthetic: boolean, timeline: TimelineChoice) {
  const t = performance.now()
  const event = checkEvent(EVENTS[eventOfTimeline(timeline.id)])
  const d: Dataset | null = synthetic ? makeMockDataset() : await loadRealDataset(event)
  if (!d) throw new Error(`El simulador no encontró los datos reales en /data/${event.dir} (grid.json)`)
  data = timelineDataset(d, timeline)
  const loadMs = performance.now() - t
  prepared = prepareEvac(d.grid, d.fuel, d.roads, d.buildings, { safeDistanceM: DEFAULT_EVAC_PARAMS.safeDistanceM })
  wildDist = wildlandDistanceM(d.grid, d.fuel)
  belt = buildBelt(d.grid, d.fuel, d.buildings)
  if (d.plan) checkPlanAgainstData(belt, d.plan)
  lastFireKey = ''
  lastFire = null
  lastDefKey = ''
  lastDef = null
  lastSentKey = ''
  resetEmbers()
  post({ type: 'ready', loadMs, prepareMs: performance.now() - t - loadMs })
}

function clearEmberTimer() {
  if (emberTimer !== null) {
    clearTimeout(emberTimer)
    emberTimer = null
  }
}

function resetEmbers() {
  clearEmberTimer()
  emberCache = emptyEmberCache()
  lastLineMask = null
  lastNoLinesFirebreak = null
  lastNoLinesIgnitions = null
}

/** Loading the files can fail on a flaky network (a scenario switch at a demo venue): retry after 1, 2 and 4 s
 *  before reporting the error. A data error (a file that fails validation) fails the same way each time and is
 *  reported after the last attempt. */
async function initWithRetry(synthetic: boolean, timeline: TimelineChoice) {
  const waitsMs = [1000, 2000, 4000]
  for (let k = 0; ; k++) {
    try {
      return await init(synthetic, timeline)
    } catch (e) {
      if (k >= waitsMs.length) throw e
      await new Promise((r) => setTimeout(r, waitsMs[k]))
    }
  }
}

ctx.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data
  // Any message stops the ensemble's background step first: a step left over from before would run on old inputs.
  clearEmberTimer()
  if (msg.type === 'init') {
    resetEmbers()
    initWithRetry(msg.synthetic, msg.timeline).catch((e: unknown) => post({ type: 'error', id: null, message: e instanceof Error ? e.message : String(e) }))
    return
  }
  try {
    if (!data || !prepared || !wildDist || !belt) throw new Error('El simulador aún no tiene datos')
    const t = performance.now()
    const s = msg.scenario
    const wb = buildWeatherSeries(data.weather, data.grid.t0, s.weather, data.windDirCorrectionDeg)
    const key = fireKey(s)
    if (key !== lastFireKey || !lastFire) {
      const ignitions = buildIgnitions(data.grid, data.ignitions, s)
      let fuel = data.fuel
      const lines = rasteriseFirebreaks(data.grid, s.firebreaks)
      let firebreak = lines
      let noLines: Uint8Array = new Uint8Array(lines.length)
      // Notes and cache are set only once the fire succeeds: a failed run must leave the last good fire, its input
      // (reused by the firefighters' pass and the ember ensemble) and its notes untouched.
      const notes: string[] = []
      if (s.planTiles.length > 0) {
        // Plan de preparación: the belt cleared in the chosen tiles (src/engine/plan).
        const ignitionCells = ignitions.map((g) => g.cell)
        const a = applyBelt(belt, s.planTiles, fuel, firebreak, ignitionCells)
        fuel = a.fuel
        firebreak = a.firebreak
        noLines = applyBelt(belt, s.planTiles, data.fuel, noLines, ignitionCells).firebreak
        if (a.skippedIgnitionCells > 0)
          notes.push(
            a.skippedIgnitionCells === 1
              ? 'Un foco cae en la franja tratada; esa celda se dejó sin tratar para que el fuego pueda empezar.'
              : `${a.skippedIgnitionCells} focos caen en la franja tratada; esas celdas se dejaron sin tratar para que el fuego pueda empezar.`,
          )
      }
      // A start point on water, pavement or a firebreak moves to the nearest vegetation (and the panel says so).
      const snapped = snapIgnitions(data.grid, fuel, firebreak, ignitions)
      notes.push(...snapped.notes)
      const snappedNoLines = snapIgnitions(data.grid, fuel, noLines, ignitions).ignitions
      const input: FireInput = {
        grid: data.grid,
        elevation: data.elevation,
        fuel,
        firebreak,
        ignitions: snapped.ignitions,
        weather: wb.series,
        params: {
          ...DEFAULT_FIRE_PARAMS,
          droughtFactor: s.droughtFactor,
          spotting: s.spotting,
          spotMetresPerKmh: s.spotMetresPerKmh,
          horizonMin: data.horizonMin,
        },
      }
      const newFire = simulateFire(input)
      lastFireInput = input
      lastFire = newFire
      fireNotes = notes
      lastNoLinesIgnitions = snappedNoLines
      lastFireKey = key
      lastLineMask = lines
      lastNoLinesFirebreak = noLines
    }
    const evacParams: EvacParams = {
      ...DEFAULT_EVAC_PARAMS,
      personsPerHousehold: data.event.evac.personsPerHousehold.value,
      alertMin: s.alertMin,
      cueShare: s.cueShare,
      cueRadiusM: s.cueRadiusM,
      prepMedianMin: s.prepMedianMin,
      footShare: s.footShare,
    }
    const edits = { closedEdges: s.closedEdges, addedLinks: s.addedLinks }
    // Plan de preparación: households of the chosen sectors are in the community programme.
    const programme = programmeFor(belt, s.planSectors, { prepMedianMin: s.prepMedianMin, cueShare: s.cueShare })
    // Firefighters (MODEL.md of engine/brigade): plan on the fire without them, then rerun the fire defended.
    const bKey = brigadeKey(s)
    let fire = lastFire
    let brigades: BrigadesOut | undefined
    let evac
    if (bKey !== null) {
      if (!data.brigades) throw new Error('Este escenario no tiene datos de bomberos')
      const dKey = key + bKey
      if (dKey !== lastDefKey || !lastDef) {
        const tp = performance.now()
        const plan = planBrigades({
          prepared,
          grid: data.grid,
          fuel: lastFireInput!.fuel,
          arrivalMin: lastFire.arrivalMin,
          file: data.brigades,
          settings: s.brigades,
          toMin: (local) => localToMin(data!.grid.t0, local),
          safetyMarginMin: DEFAULT_EVAC_PARAMS.safetyMarginMin,
          carKmhByClass: DEFAULT_EVAC_PARAMS.carKmhByClass,
          horizonMin: data.horizonMin,
        })
        const planMs = performance.now() - tp
        lastDef = { fire: simulateFire({ ...lastFireInput!, defense: plan.defense }), plan, planMs }
        lastDefKey = dKey
      }
      fire = lastDef.fire
      const base = simulateEvac({ prepared, arrivalMin: lastFire.arrivalMin, params: evacParams, edits, programme })
      const defended = simulateEvac({ prepared, arrivalMin: fire.arrivalMin, params: evacParams, edits, programme })
      const rescue = applyRescue(prepared, defended.householdRisk, defended.householdStatus, lastDef.plan.units, data.horizonMin, defended.expectedTrappedHouseholds)
      evac = {
        ...defended,
        householdRisk: rescue.householdRisk,
        householdStatus: rescue.householdStatus,
        expectedTrappedHouseholds: rescue.expectedTrappedHouseholds,
        expectedTrappedPeople: rescue.expectedTrappedHouseholds * evacParams.personsPerHousehold,
      }
      brigades = {
        units: lastDef.plan.units,
        cutEdges: lastDef.plan.cutEdges,
        defendedCells: lastDef.plan.defendedCells,
        rescuedExpected: rescue.rescuedExpected,
        base: {
          burnedCells: lastFire.burnedCells,
          buildingsReached: base.buildingsReached,
          expectedTrappedHouseholds: base.expectedTrappedHouseholds,
          expectedTrappedPeople: base.expectedTrappedPeople,
        },
        planMs: lastDef.planMs,
      }
    } else {
      evac = simulateEvac({ prepared, arrivalMin: lastFire.arrivalMin, params: evacParams, edits, programme })
    }
    const sentKey = key + (bKey ?? '')
    const fireChanged = sentKey !== lastSentKey
    lastSentKey = sentKey
    const safe = safeNodes(data.grid, data.roads.nodes, wildDist, fire.arrivalMin, DEFAULT_EVAC_PARAMS.safeDistanceM)
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
      brigades,
      safeNodes: safe,
      weather: wb.series,
      notes: [...wb.notes, ...fireNotes],
      workerMs: 0,
    }
    const e = result.evac
    const transfer: Transferable[] = [e.householdRisk.buffer, e.householdStatus.buffer, e.edgeFlow.buffer, e.edgeClosesMin.buffer, safe.buffer]
    if (fireChanged) {
      // The worker keeps its own copy of the fire for later evacuation-only runs; the copies are transferred.
      const arrival = fire.arrivalMin.slice()
      const ros = fire.rosMPerMin.slice()
      result.fire = { arrivalMin: arrival, rosMPerMin: ros, burnedCells: fire.burnedCells, elapsedMs: fire.elapsedMs }
      transfer.push(arrival.buffer, ros.buffer)
    }
    result.workerMs = performance.now() - t
    post({ type: 'result', result }, transfer)
    // Embers at distance 0 never jump: treated as off, like the panel (nothing would differ between members).
    if (s.spotting && s.spotMetresPerKmh > 0 && s.firebreaks.length > 0) {
      const pr = prepared
      const base = lastFireInput!
      const lineMask = lastLineMask!
      const noLines = lastNoLinesFirebreak!
      const noLinesIgnitions = lastNoLinesIgnitions!
      // The scenario's fire with random ember landings for one seed: with the drawn lines (reporting on them), or
      // with the plan belt only. No firefighters. The evacuation is the main run's, without firefighters.
      const fire = (side: EmberSide, seed: number): EmberFire => {
        const params = { ...base.params, emberSeed: seed }
        return side === 'with'
          ? simulateFire({ ...base, params, lineMask, defense: undefined })
          : simulateFire({ ...base, firebreak: noLines, ignitions: noLinesIgnitions, params, lineMask: undefined, defense: undefined })
      }
      const households = (arrivalMin: Float32Array) => simulateEvac({ prepared: pr, arrivalMin, params: evacParams, edits, programme }).expectedTrappedHouseholds
      scheduleEmbers(msg.id, emberKeys(s), fire, households)
    } else {
      post(embersMessage(msg.id, 'off', [], null))
    }
  } catch (e) {
    post({ type: 'error', id: msg.id, message: e instanceof Error ? e.message : String(e) })
  }
}

function embersMessage(id: number, status: EmbersMessage['status'], members: EmbersMessage['members'], error: string | null): EmbersMessage {
  return { type: 'embers', id, status, total: EMBER_MEMBERS, members, error }
}

/** The ensemble for run `id`: posts the members already up to date at once ('done' if all are), then runs the
 *  missing simulations one per task, posting 'running' after each completed member and 'done' at the end. A new
 *  message cancels the timer; the next request resumes from the cache (runs whose keys still match are kept). */
function scheduleEmbers(id: number, keys: EmberKeys, fire: (side: EmberSide, seed: number) => EmberFire, households: (arrivalMin: Float32Array) => number) {
  const fail = (e: unknown) => {
    emberCache = emptyEmberCache()
    post(embersMessage(id, 'error', [], e instanceof Error ? e.message : String(e)))
  }
  let done: number
  try {
    const members = readyEmberMembers(emberCache, keys)
    done = members.length
    if (done === EMBER_MEMBERS) {
      post(embersMessage(id, 'done', members, null))
      return
    }
    post(embersMessage(id, 'running', members, null))
  } catch (e) {
    fail(e)
    return
  }
  const step = () => {
    emberTimer = null
    try {
      if (!runNextEmberTask(emberCache, keys, fire, households)) throw new Error('El conjunto de simulaciones con pavesas quedó incompleto sin tareas pendientes')
      const members = readyEmberMembers(emberCache, keys)
      if (members.length === EMBER_MEMBERS) {
        post(embersMessage(id, 'done', members, null))
        return
      }
      if (members.length !== done) {
        done = members.length
        post(embersMessage(id, 'running', members, null))
      }
      emberTimer = setTimeout(step, 0)
    } catch (e) {
      fail(e)
    }
  }
  emberTimer = setTimeout(step, 0)
}
