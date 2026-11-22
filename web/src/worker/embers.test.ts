import { describe, expect, it } from 'vitest'
import type { FireLineReport } from '../engine/types'
import {
  EMBER_MEMBERS,
  EMBER_SEEDS,
  emberEvacKey,
  emberKeys,
  emberWithKey,
  emberWithoutKey,
  emptyEmberCache,
  nextEmberTask,
  readyEmberMembers,
  runNextEmberTask,
  summariseEmbers,
  type EmberCache,
  type EmberFire,
  type EmberKeys,
  type EmberMemberOut,
  type EmberSide,
} from './embers'
import type { Scenario } from './scenario'

function scenario(patch: Partial<Scenario> = {}): Scenario {
  return {
    weather: { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 },
    droughtFactor: 10,
    spotting: true,
    spotMetresPerKmh: 25,
    presetIgnitions: ['a'],
    userIgnitions: [],
    firebreaks: [{ id: 'f1', points: [[0, 0], [1, 1]], widthM: 60 }],
    alertMin: 360,
    cueShare: 0.65,
    cueRadiusM: 900,
    prepMedianMin: 10,
    footShare: 0.5,
    closedEdges: [],
    addedLinks: [],
    brigades: { enabled: false, units: {}, dispatchMin: {}, reinforcementUnits: {}, reinforcementMin: {}, historicalCuts: true },
    planTiles: [],
    planSectors: [],
    ...patch,
  }
}

function expectQ(q: { p10: number; p50: number; p90: number } | null, [p10, p50, p90]: [number, number, number]) {
  expect(q).not.toBeNull()
  expect(q!.p10).toBeCloseTo(p10)
  expect(q!.p50).toBeCloseTo(p50)
  expect(q!.p90).toBeCloseTo(p90)
}

const NONE: FireLineReport = { reachedMin: Infinity, firstCrossMin: Infinity, crossedCells: 0 }

function member(seed: number, without: number, withHh: number, line: FireLineReport = NONE, cells: [number, number] = [1000, 900]): EmberMemberOut {
  return { seed, without: { households: without, burnedCells: cells[0] }, with: { households: withHh, burnedCells: cells[1], line } }
}

describe('summariseEmbers', () => {
  // saved (without - with) = 10, 10, 20, 5, 0 -> sorted 0, 5, 10, 10, 20.
  const members = [
    member(1, 100, 90, { reachedMin: 180, firstCrossMin: 200, crossedCells: 3 }, [1000, 900]),
    member(2, 110, 100, { reachedMin: 170, firstCrossMin: 190, crossedCells: 1 }, [1000, 950]),
    member(3, 120, 100, { reachedMin: 190, firstCrossMin: Infinity, crossedCells: 0 }, [1000, 1000]),
    member(4, 130, 125, { reachedMin: 160, firstCrossMin: 230, crossedCells: 7 }, [1000, 980]),
    member(5, 140, 140, NONE, [1000, 1010]),
  ]

  it('takes linearly interpolated quantiles of each side and of the paired differences', () => {
    const s = summariseEmbers(members, 100) // 1 ha per cell
    expect(s.n).toBe(5)
    expectQ(s.without, [104, 120, 136])
    expectQ(s.with, [94, 100, 134])
    // Paired: quantiles of the differences, not the difference of the quantiles (120 - 100 = 20).
    expectQ(s.saved, [2, 10, 16])
    // ha saved per member: 100, 50, 0, 20, -10 -> sorted -10, 0, 20, 50, 100.
    expectQ(s.haSaved, [-6, 20, 80])
    // Percentages per member: 10, 9.09, 16.67, 3.85, 0 -> median 9.09.
    expect(s.savedPct!.p50).toBeCloseTo((100 * 10) / 110)
  })

  it('counts crossings and reaches, and takes their times over those members only', () => {
    const s = summariseEmbers(members, 60)
    expect(s.crossed).toBe(3)
    expect(s.reached).toBe(4)
    expectQ(s.firstCrossMin, [192, 200, 224])
    expect(s.reachedMin!.p50).toBe(175)
    // 60 m cells: 0.36 ha each.
    expect(s.haSaved.p50).toBeCloseTo(20 * 0.36)
  })

  it('has no percentage when a member has no households cut off without the lines', () => {
    const s = summariseEmbers([member(1, 0, 0), member(2, 5, 4)], 60)
    expect(s.savedPct).toBeNull()
    expect(s.saved.p50).toBeCloseTo(0.5)
  })

  it('has no times when nothing reaches or crosses the lines', () => {
    const s = summariseEmbers([member(1, 10, 10), member(2, 12, 12)], 60)
    expect(s.crossed).toBe(0)
    expect(s.reached).toBe(0)
    expect(s.firstCrossMin).toBeNull()
    expect(s.reachedMin).toBeNull()
  })

  it('refuses no members, a bad cell size and a crossing without a time', () => {
    expect(() => summariseEmbers([], 60)).toThrow()
    expect(() => summariseEmbers(members, 0)).toThrow()
    expect(() => summariseEmbers([member(1, 10, 5, { reachedMin: 100, firstCrossMin: Infinity, crossedCells: 2 })], 60)).toThrow()
  })
})

