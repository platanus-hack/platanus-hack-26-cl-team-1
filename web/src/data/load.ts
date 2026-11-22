// Loads and validates the baked data files in web/public/data/ (formats in src/engine/types.ts).
// Every malformed file throws a DataError naming the file; the UI shows it. No silent fallbacks: the synthetic
// dataset is used only when grid.json is absent altogether (data not baked yet), and the UI says so.
import type {
  BrigadesFile,
  BrigadeStation,
  FirmsPoint,
  GridMeta,
  IgnitionPreset,
  NationalPopulation,
  NationalPopulationMeta,
  NationalStation,
  NationalStationsFile,
  NationalVehicle,
  Reinforcement,
  RoadsFile,
  RouteCut,
  TimelineId,
  VehicleKind,
  WeatherFile,
} from '../engine/types'
import { COMPANY_SPECIALTY, FUEL, ROAD, SETTLEMENT, STATION_KIND, UNIT_COUNT, VEHICLE_KIND, VEHICLE_KIND_UNIT } from '../engine/types'
import type { EventDef } from './events'
import { lonLatToColRow } from './grid'
import { wallClockMin } from './time'

export interface Dataset {
  grid: GridMeta
  elevation: Float32Array
  fuel: Uint8Array
  scar: Uint8Array
  buildings: Float32Array
  roads: RoadsFile
  weather: WeatherFile
  ignitions: IgnitionPreset[]
  firms: FirmsPoint[]
  /** The baked event (territory) these files belong to (src/data/events.ts). */
  event: EventDef
  /** null when the event does not ship brigades.json (EventDef.layers); the UI says so. */
  brigades: BrigadesFile | null
  /** Residents per cell (population_home.bin) and people per cell when everyone is at work or school
   *  (population_work.bin); src/engine/population combines them by time of day. null when the event does not
   *  ship them (EventDef.layers); the UI says so. */
  population: { home: Float32Array; work: Float32Array } | null
  /** true when this is the in-browser synthetic dataset (src/data/mock.ts). */
  synthetic: boolean
  /** The timeline grid.t0, weather, ignitions and firms belong to: the baked event's own (2 Feb 2024 fire, Eaton
   *  fire), or the "today" view of Viña's territory that src/data/timeline.ts derives. */
  timeline: TimelineId
  /** Calibrated wind-direction correction (degrees) the weather series gets: ERA5_WIND_DIR_CORRECTION_DEG for
   *  the ERA5 reanalysis of 2 Feb 2024, 0 for a forecast (it was fitted on that day's ERA5 only). */
  windDirCorrectionDeg: number
  /** How long this timeline runs (minutes after grid.t0): the 2024 replay keeps its validated window (12:00 to
   *  midnight, DEFAULT_FIRE_PARAMS.horizonMin); the today timeline covers the whole day (24 h). */
  horizonMin: number
  /** Default alert time (minutes after grid.t0): EventDef.evac.alertMin (Viña 18:00, also in the today timeline;
   *  Eaton 19:25). */
  defaultAlertMin: number
}

export class DataError extends Error {
  constructor(
    public file: string,
    message: string,
  ) {
    super(`${file}: ${message}`)
    this.name = 'DataError'
  }
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function num(file: string, o: Obj, k: string): number {
  const v = o[k]
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DataError(file, `"${k}" debe ser un número finito`)
  return v
}
function str(file: string, o: Obj, k: string): string {
  const v = o[k]
  if (typeof v !== 'string' || v.length === 0) throw new DataError(file, `"${k}" debe ser un texto no vacío`)
  return v
}
function numArray(file: string, o: Obj, k: string, len?: number): number[] {
  const v = o[k]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'number' && Number.isFinite(x)))
    throw new DataError(file, `"${k}" debe ser una lista de números finitos`)
  if (len !== undefined && v.length !== len)
    throw new DataError(file, `"${k}" tiene ${v.length} valores, se esperaban ${len}`)
  return v as number[]
}
function checkTime(file: string, iso: string) {
  try {
    wallClockMin(iso)
  } catch (e) {
    throw new DataError(file, (e as Error).message)
  }
}

