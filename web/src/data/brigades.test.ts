import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DataError, parseBrigades, parseGrid } from './load'

const grid = parseGrid(JSON.parse(readFileSync(new URL('../../public/data/grid.json', import.meta.url), 'utf8')))
const shipped = JSON.parse(readFileSync(new URL('../../public/data/brigades.json', import.meta.url), 'utf8'))
const clone = () => JSON.parse(JSON.stringify(shipped))

describe('Eaton brigades.json', () => {
  it('parses against the Eaton grid: 17 stations inside it, every department dispatched, no cuts or mutual aid', () => {
    const g = parseGrid(JSON.parse(readFileSync(new URL('../../public/data/eaton-2025/grid.json', import.meta.url), 'utf8')))
    const b = parseBrigades(JSON.parse(readFileSync(new URL('../../public/data/eaton-2025/brigades.json', import.meta.url), 'utf8')), g)
    expect(b.stations).toHaveLength(17)
    expect(b.dispatch.map((d) => d.cuerpo).sort()).toEqual(['Arcadia FD', 'LA County Fire', 'Monrovia FD', 'Pasadena FD', 'Sierra Madre FD'])
    expect(b.reinforcements).toEqual([])
    expect(b.cuts).toEqual([])
  })
})

describe('parseBrigades', () => {
  it('accepts the shipped file', () => {
    const b = parseBrigades(shipped, grid)
    expect(b.stations.length).toBeGreaterThan(20)
    expect(b.dispatch.map((d) => d.cuerpo).sort()).toEqual(['Quilpué', 'Valparaíso', 'Villa Alemana', 'Viña del Mar'])
    expect(b.cuts[0].lines[0].length).toBeGreaterThan(2)
  })
  it('rejects a station outside the grid', () => {
    const j = clone()
    j.stations[0].lat = -34
    expect(() => parseBrigades(j, grid)).toThrow(DataError)
  })
  it('rejects units of the wrong length or with a negative or fractional count', () => {
    for (const u of [[1, 0, 0], [1, 0, -1, 0], [1.5, 0, 0, 0]]) {
      const j = clone()
      j.stations[0].units = u
      expect(() => parseBrigades(j, grid)).toThrow(/units/)
    }
  })
  it('rejects a station whose cuerpo has no dispatch entry, and duplicate ids', () => {
    const j = clone()
    j.stations[0].cuerpo = 'Concón'
    expect(() => parseBrigades(j, grid)).toThrow(/Concón/)
    const k = clone()
    k.stations[1].id = k.stations[0].id
    expect(() => parseBrigades(k, grid)).toThrow(/duplicado/)
  })
  it('rejects a bad time', () => {
    const j = clone()
    j.dispatch[0].dispatchLocal = 'tarde'
    expect(() => parseBrigades(j, grid)).toThrow(DataError)
  })
})