describe('ember keys', () => {
  const s = scenario()

  it('the runs without the lines ignore the lines, the firefighters, the embers switch and the evacuation', () => {
    const k = emberWithoutKey(s)
    expect(emberWithoutKey({ ...s, firebreaks: [] })).toBe(k)
    expect(emberWithoutKey({ ...s, brigades: { ...s.brigades, enabled: true } })).toBe(k)
    expect(emberWithoutKey({ ...s, spotting: false })).toBe(k)
    expect(emberWithoutKey({ ...s, alertMin: 300, closedEdges: [4], planSectors: [2] })).toBe(k)
    expect(emberWithoutKey({ ...s, weather: { ...s.weather, windFactor: 1.1 } })).not.toBe(k)
    expect(emberWithoutKey({ ...s, droughtFactor: 9 })).not.toBe(k)
    expect(emberWithoutKey({ ...s, spotMetresPerKmh: 15 })).not.toBe(k)
    expect(emberWithoutKey({ ...s, presetIgnitions: [] })).not.toBe(k)
    expect(emberWithoutKey({ ...s, userIgnitions: [{ id: 'u', lon: 0, lat: 0, tMin: 0 }] })).not.toBe(k)
    expect(emberWithoutKey({ ...s, planTiles: [3] })).not.toBe(k)
  })

  it('the runs with the lines follow the lines but not the firefighters', () => {
    const k = emberWithKey(s)
    expect(emberWithKey({ ...s, firebreaks: [{ ...s.firebreaks[0], widthM: 120 }] })).not.toBe(k)
    expect(emberWithKey({ ...s, brigades: { ...s.brigades, enabled: true } })).toBe(k)
  })

  it('the households ignore the fire inputs and follow the evacuation settings', () => {
    const k = emberEvacKey(s)
    expect(emberEvacKey({ ...s, firebreaks: [], weather: { ...s.weather, rhOffset: 10 }, droughtFactor: 8, presetIgnitions: [], planTiles: [3] })).toBe(k)
    expect(emberEvacKey({ ...s, brigades: { ...s.brigades, enabled: true } })).toBe(k)
    for (const patch of [{ alertMin: 300 }, { cueShare: 0.5 }, { cueRadiusM: 500 }, { prepMedianMin: 20 }, { footShare: 0.2 }, { closedEdges: [1] }, { addedLinks: [{ u: 1, v: 2 }] }, { planSectors: [5] }])
      expect(emberEvacKey({ ...s, ...patch })).not.toBe(k)
  })
})

/** A fake engine that counts its calls: the fire's arrival encodes the side and seed, the evacuation reads it. */
function fakeEngine() {
  const calls = { fire: [] as [EmberSide, number][], evac: 0 }
  const fire = (side: EmberSide, seed: number): EmberFire => {
    calls.fire.push([side, seed])
    const out: EmberFire = { arrivalMin: new Float32Array([side === 'with' ? seed : 100 + seed]), burnedCells: side === 'with' ? 10 : 20 }
    if (side === 'with') out.line = { reachedMin: 60, firstCrossMin: 70 + seed, crossedCells: 1 }
    return out
  }
  const households = (a: Float32Array) => {
    calls.evac++
    return a[0]
  }
  return { calls, fire, households }
}