export function parseGrid(j: unknown): GridMeta {
  const f = 'grid.json'
  if (!isObj(j)) throw new DataError(f, 'no es un objeto JSON')
  const g: GridMeta = {
    rows: num(f, j, 'rows'),
    cols: num(f, j, 'cols'),
    latMax: num(f, j, 'latMax'),
    lonMin: num(f, j, 'lonMin'),
    dLat: num(f, j, 'dLat'),
    dLon: num(f, j, 'dLon'),
    cellM: num(f, j, 'cellM'),
    t0: str(f, j, 't0'),
    sources: {},
  }
  if (!Number.isInteger(g.rows) || !Number.isInteger(g.cols) || g.rows <= 0 || g.cols <= 0)
    throw new DataError(f, `rows/cols deben ser enteros positivos (rows=${g.rows}, cols=${g.cols})`)
  if (g.dLat <= 0 || g.dLon <= 0 || g.cellM <= 0) throw new DataError(f, 'dLat, dLon y cellM deben ser > 0')
  checkTime(f, g.t0)
  const s = j.sources
  if (!isObj(s) || !Object.values(s).every((v) => typeof v === 'string'))
    throw new DataError(f, '"sources" debe ser un objeto { nombre: cita }')
  g.sources = s as Record<string, string>
  return g
}

export function checkBinary(file: string, buf: ArrayBuffer, expectedBytes: number): void {
  if (buf.byteLength !== expectedBytes)
    throw new DataError(file, `tiene ${buf.byteLength} bytes, se esperaban ${expectedBytes} (filas × columnas de grid.json)`)
}

export function parseFuel(buf: ArrayBuffer, cells: number): Uint8Array {
  checkBinary('fuel.bin', buf, cells)
  const a = new Uint8Array(buf)
  const valid = new Set<number>(Object.values(FUEL))
  for (let i = 0; i < a.length; i++)
    if (!valid.has(a[i])) throw new DataError('fuel.bin', `código de combustible desconocido ${a[i]} en la celda ${i}`)
  return a
}

export function parseScar(buf: ArrayBuffer, cells: number): Uint8Array {
  checkBinary('scar.bin', buf, cells)
  const a = new Uint8Array(buf)
  for (let i = 0; i < a.length; i++)
    if (a[i] !== 0 && a[i] !== 1 && a[i] !== 255) throw new DataError('scar.bin', `valor ${a[i]} en la celda ${i} (válidos: 0, 1, 255)`)
  return a
}

export function parseElevation(buf: ArrayBuffer, cells: number): Float32Array {
  checkBinary('elevation.bin', buf, cells * 4)
  const a = new Float32Array(buf)
  for (let i = 0; i < a.length; i++)
    if (!Number.isFinite(a[i])) throw new DataError('elevation.bin', `valor no finito en la celda ${i}`)
  return a
}

/** population_home.bin / population_work.bin: Float32 persons per cell, finite and >= 0. */
export function parsePopulationLayer(file: string, buf: ArrayBuffer, cells: number): Float32Array {
  checkBinary(file, buf, cells * 4)
  const a = new Float32Array(buf)
  for (let i = 0; i < a.length; i++)
    if (!(a[i] >= 0 && Number.isFinite(a[i]))) throw new DataError(file, `valor ${a[i]} en la celda ${i} (se esperan personas >= 0)`)
  return a
}

/** national/population_cl.json + .bin (layout in NationalPopulationMeta). Checks sizes, ascending in-range
 *  cells, non-negative values, and that the stored totals match the data (home and work within 0.1 %). */
