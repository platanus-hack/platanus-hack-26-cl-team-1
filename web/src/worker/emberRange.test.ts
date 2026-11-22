import { describe, expect, it } from 'vitest'
import { DEFAULT_FIRE_PARAMS } from '../engine/fire'
import { FUEL, type FireInput, type GridMeta } from '../engine/types'
import { emberRangeEvacKey, emberRangeFireKey, emberRangeRow, emberSettings, linesCutPct } from './emberRange'
import type { Scenario } from './scenario'

// Forest, 30 m cells, 45 km/h wind from the west, a 60 m firebreak (columns 30-31) across the whole grid.
const ROWS = 61
const COLS = 81
function input(): { withLines: FireInput; noLines: Uint8Array } {
  const grid: GridMeta = { rows: ROWS, cols: COLS, latMax: 0, lonMin: 0, dLat: 1e-4, dLon: 1e-4, cellM: 30, t0: '2024-02-02T12:00:00-03:00', sources: {} }
  const n = ROWS * COLS
  const firebreak = new Uint8Array(n)
  for (let r = 0; r < ROWS; r++) firebreak[r * COLS + 30] = firebreak[r * COLS + 31] = 1
  return {
    withLines: {
      grid,
      elevation: new Float32Array(n).fill(100),
      fuel: new Uint8Array(n).fill(FUEL.FOREST),
      firebreak,
      ignitions: [{ cell: 30 * COLS + 10, tMin: 0 }],
      weather: { t0Min: 0, stepMin: 60, samples: [{ tempC: 34, rh: 15, windKmh: 45, windFromDeg: 270 }] },
      // Embers off in the scenario: the range turns them on at each distance anyway.
      params: { ...DEFAULT_FIRE_PARAMS, spotting: false, horizonMin: 600 },
    },
    noLines: new Uint8Array(n),
  }
}
/** Stand-in for the evacuation: cells burned east of the break. */
const eastBurned = (a: Float32Array) => {
  let k = 0
  for (let r = 0; r < ROWS; r++) for (let c = 32; c < COLS; c++) if (Number.isFinite(a[r * COLS + c])) k++
  return k
}

describe('emberRangeRow', () => {
  it('a line that holds when embers fall short is crossed when they fly far', () => {
    const { withLines, noLines } = input()
    // D_max = 1 m/(km/h) * 45 km/h = 45 m, under the 3-cell minimum jump: no embers cross.
    const short = emberRangeRow(withLines, noLines, 1, eastBurned)
    expect(short.without.households).toBeGreaterThan(500)
    expect(short.with.households).toBe(0)
    expect(linesCutPct(short)).toBe(100)
    // D_max = 12 * 45 = 540 m: embers jump the 60 m line.
    const far = emberRangeRow(withLines, noLines, 12, eastBurned)
    expect(far.with.households).toBeGreaterThan(500)
    expect(linesCutPct(far)!).toBeLessThan(linesCutPct(short)!)
    expect(far.with.burnedCells).toBeLessThan(far.without.burnedCells) // the line's own cells never burn
  })

  it('does not modify its inputs and reports no percentage when nothing was cut off', () => {
    const { withLines, noLines } = input()
    const before = withLines.firebreak.slice()
    const row = emberRangeRow(withLines, noLines, 12, () => 0)
    expect(withLines.firebreak).toEqual(before)
    expect(withLines.params.spotting).toBe(false)
    expect(noLines.every((v) => v === 0)).toBe(true)
    expect(linesCutPct(row)).toBeNull()
  })

  it('refuses masks of different sizes', () => {
    const { withLines } = input()
    expect(() => emberRangeRow(withLines, new Uint8Array(3), 12, eastBurned)).toThrow()
  })
})

describe('emberSettings', () => {
  it('puts the scenario own setting first and the calibration distances after, without repeats', () => {
    expect(emberSettings({ spotting: true, spotMetresPerKmh: 25 })).toEqual([25, 12, 15])
    expect(emberSettings({ spotting: true, spotMetresPerKmh: 40 })).toEqual([40, 12, 15, 25])
    expect(emberSettings({ spotting: false, spotMetresPerKmh: 25 })).toEqual([null, 12, 15, 25])
  })
})

describe('emberRangeRow with embers off', () => {
  it('runs without embers, where the 60 m line holds', () => {
    const { withLines, noLines } = input()
    const off = emberRangeRow({ ...withLines, params: { ...withLines.params, spotting: true } }, noLines, null, eastBurned)
    expect(off.spotMetresPerKmh).toBeNull()
    expect(off.with.households).toBe(0)
    expect(off.without.households).toBeGreaterThan(500)
  })
})

describe('emberRange keys', () => {
  const s = { weather: {}, droughtFactor: 10, spotting: true, spotMetresPerKmh: 25, presetIgnitions: ['a'], userIgnitions: [], firebreaks: [], alertMin: 300, cueShare: 0.65, cueRadiusM: 500, prepMedianMin: 10, footShare: 0.2, closedEdges: [], addedLinks: [], planTiles: [], planSectors: [] } as unknown as Scenario
  const both = (x: Scenario) => [emberRangeFireKey(x), emberRangeEvacKey(x)]
  it('ignore the ember settings and the firefighters', () => {
    expect(both({ ...s, spotting: false, spotMetresPerKmh: 5, brigades: { enabled: true } } as unknown as Scenario)).toEqual(both(s))
  })
  it('an evacuation change touches only the evacuation key; a firebreak only the fire key', () => {
    expect(emberRangeFireKey({ ...s, alertMin: 360 })).toBe(emberRangeFireKey(s))
    expect(emberRangeEvacKey({ ...s, alertMin: 360 })).not.toBe(emberRangeEvacKey(s))
    const fb = { ...s, firebreaks: [{ id: 'f', points: [[0, 0], [1, 1]], widthM: 60 }] } as unknown as Scenario
    expect(emberRangeFireKey(fb)).not.toBe(emberRangeFireKey(s))
    expect(emberRangeEvacKey(fb)).toBe(emberRangeEvacKey(s))
  })
})
