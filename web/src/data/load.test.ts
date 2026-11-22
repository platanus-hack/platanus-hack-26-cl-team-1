import { describe, expect, it } from 'vitest'
import { DataError, parseElevation, parseFuel, parseGrid, parseRoads, parseScar, parseWeather, parseBuildings } from './load'
import { makeMockDataset } from './mock'
import { localToMin, minToDateLabel, minToHHMM } from './time'
import { lonLatToCell, cellCentre } from './grid'

const gridJson = {
  rows: 2,
  cols: 3,
  latMax: -33,
  lonMin: -71.6,
  dLat: 0.0005,
  dLon: 0.0006,
  cellM: 60,
  t0: '2024-02-02T12:00:00-03:00',
  sources: { DEM: 'x' },
}

describe('parsers', () => {
  it('accepts a valid grid and rejects a malformed one', () => {
    expect(parseGrid(gridJson).cols).toBe(3)
    expect(() => parseGrid({ ...gridJson, rows: 0 })).toThrow(DataError)
    expect(() => parseGrid({ ...gridJson, t0: 'ayer' })).toThrow(/Hora inválida/)
    expect(() => parseGrid({ ...gridJson, sources: { a: 1 } })).toThrow(/sources/)
  })

  it('checks binary sizes against rows x cols', () => {
    expect(parseFuel(new Uint8Array([0, 1, 2, 3, 4, 6]).buffer, 6)).toHaveLength(6)
    expect(() => parseFuel(new Uint8Array(5).buffer, 6)).toThrow(/5 bytes, se esperaban 6/)
    expect(() => parseFuel(new Uint8Array([0, 0, 0, 0, 0, 9]).buffer, 6)).toThrow(/desconocido 9/)
    expect(() => parseElevation(new Float32Array(5).buffer, 6)).toThrow(/elevation.bin/)
    expect(() => parseElevation(new Float32Array([0, 0, 0, 0, 0, NaN]).buffer, 6)).toThrow(/no finito/)
    expect(() => parseScar(new Uint8Array([0, 1, 255, 0, 0, 2]).buffer, 6)).toThrow(/valor 2/)
    expect(() => parseBuildings(new Uint8Array(13).buffer)).toThrow(/múltiplo de 12/)
  })

  it('validates roads and weather', () => {
    expect(() => parseRoads({ nodes: [[0, 0]], edges: [[0, 1, 10, 4]] })).toThrow(/fuera de rango/)
    expect(() => parseRoads({ nodes: [[0, 0], [1, 1]], edges: [[0, 1, 10, 9]] })).toThrow(/clase/)
    expect(parseRoads({ nodes: [[0, 0], [1, 1]], edges: [[0, 1, 10, 4]] }).edges).toHaveLength(1)
    const w = { source: 's', lat: 0, lon: 0, times: ['2024-02-02T12:00', '2024-02-02T13:00'], tempC: [1, 2], rh: [1, 2], windKmh: [1, 2], windFromDeg: [1, 2], gustKmh: [1, 2] }
    expect(parseWeather(w).times).toHaveLength(2)
    expect(() => parseWeather({ ...w, rh: [1] })).toThrow(/se esperaban 2/)
    expect(() => parseWeather({ ...w, times: ['2024-02-02T13:00', '2024-02-02T12:00'] })).toThrow(/creciente/)
  })
})

describe('time helpers', () => {
  const t0 = '2024-02-02T12:00:00-03:00'
  it('converts local times to minutes since t0 and back', () => {
    expect(localToMin(t0, '2024-02-02T14:30')).toBe(150)
    expect(localToMin(t0, '2024-02-03T06:00')).toBe(18 * 60)
    expect(minToHHMM(t0, 150)).toBe('14:30')
    expect(minToHHMM(t0, 13 * 60)).toBe('01:00')
    expect(minToDateLabel(t0, 13 * 60)).toBe('3 feb 2024')
  })
})

describe('mock dataset', () => {
  it('uses the same formats and sizes as the real files', () => {
    const d = makeMockDataset()
    const n = d.grid.rows * d.grid.cols
    expect(d.synthetic).toBe(true)
    expect(parseGrid(d.grid)).toBeTruthy()
    expect(parseElevation(d.elevation.buffer as ArrayBuffer, n)).toHaveLength(n)
    expect(parseFuel(d.fuel.buffer as ArrayBuffer, n)).toHaveLength(n)
    expect(parseScar(d.scar.buffer as ArrayBuffer, n)).toHaveLength(n)
    expect(parseRoads(d.roads).edges.length).toBeGreaterThan(100)
    expect(parseWeather(d.weather).times).toHaveLength(48)
    expect(d.buildings.length % 3).toBe(0)
    for (const g of d.ignitions) expect(lonLatToCell(d.grid, g.lon, g.lat)).toBeGreaterThanOrEqual(0)
  })

  it('cell centre round-trips through lonLatToCell', () => {
    const d = makeMockDataset()
    for (const cell of [0, 1234, d.grid.rows * d.grid.cols - 1]) {
      const [lon, lat] = cellCentre(d.grid, cell)
      expect(lonLatToCell(d.grid, lon, lat)).toBe(cell)
    }
  })
})