export function parseNationalPopulation(metaJson: unknown, buf: ArrayBuffer): NationalPopulation {
  const f = 'national/population_cl.json'
  const fb = 'national/population_cl.bin'
  if (!isObj(metaJson)) throw new DataError(f, 'no es un objeto JSON')
  const j = metaJson
  if (j.version !== 1) throw new DataError(f, `versión ${String(j.version)} desconocida (se espera 1)`)
  const commute = j.commute
  const totals = j.totals
  if (!isObj(commute) || !isObj(totals)) throw new DataError(f, 'faltan "commute" o "totals"')
  const meta: NationalPopulationMeta = {
    version: 1,
    lonMin: num(f, j, 'lonMin'),
    latMax: num(f, j, 'latMax'),
    dLon: num(f, j, 'dLon'),
    dLat: num(f, j, 'dLat'),
    rows: num(f, j, 'rows'),
    cols: num(f, j, 'cols'),
    n: num(f, j, 'n'),
    layout: str(f, j, 'layout'),
    commute: { scaleM: num(f, commute, 'scaleM'), maxM: num(f, commute, 'maxM') },
    totals: {
      home: num(f, totals, 'home'),
      work: num(f, totals, 'work'),
      stayHome: num(f, totals, 'stayHome'),
      nonResidentialMillionM3: num(f, totals, 'nonResidentialMillionM3'),
    },
    source: str(f, j, 'source'),
  }
  const { n, rows, cols } = meta
  if (![n, rows, cols].every((v) => Number.isInteger(v) && v > 0)) throw new DataError(f, 'n, rows y cols deben ser enteros positivos')
  checkBinary(fb, buf, n * 16)
  const cell = new Uint32Array(buf, 0, n)
  const home = new Float32Array(buf, 4 * n, n)
  const work = new Float32Array(buf, 8 * n, n)
  const nonResidentialM3 = new Float32Array(buf, 12 * n, n)
  let sumHome = 0
  let sumWork = 0
  for (let i = 0; i < n; i++) {
    if (cell[i] >= rows * cols || (i > 0 && cell[i] <= cell[i - 1])) throw new DataError(fb, `celda ${cell[i]} (posición ${i}) fuera de rango o no creciente`)
    for (const [name, a] of [
      ['home', home],
      ['work', work],
      ['nonResidentialM3', nonResidentialM3],
    ] as const)
      if (!(a[i] >= 0 && Number.isFinite(a[i]))) throw new DataError(fb, `${name} inválido (${a[i]}) en la posición ${i}`)
    sumHome += home[i]
    sumWork += work[i]
  }
  for (const [name, got, want] of [
    ['home', sumHome, meta.totals.home],
    ['work', sumWork, meta.totals.work],
  ] as const)
    if (Math.abs(got - want) > 1e-3 * want) throw new DataError(fb, `la suma de ${name} (${Math.round(got)}) no coincide con totals.${name} (${want})`)
  return { meta, cell, home, work, nonResidentialM3 }
}

export function parseBuildings(buf: ArrayBuffer): Float32Array {
  if (buf.byteLength % 12 !== 0) throw new DataError('buildings.bin', `${buf.byteLength} bytes no es múltiplo de 12 (lon, lat, área)`)
  return new Float32Array(buf)
}

export function parseRoads(j: unknown): RoadsFile {
  const f = 'roads.json'
  if (!isObj(j) || !Array.isArray(j.nodes) || !Array.isArray(j.edges)) throw new DataError(f, 'faltan "nodes" o "edges"')
  const nodes = j.nodes as unknown[]
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    if (!Array.isArray(n) || n.length !== 2 || typeof n[0] !== 'number' || typeof n[1] !== 'number')
      throw new DataError(f, `nodo ${i} no es [lon, lat]`)
  }
  const edges = j.edges as unknown[]
  const classes = new Set<number>(Object.values(ROAD))
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]
    if (!Array.isArray(e) || e.length !== 4) throw new DataError(f, `arista ${i} no es [u, v, largoM, clase]`)
    const [u, v, len, cls] = e as number[]
    if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= nodes.length || v >= nodes.length)
      throw new DataError(f, `arista ${i}: nodos fuera de rango (${u}, ${v})`)
    if (typeof len !== 'number' || !(len >= 0)) throw new DataError(f, `arista ${i}: largo inválido ${len}`)
    if (!classes.has(cls)) throw new DataError(f, `arista ${i}: clase de calle desconocida ${cls}`)
  }
  if (j.geoms !== undefined) {
    if (!Array.isArray(j.geoms) || j.geoms.length !== edges.length)
      throw new DataError(f, `"geoms" debe tener una polilínea por arista (${edges.length})`)
  }
  return j as unknown as RoadsFile
}

