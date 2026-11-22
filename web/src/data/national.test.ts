import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { DataError, parseBrigades, parseGrid, parseNationalStations, stationsInBox, unitsOfVehicles } from './load'
import { UNIT, UNIT_COUNT } from '../engine/types'

const shipped = JSON.parse(readFileSync(new URL('../../public/data/national/bomberos_cl.json', import.meta.url), 'utf8'))
const clone = () => JSON.parse(JSON.stringify(shipped))
const grid = parseGrid(JSON.parse(readFileSync(new URL('../../public/data/grid.json', import.meta.url), 'utf8')))
const brigades = parseBrigades(JSON.parse(readFileSync(new URL('../../public/data/brigades.json', import.meta.url), 'utf8')), grid)

function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = (d: number) => (d * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

describe('parseNationalStations', () => {
  it('accepts the shipped file: every compañía of Chile, all 16 regions, the JNB 2025 register size', () => {
    const f = parseNationalStations(shipped)
    expect(f.stations.length).toBeGreaterThan(1200)
    expect(new Set(f.stations.map((s) => s.region)).size).toBe(16)
    const vehicles = f.stations.reduce((a, s) => a + s.vehicles.length, 0)
    // Register 2025: 4,476 vehicles in active service; documented vehicles above it are kept (a few ladders).
    expect(vehicles).toBeGreaterThanOrEqual(4476)
    expect(vehicles).toBeLessThan(4476 * 1.02)
    expect(f.reference.find((r) => r.label.startsWith('Material mayor'))?.value).toBe(4476)
    expect(f.stations.every((s) => s.vehicles.length > 0 && s.units.length === UNIT_COUNT)).toBe(true)
  })
  it('rejects units that disagree with the vehicles, and totals that disagree with the stations', () => {
    const j = clone()
    j.stations[0].units[UNIT.BOMBA] += 1
    expect(() => parseNationalStations(j)).toThrow(/no coincide con sus carros/)
    const k = clone()
    k.totals.vehicles += 1
    expect(() => parseNationalStations(k)).toThrow(/totals.vehicles/)
  })
  it('rejects an unknown vehicle kind, a station outside Chile, a duplicate id', () => {
    const j = clone()
    j.stations[0].vehicles[0].kind = 'tanque'
    expect(() => parseNationalStations(j)).toThrow(DataError)
    const k = clone()
    k.stations[0].lon = -60
    expect(() => parseNationalStations(k)).toThrow(/fuera de Chile/)
    const m = clone()
    m.stations[1].id = m.stations[0].id
    expect(() => parseNationalStations(m)).toThrow(/duplicado/)
  })
  it('rejects a complete fleet with an estimated vehicle', () => {
    const j = clone()
    const s = j.stations.find((x: { fleetComplete: boolean }) => x.fleetComplete)
    s.vehicles[0].source = null
    expect(() => parseNationalStations(j)).toThrow(/flota completa/)
  })
})

describe('unitsOfVehicles', () => {
  it('counts engine unit types and skips the vehicles the engine does not model', () => {
    expect(unitsOfVehicles([{ kind: 'bomba' }, { kind: 'bomba_rescate' }, { kind: 'primera_intervencion' }, { kind: 'aljibe' }, { kind: 'escala' }, { kind: 'mando' }])).toEqual([2, 1, 1, 1])
  })
})

describe('stationsInBox', () => {
  const nat = parseNationalStations(shipped)
  const box = { lonMin: grid.lonMin, lonMax: grid.lonMin + grid.cols * grid.dLon, latMin: grid.latMax - grid.rows * grid.dLat, latMax: grid.latMax }
  it('returns brigade-engine stations for a scenario box; any estimated truck makes the fleet "supuesto" (null)', () => {
    const got = stationsInBox(nat, box)
    expect(got.length).toBeGreaterThanOrEqual(brigades.stations.length)
    expect(got.every((s) => s.lon >= box.lonMin && s.lon <= box.lonMax && s.lat >= box.latMin && s.lat <= box.latMax)).toBe(true)
    const byId = new Map(nat.stations.map((s) => [s.id, s]))
    for (const s of got) {
      const n = byId.get(s.id)!
      expect(s.unitsSource).toBe(n.fleetComplete ? n.fleetSource : null)
    }
    // The box has partly documented fleets (fleetSource set, fleetComplete false): they must come out as supuesto.
    expect(got.some((s) => byId.get(s.id)!.fleetSource !== null && !byId.get(s.id)!.fleetComplete && s.unitsSource === null)).toBe(true)
    expect(() => stationsInBox(nat, { ...box, lonMin: box.lonMax })).toThrow(DataError)
  })
  it('agrees with the hand-curated Viña del Mar stations: same cuerpo and number within 1.5 km', () => {
    // Against every station, not only those in the box: a national position may differ from the hand-curated one
    // and fall just outside the grid.
    const byKey = new Map(nat.stations.map((s) => [`${s.cuerpo}|${s.number}`, s]))
    for (const b of brigades.stations) {
      const n = Number.parseInt(b.company, 10)
      const m = byKey.get(`${b.cuerpo}|${n}`)
      expect(m, `${b.id}`).toBeDefined()
      expect(haversineM(b.lon, b.lat, m!.lon, m!.lat), b.id).toBeLessThan(1500)
    }
  })
})
