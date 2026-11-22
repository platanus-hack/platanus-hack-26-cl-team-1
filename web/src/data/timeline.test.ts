import { describe, expect, it } from 'vitest'
import { TIMELINE } from '../engine/types'
import { ERA5_WIND_DIR_CORRECTION_DEG } from '../engine/fire/model'
import { addDays, forecastUrl, offsetLabel, parseForecast, santiagoDate, TALCA_FORECAST_POINT, VINA_FORECAST_POINT, type Forecast } from './forecast'
import { makeMockDataset } from './mock'
import { isTimelineId, isTodayTimeline, timelineDataset, todayDataset } from './timeline'
import { localToMin, minToDateLabel, minToHHMM } from './time'
import { awayShare, dayKind } from '../engine/population'

/** An Open-Meteo forecast response (the shape api.open-meteo.com/v1/forecast returns) for `date` and the next day. */
function openMeteo(date: string, patch: Record<string, unknown> = {}) {
  const time: string[] = []
  for (const d of [date, addDays(date, 1)]) for (let h = 0; h < 24; h++) time.push(`${d}T${String(h).padStart(2, '0')}:00`)
  const n = time.length
  return {
    latitude: -33.14587,
    longitude: -71.51291,
    utc_offset_seconds: -10800,
    timezone: 'America/Santiago',
    hourly_units: {
      time: 'iso8601',
      temperature_2m: '°C',
      relative_humidity_2m: '%',
      wind_speed_10m: 'km/h',
      wind_direction_10m: '°',
      wind_gusts_10m: 'km/h',
    },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 15 + (i % 24) / 2),
      relative_humidity_2m: time.map(() => 50),
      wind_speed_10m: time.map(() => 18),
      wind_direction_10m: time.map(() => 210),
      wind_gusts_10m: Array.from({ length: n }, () => 30),
    },
    ...patch,
  }
}

describe('forecast', () => {
  it('takes the calendar date in Santiago, not in UTC', () => {
    // 02:30 in Santiago (UTC-3) is already 05:30 UTC of the same day; 22:00 in Santiago is 01:00 UTC the next day.
    expect(santiagoDate(new Date('2026-11-22T05:30:00Z'))).toBe('2026-11-22')
    expect(santiagoDate(new Date('2026-11-23T01:00:00Z'))).toBe('2026-11-22')
    // Winter: UTC-4
    expect(santiagoDate(new Date('2026-07-01T03:30:00Z'))).toBe('2026-06-30')
  })

  it('adds days across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(() => addDays('22/11/2026', 1)).toThrow(/inválida/)
  })

  it('formats UTC offsets', () => {
    expect(offsetLabel(-10800)).toBe('-03:00')
    expect(offsetLabel(-14400)).toBe('-04:00')
    expect(offsetLabel(19800)).toBe('+05:30')
  })

  it('asks for the same point and variables as the baked weather.json, today and tomorrow', () => {
    const u = new URL(forecastUrl('2026-11-22', VINA_FORECAST_POINT))
    expect(u.host).toBe('api.open-meteo.com')
    expect(u.searchParams.get('latitude')).toBe('-33.10')
    expect(u.searchParams.get('longitude')).toBe('-71.49')
    expect(u.searchParams.get('start_date')).toBe('2026-11-22')
    expect(u.searchParams.get('end_date')).toBe('2026-11-23')
    expect(u.searchParams.get('timezone')).toBe('America/Santiago')
    expect(u.searchParams.get('hourly')?.split(',')).toEqual([
      'temperature_2m',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'wind_gusts_10m',
    ])
  })

  it('asks for Talca at the point of its baked weather.json', () => {
    const u = new URL(forecastUrl('2026-11-22', TALCA_FORECAST_POINT))
    expect(u.searchParams.get('latitude')).toBe('-35.43')
    expect(u.searchParams.get('longitude')).toBe('-71.66')
  })

  it('parses a response into a WeatherFile', () => {
    const f = parseForecast(openMeteo('2026-11-22'), '2026-11-22', '22 nov 2026, 02:30', VINA_FORECAST_POINT)
    expect(f.utcOffset).toBe('-03:00')
    expect(f.weather.times).toHaveLength(48)
    expect(f.weather.times[12]).toBe('2026-11-22T12:00')
    expect(f.weather.windKmh[12]).toBe(18)
    expect(f.weather.windFromDeg[12]).toBe(210)
    expect(f.weather.source).toContain('Open-Meteo Forecast API')
    expect(f.weather.source).toContain('22 nov 2026, 02:30')
  })

  it('refuses other units, missing hours, short series and service errors', () => {
    const date = '2026-11-22'
    const r = openMeteo(date)
    expect(() => parseForecast({ ...r, hourly_units: { ...r.hourly_units, wind_speed_10m: 'm/s' } }, date, 'x', VINA_FORECAST_POINT)).toThrow(/unidad/)
    const gap = { ...r.hourly, wind_speed_10m: r.hourly.wind_speed_10m.map((v, i) => (i === 15 ? null : v)) }
    expect(() => parseForecast({ ...r, hourly: gap }, date, 'x', VINA_FORECAST_POINT)).toThrow(/2026-11-22T15:00/)
    const short = Object.fromEntries(Object.entries(r.hourly).map(([k, v]) => [k, v.slice(0, 30)]))
    expect(() => parseForecast({ ...r, hourly: short }, date, 'x', VINA_FORECAST_POINT)).toThrow(/cubre/)
    expect(() => parseForecast(r, '2026-11-21', 'x', VINA_FORECAST_POINT)).toThrow(/cubre/)
    expect(() => parseForecast({ error: true, reason: 'Parameter x is invalid' }, date, 'x', VINA_FORECAST_POINT)).toThrow(/Parameter x/)
    expect(() => parseForecast({ ...r, utc_offset_seconds: undefined }, date, 'x', VINA_FORECAST_POINT)).toThrow(/utc_offset/)
  })
})