/** `file` names the source in error messages (the "today" forecast reuses this check). */
export function parseWeather(j: unknown, file = 'weather.json'): WeatherFile {
  const f = file
  if (!isObj(j)) throw new DataError(f, 'no es un objeto JSON')
  const times = j.times
  if (!Array.isArray(times) || times.length < 2 || !times.every((t) => typeof t === 'string'))
    throw new DataError(f, '"times" debe ser una lista de al menos 2 horas locales')
  for (const t of times) checkTime(f, t)
  const n = times.length
  const w: WeatherFile = {
    source: str(f, j, 'source'),
    lat: num(f, j, 'lat'),
    lon: num(f, j, 'lon'),
    times: times as string[],
    tempC: numArray(f, j, 'tempC', n),
    rh: numArray(f, j, 'rh', n),
    windKmh: numArray(f, j, 'windKmh', n),
    windFromDeg: numArray(f, j, 'windFromDeg', n),
    gustKmh: numArray(f, j, 'gustKmh', n),
  }
  const step = wallClockMin(w.times[1]) - wallClockMin(w.times[0])
  if (step <= 0) throw new DataError(f, '"times" debe ser creciente')
  for (let i = 2; i < n; i++)
    if (wallClockMin(w.times[i]) - wallClockMin(w.times[i - 1]) !== step)
      throw new DataError(f, `"times" no tiene paso uniforme (falla en ${w.times[i]})`)
  return w
}

export function parseIgnitions(j: unknown): IgnitionPreset[] {
  const f = 'ignitions.json'
  if (!Array.isArray(j)) throw new DataError(f, 'debe ser una lista')
  return j.map((o, i) => {
    if (!isObj(o)) throw new DataError(f, `elemento ${i} no es un objeto`)
    const p: IgnitionPreset = {
      id: str(f, o, 'id'),
      label: str(f, o, 'label'),
      lon: num(f, o, 'lon'),
      lat: num(f, o, 'lat'),
      timeLocal: str(f, o, 'timeLocal'),
      source: str(f, o, 'source'),
    }
    checkTime(f, p.timeLocal)
    return p
  })
}

/** NASA FIRMS (firms.json) and GOES-16 (goes.json) fire detections share the FirmsPoint shape. */
export function parseFirePoints(f: string, j: unknown): FirmsPoint[] {
  if (!Array.isArray(j)) throw new DataError(f, 'debe ser una lista')
  return j.map((o, i) => {
    if (!isObj(o)) throw new DataError(f, `elemento ${i} no es un objeto`)
    const p: FirmsPoint = {
      lon: num(f, o, 'lon'),
      lat: num(f, o, 'lat'),
      timeLocal: str(f, o, 'timeLocal'),
      satellite: str(f, o, 'satellite'),
      frp: num(f, o, 'frp'),
    }
    checkTime(f, p.timeLocal)
    return p
  })
}

export const parseFirms = (j: unknown): FirmsPoint[] => parseFirePoints('firms.json', j)
/** goes.json is read only by the scoring script (calibrate.ts), not by the browser app. */
export const parseGoes = (j: unknown): FirmsPoint[] => parseFirePoints('goes.json', j)

// ---------------------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------------------

/** URL of a data file (read lazily so this module also imports under Node for tests and scripts). */
const dataUrl = (dir: string, file: string) => `${import.meta.env.BASE_URL}data/${dir}${file}`

/** Dev servers answer unknown paths with index.html (status 200), so an HTML answer also means "missing". */
function isMissing(res: Response): boolean {
  return res.status === 404 || (res.headers.get('content-type') ?? '').includes('text/html')
}

async function fetchOk(file: string, dir = ''): Promise<Response> {
  let res: Response
  try {
    res = await fetch(dataUrl(dir, file))
  } catch (e) {
    throw new DataError(file, `no se pudo descargar (${(e as Error).message})`)
  }
  if (isMissing(res)) throw new DataError(file, `no existe en /data/${dir}`)
  if (!res.ok) throw new DataError(file, `HTTP ${res.status}`)
  return res
}

async function fetchJson(file: string, dir = ''): Promise<unknown> {
  const res = await fetchOk(file, dir)
  try {
    return await res.json()
  } catch (e) {
    throw new DataError(file, `JSON inválido (${(e as Error).message})`)
  }
}

