// Today's hourly weather forecast for the "today" timeline (TIMELINE.TODAY in types.ts), fetched in the browser
// from the Open-Meteo Forecast API at the same point and with the same variables as the baked weather.json
// (pipeline/steps/weather.py). Validated like weather.json; any problem throws a DataError the UI shows.
import type { WeatherFile } from '../engine/types'
import { DataError, parseWeather } from './load'

/** Where a forecast is asked for: the same point the territory's weather.json was requested at (weather_lat /
 *  weather_lon of its event in pipeline/steps/events.py; Open-Meteo snaps it to its model grid). */
export interface ForecastPoint {
  lat: number
  lon: number
}
/** Viña del Mar, Quilpué and Villa Alemana (VINA_2024 in pipeline/steps/events.py). */
export const VINA_FORECAST_POINT: ForecastPoint = { lat: -33.1, lon: -71.49 }
/** Talca (TALCA in pipeline/steps/events.py). */
export const TALCA_FORECAST_POINT: ForecastPoint = { lat: -35.43, lon: -71.66 }
export const FORECAST_TZ = 'America/Santiago'
const FILE = 'pronóstico de Open-Meteo'
/** A forecast that has not answered by then is reported as an error (with "Reintentar"), not left loading. */
export const FORECAST_TIMEOUT_MS = 30_000

const FIELDS = {
  tempC: 'temperature_2m',
  rh: 'relative_humidity_2m',
  windKmh: 'wind_speed_10m',
  windFromDeg: 'wind_direction_10m',
  gustKmh: 'wind_gusts_10m',
} as const

const UNITS: Record<string, string> = {
  temperature_2m: '°C',
  relative_humidity_2m: '%',
  wind_speed_10m: 'km/h',
  wind_direction_10m: '°',
  wind_gusts_10m: 'km/h',
}

export interface Forecast {
  /** Local date the forecast was requested for, "YYYY-MM-DD" (America/Santiago). */
  date: string
  /** UTC offset of that date in America/Santiago, "-03:00". */
  utcOffset: string
  /** Hourly series from date 00:00 to the next day 23:00, local time. */
  weather: WeatherFile
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Local calendar date in America/Santiago at `now`, "YYYY-MM-DD". */
export function santiagoDate(now: Date): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: FORECAST_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** "YYYY-MM-DD" plus n calendar days. */
export function addDays(date: string, n: number): string {
  if (!DATE_RE.test(date)) throw new Error(`Fecha inválida: "${date}" (se esperaba AAAA-MM-DD)`)
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

/** "-03:00" for an offset in seconds (Open-Meteo's utc_offset_seconds). */
export function offsetLabel(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+'
  const a = Math.abs(seconds) / 60
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

export function forecastUrl(date: string, point: ForecastPoint): string {
  const q = new URLSearchParams({
    latitude: point.lat.toFixed(2),
    longitude: point.lon.toFixed(2),
    hourly: Object.values(FIELDS).join(','),
    timezone: FORECAST_TZ,
    start_date: date,
    end_date: addDays(date, 1),
  })
  return `https://api.open-meteo.com/v1/forecast?${q}`
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Turns an Open-Meteo forecast response into a WeatherFile (checked by parseWeather) and the date's UTC
 *  offset. Refuses other units, missing hours (null values) and a series that does not cover `date` 00:00 to
 *  the next day 23:00. `fetchedAt` goes into the source line. */
export function parseForecast(j: unknown, date: string, fetchedAt: string, point: ForecastPoint): Forecast {
  if (!isObj(j)) throw new DataError(FILE, 'no es un objeto JSON')
  if (typeof j.error === 'boolean' && j.error) throw new DataError(FILE, `el servicio respondió con un error: ${String(j.reason)}`)
  const { hourly, hourly_units: units, utc_offset_seconds: offset, latitude, longitude } = j
  if (!isObj(hourly) || !isObj(units)) throw new DataError(FILE, 'faltan "hourly" o "hourly_units"')
  if (typeof offset !== 'number' || !Number.isInteger(offset)) throw new DataError(FILE, 'falta "utc_offset_seconds"')
  for (const [field, unit] of Object.entries(UNITS))
    if (units[field] !== unit) throw new DataError(FILE, `unidad inesperada para ${field}: ${String(units[field])} (se esperaba ${unit})`)
  const times = hourly.time
  if (!Array.isArray(times)) throw new DataError(FILE, 'falta "hourly.time"')
  const out: Obj = {
    source:
      `Open-Meteo Forecast API (pronóstico, combinación de modelos "best match"), punto ${point.lat.toFixed(2)}, ` +
      `${point.lon.toFixed(2)}, horario local ${FORECAST_TZ}, consultado ${fetchedAt}. https://open-meteo.com/ (CC BY 4.0)`,
    lat: latitude,
    lon: longitude,
    times,
  }
  for (const [key, field] of Object.entries(FIELDS)) {
    const v = hourly[field]
    if (!Array.isArray(v)) throw new DataError(FILE, `falta "${field}"`)
    const missing = v.findIndex((x) => x === null)
    if (missing >= 0) throw new DataError(FILE, `${field} no tiene valor a las ${String(times[missing])}`)
    out[key] = v
  }
  const weather = parseWeather(out, FILE)
  const first = `${date}T00:00`
  const last = `${addDays(date, 1)}T23:00`
  if (weather.times[0] !== first || weather.times[weather.times.length - 1] !== last)
    throw new DataError(FILE, `cubre de ${weather.times[0]} a ${weather.times[weather.times.length - 1]}; se esperaba de ${first} a ${last}`)
  return { date, utcOffset: offsetLabel(offset), weather }
}

/** Fetches today's forecast (America/Santiago date at `now`) at `point`. Throws DataError on any failure. */
export async function fetchForecast(point: ForecastPoint, now: Date = new Date()): Promise<Forecast> {
  const date = santiagoDate(now)
  let res: Response
  try {
    res = await fetch(forecastUrl(date, point), { signal: AbortSignal.timeout(FORECAST_TIMEOUT_MS) })
  } catch (e) {
    const why = (e as Error).name === 'TimeoutError' ? `no respondió en ${FORECAST_TIMEOUT_MS / 1000} s` : (e as Error).message
    throw new DataError(FILE, `no se pudo descargar (${why}); el escenario desde hoy necesita conexión a internet`)
  }
  if (!res.ok) throw new DataError(FILE, `HTTP ${res.status}`)
  let j: unknown
  try {
    j = await res.json()
  } catch (e) {
    throw new DataError(FILE, `JSON inválido (${(e as Error).message})`)
  }
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: FORECAST_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now)
  return parseForecast(j, date, `el ${date} a las ${hhmm}`, point)
}