function runAll(cache: EmberCache, keys: EmberKeys, e: ReturnType<typeof fakeEngine>): number {
  let tasks = 0
  while (runNextEmberTask(cache, keys, e.fire, e.households)) tasks++
  return tasks
}

describe('ember cache', () => {
  const s = scenario()

  it('runs each seed without and with the lines, one simulation per call, members completing in seed order', () => {
    const cache = emptyEmberCache()
    const keys = emberKeys(s)
    const e = fakeEngine()
    for (let k = 0; k < 4; k++) runNextEmberTask(cache, keys, e.fire, e.households)
    expect(readyEmberMembers(cache, keys).map((m) => m.seed)).toEqual([1])
    expect(runAll(cache, keys, e)).toBe(4 * EMBER_MEMBERS - 4)
    expect(e.calls.fire.filter(([side]) => side === 'without').map(([, seed]) => seed)).toEqual([...EMBER_SEEDS])
    expect(e.calls.fire.filter(([side]) => side === 'with').map(([, seed]) => seed)).toEqual([...EMBER_SEEDS])
    expect(e.calls.evac).toBe(2 * EMBER_MEMBERS)
    expect(nextEmberTask(cache, keys)).toBeNull()
    const members = readyEmberMembers(cache, keys)
    expect(members).toHaveLength(EMBER_MEMBERS)
    expect(members[2]).toEqual({
      seed: 3,
      without: { households: 103, burnedCells: 20 },
      with: { households: 3, burnedCells: 10, line: { reachedMin: 60, firstCrossMin: 73, crossedCells: 1 } },
    })
  })

  it('an evacuation change reruns only the evacuations', () => {
    const cache = emptyEmberCache()
    const e = fakeEngine()
    runAll(cache, emberKeys(s), e)
    const e2 = fakeEngine()
    const keys2 = emberKeys({ ...s, alertMin: 300 })
    expect(readyEmberMembers(cache, keys2)).toHaveLength(0)
    expect(runAll(cache, keys2, e2)).toBe(2 * EMBER_MEMBERS)
    expect(e2.calls.fire).toHaveLength(0)
    expect(e2.calls.evac).toBe(2 * EMBER_MEMBERS)
  })

  it('a line edit reruns only the runs with the lines; a weather change reruns both sides', () => {
    const cache = emptyEmberCache()
    runAll(cache, emberKeys(s), fakeEngine())
    const e2 = fakeEngine()
    const lineEdit = emberKeys({ ...s, firebreaks: [{ ...s.firebreaks[0], widthM: 120 }] })
    runAll(cache, lineEdit, e2)
    expect(e2.calls.fire.every(([side]) => side === 'with')).toBe(true)
    expect(e2.calls.fire).toHaveLength(EMBER_MEMBERS)
    expect(e2.calls.evac).toBe(EMBER_MEMBERS)
    const e3 = fakeEngine()
    runAll(cache, emberKeys({ ...s, droughtFactor: 9 }), e3)
    expect(e3.calls.fire).toHaveLength(2 * EMBER_MEMBERS)
  })

  it('refuses a run with the lines that does not report on them', () => {
    const cache = emptyEmberCache()
    const keys = emberKeys(s)
    const noLine = (side: EmberSide): EmberFire => ({ arrivalMin: new Float32Array(1), burnedCells: side === 'with' ? 1 : 2 })
    runNextEmberTask(cache, keys, noLine, () => 0) // without
    runNextEmberTask(cache, keys, noLine, () => 0) // its evacuation
    expect(() => runNextEmberTask(cache, keys, noLine, () => 0)).toThrow()
  })

  it('refuses a non-finite household count', () => {
    const cache = emptyEmberCache()
    const keys = emberKeys(s)
    const e = fakeEngine()
    runNextEmberTask(cache, keys, e.fire, e.households)
    expect(() => runNextEmberTask(cache, keys, e.fire, () => NaN)).toThrow()
  })
})