async function fetchBin(file: string, dir = ''): Promise<ArrayBuffer> {
  return (await fetchOk(file, dir)).arrayBuffer()
}

/** Returns null when the real data has not been baked yet (no grid.json). Throws DataError otherwise. */
function insideGrid(file: string, g: GridMeta, lon: number, lat: number, what: string) {
  const [c, r] = lonLatToColRow(g, lon, lat)
  if (!(c >= 0 && c < g.cols && r >= 0 && r < g.rows)) throw new DataError(file, `${what} (${lon}, ${lat}) queda fuera de la grilla`)
}
function nullableStr(file: string, o: Obj, k: string): string | null {
  if (o[k] === null) return null
  return str(file, o, k)
}
function units(file: string, o: Obj, what: string): number[] {
  const u = o.units
  if (!Array.isArray(u) || u.length !== UNIT_COUNT || !u.every((x) => Number.isInteger(x) && x >= 0))
    throw new DataError(file, `${what}: "units" debe ser una lista de ${UNIT_COUNT} enteros >= 0 [Bomba, Forestal, Aljibe, Escala/rescate]`)
  return u as number[]
}
function list(file: string, o: Obj, k: string): Obj[] {
  const v = o[k]
  if (!Array.isArray(v) || !v.every(isObj)) throw new DataError(file, `"${k}" debe ser una lista de objetos`)
  return v as Obj[]
}

/** brigades.json: hand-curated fire companies, dispatch times, reinforcements and historical road cuts. */
export function parseBrigades(j: unknown, g: GridMeta): BrigadesFile {
  const f = 'brigades.json'
  if (!isObj(j)) throw new DataError(f, 'no es un objeto JSON')
  const dispatch = list(f, j, 'dispatch').map((d) => {
    const x = { cuerpo: str(f, d, 'cuerpo'), dispatchLocal: str(f, d, 'dispatchLocal'), source: nullableStr(f, d, 'source') }
    checkTime(f, x.dispatchLocal)
    return x
  })
  const cuerpos = new Set(dispatch.map((d) => d.cuerpo))
  if (cuerpos.size !== dispatch.length) throw new DataError(f, 'un cuerpo aparece dos veces en "dispatch"')
  const ids = new Set<string>()
  const uniqueId = (id: string) => {
    if (ids.has(id)) throw new DataError(f, `id duplicado "${id}"`)
    ids.add(id)
    return id
  }
  const stations: BrigadeStation[] = list(f, j, 'stations').map((s) => {
    const x: BrigadeStation = {
      id: uniqueId(str(f, s, 'id')),
      cuerpo: str(f, s, 'cuerpo'),
      company: str(f, s, 'company'),
      lon: num(f, s, 'lon'),
      lat: num(f, s, 'lat'),
      units: units(f, s, `estación ${String(s.id)}`),
      unitsSource: nullableStr(f, s, 'unitsSource'),
      locationSource: str(f, s, 'locationSource'),
    }
    if (!cuerpos.has(x.cuerpo)) throw new DataError(f, `la estación ${x.id} es del cuerpo "${x.cuerpo}", que no tiene hora de despacho en "dispatch"`)
    insideGrid(f, g, x.lon, x.lat, `la estación ${x.id}`)
    return x
  })
  if (stations.length === 0) throw new DataError(f, 'no tiene estaciones')
  const reinforcements: Reinforcement[] = list(f, j, 'reinforcements').map((r) => {
    const x: Reinforcement = {
      id: uniqueId(str(f, r, 'id')),
      label: str(f, r, 'label'),
      units: units(f, r, `refuerzo ${String(r.id)}`),
      source: nullableStr(f, r, 'source'),
      arrivalLocal: str(f, r, 'arrivalLocal'),
      arrivalSource: nullableStr(f, r, 'arrivalSource'),
      entries: list(f, r, 'entries').map((e) => {
        const y = { label: str(f, e, 'label'), lon: num(f, e, 'lon'), lat: num(f, e, 'lat'), delayMin: num(f, e, 'delayMin'), source: nullableStr(f, e, 'source') }
        if (y.delayMin < 0) throw new DataError(f, `entrada "${y.label}": delayMin < 0`)
        insideGrid(f, g, y.lon, y.lat, `la entrada "${y.label}"`)
        return y
      }),
    }
    checkTime(f, x.arrivalLocal)
    if (x.entries.length === 0) throw new DataError(f, `el refuerzo ${x.id} no tiene entradas`)
    return x
  })
  const cuts: RouteCut[] = list(f, j, 'cuts').map((c) => {
    const lines = c.lines
    if (!Array.isArray(lines) || lines.length === 0 || !lines.every((l) => Array.isArray(l) && l.length >= 2 && l.every((p) => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && Number.isFinite(v)))))
      throw new DataError(f, `corte ${String(c.id)}: "lines" debe ser una lista de polilíneas [lon, lat] de 2 o más puntos`)
    const x: RouteCut = {
      id: uniqueId(str(f, c, 'id')),
      label: str(f, c, 'label'),
      lines: lines as [number, number][][],
      fromLocal: str(f, c, 'fromLocal'),
      toLocal: nullableStr(f, c, 'toLocal'),
      source: str(f, c, 'source'),
    }
    checkTime(f, x.fromLocal)
    if (x.toLocal !== null) checkTime(f, x.toLocal)
    for (const l of x.lines) for (const [lon, lat] of l) insideGrid(f, g, lon, lat, `un punto del corte ${x.id}`)
    return x
  })
  return { stations, dispatch, reinforcements, cuts }
}