describe('timelines', () => {
  const base = makeMockDataset()
  const forecast: Forecast = parseForecast(openMeteo('2026-11-22'), '2026-11-22', 'x', VINA_FORECAST_POINT)

  it('the baked files are the 2024 timeline, with the ERA5 correction and its validated 12:00-24:00 window', () => {
    expect(base.timeline).toBe(TIMELINE.VINA_2024)
    expect(base.windDirCorrectionDeg).toBe(ERA5_WIND_DIR_CORRECTION_DEG)
    expect(base.horizonMin).toBe(12 * 60)
    expect(minToHHMM(base.grid.t0, base.defaultAlertMin)).toBe('18:00')
    expect(timelineDataset(base, { id: TIMELINE.VINA_2024 })).toBe(base)
  })

  it("today in Talca shows Talca's territory with the forecast and no ignitions", () => {
    const talca = { ...base, timeline: TIMELINE.TALCA }
    expect(() => timelineDataset(base, { id: TIMELINE.TODAY_TALCA, forecast })).toThrow(/talca/)
    const d = timelineDataset(talca, { id: TIMELINE.TODAY_TALCA, forecast })
    expect(d.timeline).toBe(TIMELINE.TODAY_TALCA)
    expect(isTodayTimeline(d.timeline)).toBe(true)
    expect(d.grid.t0).toBe('2026-11-22T00:00:00-03:00')
    expect(d.horizonMin).toBe(24 * 60)
    expect(d.weather).toBe(forecast.weather)
    expect(d.windDirCorrectionDeg).toBe(0)
    expect(d.ignitions).toEqual([])
    expect(d.firms).toEqual([])
    expect(d.fuel).toBe(base.fuel)
    expect(isTimelineId('hoy-talca')).toBe(true)
  })

  it('today covers 00:00-24:00, with the forecast and the 2024 ignition points at the same time of day', () => {
    const d = timelineDataset(base, { id: TIMELINE.TODAY, forecast })
    expect(d.timeline).toBe(TIMELINE.TODAY)
    expect(d.grid.t0).toBe('2026-11-22T00:00:00-03:00')
    expect(d.horizonMin).toBe(24 * 60)
    expect(d.defaultAlertMin).toBe(18 * 60)
    // the forecast covers the whole window
    expect(localToMin(d.grid.t0, d.weather.times[d.weather.times.length - 1])).toBeGreaterThanOrEqual(d.horizonMin)
    expect(d.weather).toBe(forecast.weather)
    expect(d.windDirCorrectionDeg).toBe(0)
    expect(d.firms).toEqual([])
    // same territory
    expect(d.fuel).toBe(base.fuel)
    expect(d.buildings).toBe(base.buildings)
    expect(d.grid.rows).toBe(base.grid.rows)
    // same points, same time of day
    expect(d.ignitions.map((g) => [g.id, g.lon, g.lat])).toEqual(base.ignitions.map((g) => [g.id, g.lon, g.lat]))
    for (let k = 0; k < d.ignitions.length; k++) {
      expect(d.ignitions[k].timeLocal.slice(0, 10)).toBe('2026-11-22')
      expect(d.ignitions[k].timeLocal.slice(11, 16)).toBe(base.ignitions[k].timeLocal.slice(11, 16))
    }
    // the mock ignitions (14:20, 15:10) are 14 h 20 min and 15 h 10 min into today's window
    expect(d.ignitions.map((g) => localToMin(d.grid.t0, g.timeLocal))).toEqual([14 * 60 + 20, 15 * 60 + 10])
    expect(minToDateLabel(d.grid.t0, 0)).toBe('22 nov 2026')
  })

  it('today keeps the 2024 fire companies, with dispatch, reinforcement and cut times at the same time of day', () => {
    const b = base.brigades
    if (!b) throw new Error('the synthetic dataset ships brigades')
    const withCut = {
      ...base,
      brigades: { ...b, cuts: [{ id: 'c', label: 'Ruta', lines: [], fromLocal: '2024-02-02T17:00', toLocal: '2024-02-03T01:00', source: 's' }] },
    }
    const today = todayDataset(withCut, forecast)
    const hhmm = (x: string) => x.slice(11, 16)
    const d = { brigades: today.brigades! }
    expect(d.brigades.stations).toBe(b.stations)
    expect(d.brigades.dispatch.map((x) => hhmm(x.dispatchLocal))).toEqual(b.dispatch.map((x) => hhmm(x.dispatchLocal)))
    expect(d.brigades.reinforcements.map((x) => x.arrivalLocal)).toEqual(b.reinforcements.map((x) => `2026-11-22T${hhmm(x.arrivalLocal)}`))
    expect(d.brigades.cuts[0].fromLocal).toBe('2026-11-22T17:00')
    expect(d.brigades.cuts[0].toLocal).toBe('2026-11-23T01:00')
    expect(d.brigades.cuts[0].label).toContain('2 feb 2024')
    for (const x of d.brigades.dispatch) expect(x.dispatchLocal.slice(0, 10)).toBe('2026-11-22')
  })

  it('refuses to derive a timeline from a derived dataset', () => {
    const d = todayDataset(base, forecast)
    expect(() => timelineDataset(d, { id: TIMELINE.VINA_2024 })).toThrow(/2024/)
  })

  it('recognises the URL values', () => {
    expect(isTimelineId('hoy')).toBe(true)
    expect(isTimelineId('vina-2024')).toBe(true)
    expect(isTimelineId('manana')).toBe(false)
    expect(isTimelineId(null)).toBe(false)
  })
})

describe('presence on the timeline date', () => {
  it('2 Feb 2024 was a Friday without classes; 22 Nov 2026 is a Sunday', () => {
    const feb = dayKind(localToMin('1970-01-01T00:00', '2024-02-02T15:00'))
    expect(feb).toEqual({ dow: 5, weekday: true, school: false })
    const nov = localToMin('1970-01-01T00:00', '2026-11-22T15:00')
    expect(dayKind(nov)).toEqual({ dow: 0, weekday: false, school: false })
    expect(awayShare(nov)).toBe(0)
    // a Monday in term
    expect(dayKind(localToMin('1970-01-01T00:00', '2026-11-23T15:00'))).toEqual({ dow: 1, weekday: true, school: true })
  })
})
