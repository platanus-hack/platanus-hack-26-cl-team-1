import { describe, expect, it } from 'vitest'
import type { GridMeta, WeatherFile } from '../engine/types'
import { FUEL } from '../engine/types'
import {
  buildIgnitions,
  buildWeatherSeries,
  countAtOrBefore,
  fireKey,
  rasteriseFirebreaks,
  safeNodes,
  sampleAt,
  sortedArrivals,
  wildlandDistanceM,
  type Scenario,
  type WeatherSettings,
} from './scenario'
import { cellCentre } from '../data/grid'
import { ERA5_WIND_DIR_CORRECTION_DEG as DIR } from '../engine/fire'

const grid: GridMeta = {
  rows: 20,
  cols: 20,
  latMax: -33,
  lonMin: -71.5,
  dLat: 0.001,
  dLon: 0.001,
  cellM: 100,
  t0: '2024-02-02T12:00:00-03:00',
  sources: {},
}

const weather: WeatherFile = {
  source: 'test',
  lat: -33,
  lon: -71.5,
  times: ['2024-02-02T11:00', '2024-02-02T12:00', '2024-02-02T13:00'],
  tempC: [20, 25, 30],
  rh: [50, 30, 2],
  windKmh: [10, 20, 30],
  windFromDeg: [350, 10, 30],
  gustKmh: [15, 30, 45],
}

const neutral: WeatherSettings = { mode: 'real', windFactor: 1, windDirOffsetDeg: 0, rhOffset: 0, tempOffsetC: 0, windKmh: 0, windFromDeg: 0, rh: 50, tempC: 20 }

function scenario(patch: Partial<Scenario> = {}): Scenario {
  return {
    weather: neutral,
    droughtFactor: 10,
    spotting: true,
    spotMetresPerKmh: 12,
    presetIgnitions: [],
    userIgnitions: [],
    firebreaks: [],
    alertMin: 360,
    cueShare: 0.65,
    cueRadiusM: 900,
    prepMedianMin: 10,
    footShare: 0.5,
    closedEdges: [],
    addedLinks: [],
    ...patch,
  }
}

describe('buildWeatherSeries', () => {
  it('maps the hourly file to minutes since t0', () => {
    const { series, notes } = buildWeatherSeries(weather, grid.t0, neutral)
    expect(series.t0Min).toBe(-60)
    expect(series.stepMin).toBe(60)
    expect(series.samples).toHaveLength(3)
    // Mode "real" applies the calibrated ERA5 direction correction (engine/fire/model.ts).
    expect(series.samples[1]).toEqual({ tempC: 25, rh: 30, windKmh: 20, windFromDeg: (10 + DIR + 360) % 360 })
    expect(notes).toEqual([])
  })

  it('applies adjustments and reports the humidity clamp', () => {
    const { series, notes } = buildWeatherSeries(weather, grid.t0, { ...neutral, windFactor: 1.5, windDirOffsetDeg: 20, rhOffset: -10, tempOffsetC: 2 })
    expect(series.samples[0]).toEqual({ tempC: 22, rh: 40, windKmh: 15, windFromDeg: (10 + DIR + 360) % 360 })
    expect(series.samples[2].rh).toBe(1)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('1 de 3')
  })

  it('constant mode holds one sample', () => {
    const { series } = buildWeatherSeries(weather, grid.t0, { ...neutral, mode: 'constante', windKmh: 40, windFromDeg: 370, rh: 15, tempC: 33 })
    expect(series.samples).toEqual([{ tempC: 33, rh: 15, windKmh: 40, windFromDeg: 10 }])
  })

  it('constant mode rejects humidity outside 1..100', () => {
    expect(() => buildWeatherSeries(weather, grid.t0, { ...neutral, mode: 'constante', rh: 0 })).toThrow(/Humedad/)
  })
})

describe('sampleAt', () => {
  it('interpolates linearly and wraps the wind direction', () => {
    const { series } = buildWeatherSeries(weather, grid.t0, neutral)
    const s = sampleAt(series, -30)
    expect(s.windKmh).toBeCloseTo(15)
    expect(s.windFromDeg).toBeCloseTo((360 + DIR) % 360) // halfway between 350 and 10 through north, plus the correction
    expect(sampleAt(series, -500).windKmh).toBe(10)
    expect(sampleAt(series, 999).windKmh).toBe(30)
  })
})