/** Chile's mainland + Rapa Nui + Juan Fernández, generous (lon -110..-66, lat -56..-17). */
const CHILE_BOX = { lonMin: -110, lonMax: -66, latMin: -56.5, latMax: -17 }
const VEHICLE_KINDS = new Set<string>(Object.values(VEHICLE_KIND))

function oneOf<T extends string>(file: string, o: Obj, k: string, allowed: readonly T[], what: string): T {
  const v = o[k]
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new DataError(file, `${what}: "${k}" = ${JSON.stringify(v)} no es uno de ${allowed.join(', ')}`)
  return v as T
}
function nullableInt(file: string, o: Obj, k: string, what: string): number | null {
  const v = o[k]
  if (v === null) return null
  if (!Number.isInteger(v)) throw new DataError(file, `${what}: "${k}" debe ser un entero o null`)
  return v as number
}

/** national/bomberos_cl.json: every fire company of Chile with its trucks (pipeline/steps/bomberos.py). Checks
 *  the closed sets, positions inside Chile, unique ids, that units agree with the vehicles and the totals with
 *  the stations. */
export function parseNationalStations(j: unknown): NationalStationsFile {
  const f = 'national/bomberos_cl.json'
  if (!isObj(j)) throw new DataError(f, 'no es un objeto JSON')
  if (j.version !== 1) throw new DataError(f, `versión ${String(j.version)} desconocida (se espera 1)`)
  const totals = j.totals
  if (!isObj(totals)) throw new DataError(f, 'falta "totals"')
  const ids = new Set<string>()
  const stations: NationalStation[] = list(f, j, 'stations').map((s) => {
    const id = str(f, s, 'id')
    if (ids.has(id)) throw new DataError(f, `id duplicado "${id}"`)
    ids.add(id)
    const what = `estación ${id}`
    const vehicles: NationalVehicle[] = list(f, s, 'vehicles').map((v) => {
      if (typeof v.kind !== 'string' || !VEHICLE_KINDS.has(v.kind)) throw new DataError(f, `${what}: tipo de carro ${JSON.stringify(v.kind)} desconocido`)
      return {
        code: nullableStr(f, v, 'code'),
        kind: v.kind as VehicleKind,
        make: nullableStr(f, v, 'make'),
        model: nullableStr(f, v, 'model'),
        year: nullableInt(f, v, 'year', what),
        source: nullableStr(f, v, 'source'),
      }
    })
    if (typeof s.cuerpoInferred !== 'boolean') throw new DataError(f, `${what}: "cuerpoInferred" debe ser true o false`)
    const x: NationalStation = {
      id,
      cuerpo: str(f, s, 'cuerpo'),
      cuerpoInferred: s.cuerpoInferred,
      number: nullableInt(f, s, 'number', what),
      company: str(f, s, 'company'),
      kind: oneOf(f, s, 'kind', STATION_KIND, what),
      specialty: oneOf(f, s, 'specialty', COMPANY_SPECIALTY, what),
      region: str(f, s, 'region'),
      comuna: str(f, s, 'comuna'),
      lon: num(f, s, 'lon'),
      lat: num(f, s, 'lat'),
      settlement: oneOf(f, s, 'settlement', SETTLEMENT, what),
      peopleNearby: num(f, s, 'peopleNearby'),
      locationSource: str(f, s, 'locationSource'),
      vehicles,
      units: units(f, s, what),
      fleetSource: nullableStr(f, s, 'fleetSource'),
      fleetComplete: (() => {
        if (typeof s.fleetComplete !== 'boolean') throw new DataError(f, `${what}: "fleetComplete" debe ser true o false`)
        return s.fleetComplete
      })(),
    }
    if (!(x.lon >= CHILE_BOX.lonMin && x.lon <= CHILE_BOX.lonMax && x.lat >= CHILE_BOX.latMin && x.lat <= CHILE_BOX.latMax))
      throw new DataError(f, `${what} (${x.lon}, ${x.lat}) queda fuera de Chile`)
    const want = unitsOfVehicles(vehicles)
    if (want.some((n, i) => n !== x.units[i])) throw new DataError(f, `${what}: "units" ${JSON.stringify(x.units)} no coincide con sus carros ${JSON.stringify(want)}`)
    if (x.fleetComplete && (x.fleetSource === null || vehicles.some((v) => v.source === null))) throw new DataError(f, `${what}: flota completa con carros sin fuente`)
    if (x.fleetSource === null && vehicles.some((v) => v.source !== null)) throw new DataError(f, `${what}: carros con fuente pero sin "fleetSource"`)
    if (vehicles.length === 0) throw new DataError(f, `${what}: no tiene carros`)
    return x
  })
  if (stations.length === 0) throw new DataError(f, 'no tiene estaciones')
  const sumUnits = new Array<number>(UNIT_COUNT).fill(0)
  for (const s of stations) s.units.forEach((n, i) => (sumUnits[i] += n))
  const out: NationalStationsFile = {
    version: 1,
    baked: str(f, j, 'baked'),
    totals: {
      stations: num(f, totals, 'stations'),
      documentedFleets: num(f, totals, 'documentedFleets'),
      vehicles: num(f, totals, 'vehicles'),
      units: numArray(f, totals, 'units', UNIT_COUNT),
    },
    reference: list(f, j, 'reference').map((r) => ({ label: str(f, r, 'label'), value: num(f, r, 'value'), source: str(f, r, 'source') })),
    estimateMethod: str(f, j, 'estimateMethod'),
    sources: (() => {
      const v = j.sources
      if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string' && x.length > 0)) throw new DataError(f, '"sources" debe ser una lista de textos')
      return v as string[]
    })(),
    stations,
  }
  const t = out.totals
  if (t.stations !== stations.length) throw new DataError(f, `totals.stations (${t.stations}) no coincide con ${stations.length} estaciones`)
  if (t.documentedFleets !== stations.filter((s) => s.fleetSource !== null).length) throw new DataError(f, 'totals.documentedFleets no coincide con las estaciones')
  if (t.vehicles !== stations.reduce((a, s) => a + s.vehicles.length, 0)) throw new DataError(f, 'totals.vehicles no coincide con los carros')
  if (t.units.some((n, i) => n !== sumUnits[i])) throw new DataError(f, `totals.units ${JSON.stringify(t.units)} no coincide con la suma ${JSON.stringify(sumUnits)}`)
  return out
}

