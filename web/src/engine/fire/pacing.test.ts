import { describe, expect, it } from 'vitest'
import type { GridMeta } from '../types'
import { fireCluster, frontCurve, frontLagMin, lastAdvanceMin, observedFrontKm, overrunHa, rmsLag, type Obs } from './pacing'

const ORIGIN: [number, number] = [-71.5, -33.1]
const KM_LAT = 1 / 111.32
/** A point d km north of the origin. */
const north = (d: number, tMin: number): Obs => ({ lon: ORIGIN[0], lat: ORIGIN[1] + d * KM_LAT, tMin })

/** Front curve of a radial fire at 0.05 km/min: reaching d km takes 20·d min. */
const BIN = 0.1
const radialCurve = (maxKm: number) => Float64Array.from({ length: Math.round(maxKm / BIN) + 1 }, (_, k) => 20 * k * BIN)

describe('frontLagMin', () => {
  const curve = radialCurve(10) // model front at t = 100 min is 5 km
  it('is 0 when the observed front equals the model front', () => {
    expect(frontLagMin(curve, BIN, 5, 100, 0)).toBeCloseTo(0, 6)
  })
  it('is positive (model late) when the observed front is beyond the model front', () => {
    expect(frontLagMin(curve, BIN, 7, 100, 0)).toBeCloseTo(40, 6)
  })
  it('is negative (model early) when the observed front is short of the model front', () => {
    expect(frontLagMin(curve, BIN, 3, 100, 0)).toBeCloseTo(-40, 6)
  })
  it('is the cap when the model never reaches the observed front', () => {
    expect(frontLagMin(curve, BIN, 25, 100, 0)).toBe(180)
  })
  it('is 0 within half a pixel of the model front', () => {
    expect(frontLagMin(curve, BIN, 5.5, 100, 1)).toBe(0)
  })
})

describe('observedFrontKm and fireCluster', () => {
  it('is null before the first detection and the farthest detection after', () => {
    const obs = [north(1, 10), north(3, 20)]
    expect(observedFrontKm(obs, ORIGIN, 5)).toBeNull()
    expect(observedFrontKm(obs, ORIGIN, 15)).toBeCloseTo(1, 3)
    expect(observedFrontKm(obs, ORIGIN, 25)).toBeCloseTo(3, 3)
  })
  it('keeps detections linked to the ignition through earlier detections and drops an unrelated fire', () => {
    const obs = [north(1, 10), north(3.5, 20), north(6, 30), north(14, 15)]
    const kept = fireCluster(obs, ORIGIN, 3).map((o) => o.tMin)
    expect(kept).toEqual([10, 20, 30])
  })
  it('does not link a detection to one that the satellite saw only later', () => {
    // 6 km at t=10 would link through 3.5 km, but that one is seen at t=20.
    const obs = [north(6, 10), north(3.5, 20)]
    expect(fireCluster(obs, ORIGIN, 3).map((o) => o.tMin)).toEqual([])
  })
})

describe('frontCurve and overrunHa on a grid', () => {
  // 21 x 21 cells of 60 m, origin at the centre cell; arrival = 20 min per km of distance.
  const grid: GridMeta = {
    rows: 21,
    cols: 21,
    cellM: 60,
    latMax: ORIGIN[1] + 10.5 * (60 / 111320),
    lonMin: ORIGIN[0] - 10.5 * (60 / (111320 * Math.cos((33.09 * Math.PI) / 180))),
    dLat: 60 / 111320,
    dLon: 60 / (111320 * Math.cos((33.09 * Math.PI) / 180)),
    t0: '2024-02-02T12:00:00-03:00',
    sources: {},
  }
  const arrival = new Float32Array(grid.rows * grid.cols)
  for (let r = 0; r < grid.rows; r++)
    for (let c = 0; c < grid.cols; c++) arrival[r * grid.cols + c] = 20 * (Math.hypot(r - 10, c - 10) * 0.06)

  it('frontCurve gives the earliest arrival at each distance', () => {
    const curve = frontCurve(arrival, grid, ORIGIN, BIN)
    expect(curve[0]).toBeCloseTo(0, 3)
    expect(curve[5]).toBeGreaterThanOrEqual(10 - 1.3) // 0.5 km: 10 min, within one cell
    expect(curve[5]).toBeLessThanOrEqual(10 + 1.3)
    for (let k = 1; k < curve.length; k++) expect(curve[k]).toBeGreaterThanOrEqual(curve[k - 1])
  })
  it('overrunHa counts burned cells farther than the footprint from every detection', () => {
    // At t = 3 min the fire covers cells within 0.15 km; one detection at the origin, footprint 200 m.
    expect(overrunHa(arrival, grid, [north(0, 0)], 3, 200)).toBe(0)
    // With the detection 1 km away, every burned cell is unsupported.
    const burned = Array.from(arrival).filter((a) => a <= 3).length
    expect(overrunHa(arrival, grid, [north(1, 0)], 3, 200)).toBeCloseTo((burned * 3600) / 1e4, 6)
  })
})

describe('advance phase and RMS', () => {
  it('lastAdvanceMin is the last time the observed front grew, up to tEnd', () => {
    const obs = [north(1, 10), north(3, 20), north(2, 30), north(5, 40), north(5, 50), north(4, 60)]
    expect(lastAdvanceMin(obs, ORIGIN, 100)).toBe(40)
    expect(lastAdvanceMin(obs, ORIGIN, 35)).toBe(20)
    expect(lastAdvanceMin([], ORIGIN, 100)).toBeNull()
  })
  it('rmsLag is the root mean square and refuses an empty set instead of scoring it as perfect', () => {
    expect(rmsLag([3, -4])).toBeCloseTo(Math.sqrt(12.5), 9)
    expect(() => rmsLag([])).toThrow(/no frames/)
  })
})
