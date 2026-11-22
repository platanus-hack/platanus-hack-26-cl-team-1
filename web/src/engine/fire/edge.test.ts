import { describe, expect, it } from 'vitest'
import { FUEL, type FireInput, type GridMeta } from '../types'
import { edgeContact } from './edge'
import { DEFAULT_FIRE_PARAMS, simulateFire } from './index'

/** rows x cols arrival field, Infinity everywhere except the given cells. */
function field(rows: number, cols: number, set: [number, number, number][]): Float32Array {
  const a = new Float32Array(rows * cols).fill(Infinity)
  for (const [r, c, t] of set) a[r * cols + c] = t
  return a
}

describe('edgeContact', () => {
  it('reports nothing for a fire that stays inside', () => {
    const e = edgeContact(5, 6, field(5, 6, [[2, 2, 10], [2, 3, 20], [1, 1, 30]]))
    expect(e.firstMin).toBe(Infinity)
    expect([e.north, e.south, e.east, e.west]).toEqual([Infinity, Infinity, Infinity, Infinity])
    expect(e.cells.length).toBe(0)
  })

  it('finds the earliest arrival on each side, a corner counting for both of its sides', () => {
    // (0,3) north at 50; (4,5) the south-east corner at 70; (2,5) east at 40; (2,2) inside at 5.
    const e = edgeContact(5, 6, field(5, 6, [[0, 3, 50], [4, 5, 70], [2, 5, 40], [2, 2, 5]]))
    expect(e.north).toBe(50)
    expect(e.south).toBe(70)
    expect(e.east).toBe(40)
    expect(e.west).toBe(Infinity)
    expect(e.firstMin).toBe(40)
  })

  it('lists each reached outer-ring cell once, by arrival', () => {
    const e = edgeContact(5, 6, field(5, 6, [[0, 0, 30], [4, 5, 10], [3, 0, 20], [2, 2, 1]]))
    expect(Array.from(e.cells)).toEqual([4 * 6 + 5, 3 * 6, 0])
    expect(Array.from(e.times)).toEqual([10, 20, 30])
  })

  it('handles one-row and one-column grids', () => {
    expect(Array.from(edgeContact(1, 4, field(1, 4, [[0, 1, 3]])).cells)).toEqual([1])
    const col = edgeContact(4, 1, field(4, 1, [[2, 0, 3]]))
    expect(Array.from(col.cells)).toEqual([2])
    expect([col.east, col.west, col.north]).toEqual([3, 3, Infinity])
  })

  it('refuses an arrival field that does not match the grid', () => {
    expect(() => edgeContact(5, 6, new Float32Array(29))).toThrow(/29 cells/)
    expect(() => edgeContact(0, 6, new Float32Array(0))).toThrow(/invalid grid/)
  })

  it('catches the engine stopping at the grid edge downwind', () => {
    const rows = 40
    const cols = 60
    const grid: GridMeta = { rows, cols, latMax: 0, lonMin: 0, dLat: 1e-4, dLon: 1e-4, cellM: 30, t0: '2024-02-02T12:00:00-03:00', sources: {} }
    const n = rows * cols
    const input: FireInput = {
      grid,
      elevation: new Float32Array(n).fill(100),
      fuel: new Uint8Array(n).fill(FUEL.GRASS),
      firebreak: new Uint8Array(n),
      // West wind: the head runs east, towards col 59.
      ignitions: [{ cell: 20 * cols + 45, tMin: 0 }],
      weather: { t0Min: 0, stepMin: 60, samples: [{ tempC: 35, rh: 15, windKmh: 40, windFromDeg: 270 }] },
      params: { ...DEFAULT_FIRE_PARAMS, spotting: false, horizonMin: 240 },
    }
    const res = simulateFire(input)
    const e = edgeContact(rows, cols, res.arrivalMin)
    expect(Number.isFinite(e.east)).toBe(true)
    expect(e.firstMin).toBe(e.east)
    expect(e.east).toBeLessThan(e.west)
    // Every reached ring cell really burned, at the time listed.
    for (let k = 0; k < e.cells.length; k++) expect(res.arrivalMin[e.cells[k]]).toBe(e.times[k])
  })
})