/** Count per engine UnitType of a list of vehicles (VEHICLE_KIND_UNIT). */
export function unitsOfVehicles(vehicles: { kind: VehicleKind }[]): number[] {
  const u = new Array<number>(UNIT_COUNT).fill(0)
  for (const v of vehicles) {
    const t = VEHICLE_KIND_UNIT[v.kind]
    if (t !== null) u[t] += 1
  }
  return u
}

/** The national stations inside a lon/lat box, as brigade-engine stations (BrigadeStation). For a scenario
 *  built from scratch: pass the scenario grid's bounds. The cuerpo of each station still needs a dispatch time
 *  in BrigadesFile.dispatch. unitsSource is the fleet's source only when the whole fleet is documented; a fleet
 *  with any estimated truck is "supuesto" (null), as the UI shows it. */
export function stationsInBox(file: NationalStationsFile, box: { lonMin: number; lonMax: number; latMin: number; latMax: number }): BrigadeStation[] {
  if (!(box.lonMin < box.lonMax && box.latMin < box.latMax)) throw new DataError('national/bomberos_cl.json', `caja inválida ${JSON.stringify(box)}`)
  return file.stations
    .filter((s) => s.lon >= box.lonMin && s.lon <= box.lonMax && s.lat >= box.latMin && s.lat <= box.latMax)
    .map((s) => ({
      id: s.id,
      cuerpo: s.cuerpo,
      company: s.company,
      lon: s.lon,
      lat: s.lat,
      units: [...s.units],
      unitsSource: s.fleetComplete ? s.fleetSource : null,
      locationSource: s.locationSource,
    }))
}

