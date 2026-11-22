import { describe, expect, it } from 'vitest'
import { FUEL, type WeatherSeries } from '../types'
import {
  eccentricity,
  flatRosKmh,
  grassCuringFactor,
  grassMoistureFactor,
  lengthToBreadth,
  mcArthurFFDI,
  rosAtAngle,
  slopeFactor,
  weatherAt,
} from './model'
import { DEFAULT_FIRE_PARAMS } from './index'

const series = (samples: WeatherSeries['samples'], t0Min = 0, stepMin = 60): WeatherSeries => ({ t0Min, stepMin, samples })
const s = (tempC: number, rh: number, windKmh: number, windFromDeg: number) => ({ tempC, rh, windKmh, windFromDeg })

describe('weather interpolation', () => {
  const ws = series([s(20, 60, 10, 350), s(30, 20, 30, 10), s(34, 14, 40, 90)], 120, 60)

  it('interpolates linearly between hourly samples', () => {
    const w = weatherAt(ws, 150) // halfway between 120 and 180
    expect(w.tempC).toBeCloseTo(25)
    expect(w.rh).toBeCloseTo(40)
    expect(w.windKmh).toBeCloseTo(20)
    const w2 = weatherAt(ws, 195) // a quarter of the way from 180 to 240
    expect(w2.tempC).toBeCloseTo(31)
    expect(w2.windKmh).toBeCloseTo(32.5)
  })

  it('interpolates wind direction through north (350 -> 10 passes 0, not 180)', () => {
    expect(weatherAt(ws, 150).windFromDeg).toBeCloseTo(0, 6)
    expect(weatherAt(ws, 135).windFromDeg).toBeCloseTo(355)
    expect(weatherAt(ws, 165).windFromDeg).toBeCloseTo(5)
    // And back the other way: 10 -> 350 goes through 0 as well.
    const back = series([s(20, 50, 10, 10), s(20, 50, 10, 350)])
    expect(weatherAt(back, 15).windFromDeg).toBeCloseTo(5)
    expect(weatherAt(back, 45).windFromDeg).toBeCloseTo(355)
  })

  it('holds the first and last sample outside the series', () => {
    expect(weatherAt(ws, -500)).toEqual(s(20, 60, 10, 350))
    expect(weatherAt(ws, 120)).toEqual(s(20, 60, 10, 350))
    expect(weatherAt(ws, 240)).toEqual(s(34, 14, 40, 90))
    expect(weatherAt(ws, 10_000)).toEqual(s(34, 14, 40, 90))
  })
})

describe('rate of spread formulas', () => {
  it('McArthur FFDI matches the Noble et al. (1980) equation and rises with dryness, heat and wind', () => {
    // Hand-computed: 2 exp(-0.45 + 0.987 ln 10 - 0.0345*20 + 0.0338*30 + 0.0234*30) = 22.33
    expect(mcArthurFFDI(10, 20, 30, 30)).toBeCloseTo(2 * Math.exp(-0.45 + 0.987 * Math.log(10) - 0.69 + 1.014 + 0.702), 6)
    expect(mcArthurFFDI(10, 20, 30, 30)).toBeGreaterThan(mcArthurFFDI(10, 40, 30, 30))
    expect(mcArthurFFDI(10, 20, 35, 30)).toBeGreaterThan(mcArthurFFDI(10, 20, 30, 30))
    expect(mcArthurFFDI(5, 20, 30, 30)).toBeLessThan(mcArthurFFDI(10, 20, 30, 30))
    expect(mcArthurFFDI(0, 20, 30, 30)).toBe(0)
  })

  it('grass moisture factor is continuous at MC = 12 and reaches 0 at extinction', () => {
    expect(grassMoistureFactor(11.9999, 5)).toBeCloseTo(grassMoistureFactor(12, 5), 3)
    expect(grassMoistureFactor(11.9999, 20)).toBeCloseTo(grassMoistureFactor(12, 20), 2)
    expect(grassMoistureFactor(25, 20)).toBe(0)
    expect(grassMoistureFactor(21, 5)).toBe(0)
  })

  it('fully cured grass has curing factor ~1', () => {
    expect(grassCuringFactor(100)).toBeCloseTo(1, 1)
    expect(grassCuringFactor(50)).toBeLessThan(0.05)
  })

  it('derived fuels are fixed fractions of grass and NONE does not spread', () => {
    const w = s(32, 25, 30, 225)
    const g = flatRosKmh(FUEL.GRASS, w, DEFAULT_FIRE_PARAMS)
    expect(g).toBeGreaterThan(0)
    expect(flatRosKmh(FUEL.CROP, w, DEFAULT_FIRE_PARAMS)).toBeCloseTo(0.6 * g)
    expect(flatRosKmh(FUEL.URBAN_LOW, w, DEFAULT_FIRE_PARAMS)).toBeCloseTo(0.25 * g)
    expect(flatRosKmh(FUEL.URBAN_DENSE, w, DEFAULT_FIRE_PARAMS)).toBeCloseTo(0.05 * g)
    expect(flatRosKmh(FUEL.NONE, w, DEFAULT_FIRE_PARAMS)).toBe(0)
    expect(flatRosKmh(FUEL.FOREST, w, { ...DEFAULT_FIRE_PARAMS, rosMultiplier: 2 })).toBeCloseTo(2 * flatRosKmh(FUEL.FOREST, w, DEFAULT_FIRE_PARAMS))
    // Shrub is the forest meter with 12 t/ha instead of 20.
    expect(flatRosKmh(FUEL.SHRUB, w, DEFAULT_FIRE_PARAMS) / flatRosKmh(FUEL.FOREST, w, DEFAULT_FIRE_PARAMS)).toBeCloseTo(12 / 20)
  })

  it('slope factor doubles per ~10 degrees when wind and slope are aligned', () => {
    const us = (0.069 / 0.0234) * 10
    expect(slopeFactor(20 + us, 20)).toBeCloseTo(Math.exp(0.69), 6)
    expect(slopeFactor(20, 20)).toBe(1)
  })
})

describe('fire shape', () => {
  it('length-to-breadth is 1 in calm air and grows with wind towards ~9.7', () => {
    expect(lengthToBreadth(0)).toBe(1)
    expect(lengthToBreadth(20)).toBeGreaterThan(lengthToBreadth(10))
    expect(lengthToBreadth(1000)).toBeCloseTo(9.729, 2)
    expect(eccentricity(1)).toBe(0)
  })

  it('ROS is the head value at phi = 0 and the backing value at phi = 180', () => {
    const e = eccentricity(lengthToBreadth(30))
    expect(rosAtAngle(10, e, 1)).toBeCloseTo(10)
    expect(rosAtAngle(10, e, -1)).toBeCloseTo((10 * (1 - e)) / (1 + e))
  })
})
