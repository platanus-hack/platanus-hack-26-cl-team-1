import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DataError,
  parseElevation,
  parseFuel,
  parseGrid,
  parseRoads,
  parseScar,
  parseWeather,
  parseBuildings,
  parseNationalPopulation,
  parsePopulationLayer,
} from './load'
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
    const home = parsePopulationLayer('population_home.bin', d.populationHome.buffer as ArrayBuffer, n)
    const work = parsePopulationLayer('population_work.bin', d.populationWork.buffer as ArrayBuffer, n)
    const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0)
    expect(sum(home)).toBeGreaterThan(1000)
    expect(sum(work)).toBeCloseTo(sum(home), 0)
  })

  it('cell centre round-trips through lonLatToCell', () => {
    const d = makeMockDataset()
    for (const cell of [0, 1234, d.grid.rows * d.grid.cols - 1]) {
      const [lon, lat] = cellCentre(d.grid, cell)
      expect(lonLatToCell(d.grid, lon, lat)).toBe(cell)
    }
  })
})

describe('population files', () => {
  const nationalBuf = (cells: number[], home: number[], work: number[], nres: number[]) => {
    const n = cells.length
    const buf = new ArrayBuffer(16 * n)
    new Uint32Array(buf, 0, n).set(cells)
    new Float32Array(buf, 4 * n, n).set(home)
    new Float32Array(buf, 8 * n, n).set(work)
    new Float32Array(buf, 12 * n, n).set(nres)
    return buf
  }
  const meta = {
    version: 1,
    lonMin: -72,
    latMax: -33,
    dLon: 1 / 120,
    dLat: 1 / 120,
    rows: 2,
    cols: 2,
    n: 3,
    layout: 'x',
    commute: { scaleM: 10000, maxM: 30000 },
    totals: { home: 30, work: 30, stayHome: 0, nonResidentialMillionM3: 0 },
    source: 's',
  }

  it('validates the per-cell layers', () => {
    expect(parsePopulationLayer('population_home.bin', new Float32Array([0, 1.5, 3]).buffer, 3)).toHaveLength(3)
    expect(() => parsePopulationLayer('population_home.bin', new Float32Array(2).buffer, 3)).toThrow(/8 bytes, se esperaban 12/)
    expect(() => parsePopulationLayer('population_work.bin', new Float32Array([0, -1, 3]).buffer, 3)).toThrow(/celda 1/)
    expect(() => parsePopulationLayer('population_work.bin', new Float32Array([0, NaN, 3]).buffer, 3)).toThrow(/NaN/)
  })

  it('validates the national product', () => {
    const ok = parseNationalPopulation(meta, nationalBuf([0, 1, 3], [10, 20, 0], [0, 5, 25], [0, 1e4, 9e4]))
    expect(Array.from(ok.cell)).toEqual([0, 1, 3])
    expect(() => parseNationalPopulation(meta, nationalBuf([0, 3, 1], [10, 20, 0], [0, 5, 25], [0, 0, 0]))).toThrow(/no creciente/)
    expect(() => parseNationalPopulation(meta, nationalBuf([0, 1, 4], [10, 20, 0], [0, 5, 25], [0, 0, 0]))).toThrow(/fuera de rango/)
    expect(() => parseNationalPopulation(meta, nationalBuf([0, 1, 3], [10, 20, 9], [0, 5, 25], [0, 0, 0]))).toThrow(/totals.home/)
    expect(() => parseNationalPopulation({ ...meta, version: 2 }, nationalBuf([0], [1], [1], [0]))).toThrow(/versión/)
    expect(() => parseNationalPopulation(meta, new ArrayBuffer(47))).toThrow(/47 bytes/)
  })

  it('the committed files pass their own checks and conserve people', () => {
    const read = (f: string) => {
      const b = readFileSync(new URL(`../../public/data/${f}`, import.meta.url))
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
    }
    const national = parseNationalPopulation(JSON.parse(new TextDecoder().decode(read('national/population_cl.json'))), read('national/population_cl.bin'))
    // The gravity model moves people, it does not create them (the totals are rounded to whole persons).
    expect(Math.abs(national.meta.totals.home - national.meta.totals.work)).toBeLessThanOrEqual(1)
    expect(national.meta.totals.home).toBeGreaterThan(15e6)
    const grid = parseGrid(JSON.parse(new TextDecoder().decode(read('grid.json'))))
    const cells = grid.rows * grid.cols
    const home = parsePopulationLayer('population_home.bin', read('population_home.bin'), cells)
    const work = parsePopulationLayer('population_work.bin', read('population_work.bin'), cells)
    expect(home.reduce((x, y) => x + y, 0)).toBeGreaterThan(5e5)
    expect(work.reduce((x, y) => x + y, 0)).toBeGreaterThan(5e5)
  })
})