/** Loads one baked event's files (its own timeline). Returns null when its data has not been baked yet (no
 *  grid.json); throws DataError otherwise. Optional layers are fetched only when the event ships them. */
export async function loadRealDataset(event: EventDef): Promise<Dataset | null> {
  const dir = event.dir
  let probe: Response
  try {
    probe = await fetch(dataUrl(dir, 'grid.json'))
  } catch (e) {
    throw new DataError('grid.json', `no se pudo descargar (${(e as Error).message})`)
  }
  if (isMissing(probe)) return null
  if (!probe.ok) throw new DataError('grid.json', `HTTP ${probe.status}`)
  let gridJson: unknown
  try {
    gridJson = await probe.json()
  } catch (e) {
    throw new DataError('grid.json', `JSON inválido (${(e as Error).message})`)
  }
  const grid = parseGrid(gridJson)
  const cells = grid.rows * grid.cols
  const [elev, fuel, scar, bld, roads, weather, ignitions, firms, population, brigades] = await Promise.all([
    fetchBin('elevation.bin', dir),
    fetchBin('fuel.bin', dir),
    fetchBin('scar.bin', dir),
    fetchBin('buildings.bin', dir),
    fetchJson('roads.json', dir),
    fetchJson('weather.json', dir),
    fetchJson('ignitions.json', dir),
    fetchJson('firms.json', dir),
    event.layers.population ? Promise.all([fetchBin('population_home.bin', dir), fetchBin('population_work.bin', dir)]) : null,
    event.layers.brigades ? fetchJson('brigades.json', dir) : null,
  ])
  return {
    grid,
    elevation: parseElevation(elev, cells),
    fuel: parseFuel(fuel, cells),
    scar: parseScar(scar, cells),
    buildings: parseBuildings(bld),
    roads: parseRoads(roads),
    weather: parseWeather(weather),
    ignitions: parseIgnitions(ignitions),
    firms: parseFirms(firms),
    event,
    brigades: brigades === null ? null : parseBrigades(brigades, grid),
    population:
      population === null
        ? null
        : { home: parsePopulationLayer('population_home.bin', population[0], cells), work: parsePopulationLayer('population_work.bin', population[1], cells) },
    synthetic: false,
    timeline: event.id,
    windDirCorrectionDeg: event.windDirCorrectionDeg,
    horizonMin: event.horizonMin,
    defaultAlertMin: event.evac.alertMin.value,
  }
}

/** The national population product (all of Chile, ~0.9 km), for scenarios outside the baked grid. Not loaded
 *  by the explorer today: 4 MB that the Viña del Mar grid does not need. */
export async function loadNationalPopulation(): Promise<NationalPopulation> {
  const [meta, bin] = await Promise.all([fetchJson('national/population_cl.json'), fetchBin('national/population_cl.bin')])
  return parseNationalPopulation(meta, bin)
}

/** Every fire company of Chile with its trucks (~1 MB), for scenarios built outside the baked grid. Not loaded by
 *  the explorer today. */
export async function loadNationalStations(): Promise<NationalStationsFile> {
  return parseNationalStations(await fetchJson('national/bomberos_cl.json'))
}
