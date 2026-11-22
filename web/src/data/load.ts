// Loads and validates the baked data files in web/public/data/ (formats in src/engine/types.ts).
// Every malformed file throws a DataError naming the file; the UI shows it. No silent fallbacks: the synthetic
// dataset is used only when grid.json is absent altogether (data not baked yet), and the UI says so.
import type { FirmsPoint, GridMeta, IgnitionPreset, NationalPopulation, NationalPopulationMeta, RoadsFile, WeatherFile } from '../engine/types'
import { FUEL, ROAD } from '../engine/types'
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
  /** Residents per cell (population_home.bin) and people per cell when everyone is at work or school
   *  (population_work.bin); src/engine/population combines them by time of day. */
  populationHome: Float32Array
  populationWork: Float32Array
  /** true when this is the in-browser synthetic dataset (src/data/mock.ts). */
  synthetic: boolean
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

export function parseWeather(j: unknown): WeatherFile {
  const f = 'weather.json'
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

export function parseFirms(j: unknown): FirmsPoint[] {
  const f = 'firms.json'
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

// ---------------------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------------------

/** URL of a data file (read lazily so this module also imports under Node for tests and scripts). */
const dataUrl = (file: string) => `${import.meta.env.BASE_URL}data/${file}`

/** Dev servers answer unknown paths with index.html (status 200), so an HTML answer also means "missing". */
function isMissing(res: Response): boolean {
  return res.status === 404 || (res.headers.get('content-type') ?? '').includes('text/html')
}

async function fetchOk(file: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(dataUrl(file))
  } catch (e) {
    throw new DataError(file, `no se pudo descargar (${(e as Error).message})`)
  }
  if (isMissing(res)) throw new DataError(file, 'no existe en /data/')
  if (!res.ok) throw new DataError(file, `HTTP ${res.status}`)
  return res
}

async function fetchJson(file: string): Promise<unknown> {
  const res = await fetchOk(file)
  try {
    return await res.json()
  } catch (e) {
    throw new DataError(file, `JSON inválido (${(e as Error).message})`)
  }
}

async function fetchBin(file: string): Promise<ArrayBuffer> {
  return (await fetchOk(file)).arrayBuffer()
}

/** Returns null when the real data has not been baked yet (no grid.json). Throws DataError otherwise. */
export async function loadRealDataset(): Promise<Dataset | null> {
  let probe: Response
  try {
    probe = await fetch(dataUrl('grid.json'))
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
  const [elev, fuel, scar, bld, roads, weather, ignitions, firms, popHome, popWork] = await Promise.all([
    fetchBin('elevation.bin'),
    fetchBin('fuel.bin'),
    fetchBin('scar.bin'),
    fetchBin('buildings.bin'),
    fetchJson('roads.json'),
    fetchJson('weather.json'),
    fetchJson('ignitions.json'),
    fetchJson('firms.json'),
    fetchBin('population_home.bin'),
    fetchBin('population_work.bin'),
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
    populationHome: parsePopulationLayer('population_home.bin', popHome, cells),
    populationWork: parsePopulationLayer('population_work.bin', popWork, cells),
    synthetic: false,
  }
}

/** The national population product (all of Chile, ~0.9 km), for scenarios outside the baked grid. Not loaded
 *  by the explorer today: 4 MB that the Viña del Mar grid does not need. */
export async function loadNationalPopulation(): Promise<NationalPopulation> {
  const [meta, bin] = await Promise.all([fetchJson('national/population_cl.json'), fetchBin('national/population_cl.bin')])
  return parseNationalPopulation(meta, bin)
}