describe('buildIgnitions', () => {
  it('converts presets and user points to cells and minutes', () => {
    const presets = [{ id: 'a', label: 'A', lon: -71.4955, lat: -33.0025, timeLocal: '2024-02-02T14:30', source: 's' }]
    const ig = buildIgnitions(grid, presets, scenario({ presetIgnitions: ['a'], userIgnitions: [{ id: 'u', lon: -71.4995, lat: -33.0005, tMin: 15 }] }))
    expect(ig).toEqual([
      { cell: 2 * 20 + 4, tMin: 150 },
      { cell: 0, tMin: 15 },
    ])
  })

  it('rejects unknown presets and points outside the grid', () => {
    expect(() => buildIgnitions(grid, [], scenario({ presetIgnitions: ['x'] }))).toThrow(/desconocida/)
    expect(() => buildIgnitions(grid, [], scenario({ userIgnitions: [{ id: 'u', lon: -80, lat: -33, tMin: 0 }] }))).toThrow(/fuera/)
  })
})

describe('rasteriseFirebreaks', () => {
  const at = (c: number, r: number): [number, number] => cellCentre(grid, r * grid.cols + c)

  it('a thin diagonal line is 4-connected (no corner gaps)', () => {
    const m = rasteriseFirebreaks(grid, [{ id: 'f', points: [at(2, 2), at(12, 12)], widthM: 30 }])
    for (let k = 2; k <= 12; k++) expect(m[k * grid.cols + k]).toBe(1)
    // every diagonal step has a 4-neighbour bridge
    for (let k = 2; k < 12; k++) {
      const bridged = m[k * grid.cols + k + 1] === 1 || m[(k + 1) * grid.cols + k] === 1
      expect(bridged).toBe(true)
    }
  })

  it('width adds cells within half the width of the line', () => {
    const m = rasteriseFirebreaks(grid, [{ id: 'f', points: [at(2, 10), at(17, 10)], widthM: 120 }])
    const marked = (r: number) => m[r * grid.cols + 8]
    // 120 m wide with 100 m cells: centres within 60 m -> rows 10 only... plus the trace; 9 and 11 are 100 m away
    expect(marked(10)).toBe(1)
    expect(marked(9)).toBe(0)
    const wide = rasteriseFirebreaks(grid, [{ id: 'f', points: [at(2, 10), at(17, 10)], widthM: 240 } as never])
    expect(wide[9 * grid.cols + 8]).toBe(1)
    expect(wide[11 * grid.cols + 8]).toBe(1)
    expect(wide[8 * grid.cols + 8]).toBe(0)
  })

  it('rejects a firebreak with fewer than 2 points', () => {
    expect(() => rasteriseFirebreaks(grid, [{ id: 'f', points: [at(1, 1)], widthM: 60 }])).toThrow(/2 puntos/)
  })
})

describe('safe zones', () => {
  it('needs distance from wildland fuel and an unburned cell', () => {
    const fuel = new Uint8Array(grid.rows * grid.cols).fill(FUEL.URBAN_DENSE)
    for (let r = 0; r < grid.rows; r++) fuel[r * grid.cols] = FUEL.GRASS // wildland along the west edge
    const d = wildlandDistanceM(grid, fuel)
    expect(d[5 * grid.cols]).toBe(0)
    expect(d[5 * grid.cols + 8]).toBeCloseTo(800)
    const nodes: [number, number][] = [cellCentre(grid, 5 * grid.cols + 2), cellCentre(grid, 5 * grid.cols + 15), cellCentre(grid, 6 * grid.cols + 15)]
    const arrival = new Float32Array(grid.rows * grid.cols).fill(Infinity)
    arrival[6 * grid.cols + 15] = 100
    expect(Array.from(safeNodes(grid, nodes, d, arrival, 800))).toEqual([0, 1, 0])
  })
})

describe('results helpers', () => {
  it('counts burned cells by time', () => {
    const s = sortedArrivals(new Float32Array([5, Infinity, 1, 3, Infinity]))
    expect(Array.from(s)).toEqual([1, 3, 5])
    expect(countAtOrBefore(s, 0)).toBe(0)
    expect(countAtOrBefore(s, 3)).toBe(2)
    expect(countAtOrBefore(s, 100)).toBe(3)
  })

  it('fireKey ignores evacuation-only settings', () => {
    expect(fireKey(scenario({ alertMin: 1 }))).toBe(fireKey(scenario({ alertMin: 2, closedEdges: [3] })))
    expect(fireKey(scenario({ droughtFactor: 5 }))).not.toBe(fireKey(scenario()))
  })
})
