// Synthetic dataset in the SAME formats as the baked files, used only until web/public/data/ exists (or with
// ?mock=1). The UI shows "Datos de prueba (sintéticos)" whenever it is in use. Nothing here is real data.
import type { BrigadesFile, FirmsPoint, GridMeta, IgnitionPreset, RoadClass, RoadsFile, WeatherFile } from '../engine/types'
import { FUEL, ROAD } from '../engine/types'
import type { Dataset } from './load'

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CELL_M = 60
const LAT_MAX = -33.0
const LAT_MIN = -33.14
const LON_MIN = -71.58
const LON_MAX = -71.36

type Box = [number, number, number, number] // lonW, latS, lonE, latN
const DENSE: Box[] = [
  [-71.556, -33.045, -71.505, -33.005], // "Viña"
  [-71.465, -33.062, -71.425, -33.035], // "Quilpué"
  [-71.395, -33.055, -71.362, -33.035], // "Villa Alemana"
]
function inBox(lon: number, lat: number, b: Box, pad = 0) {
  return lon >= b[0] - pad && lon <= b[2] + pad && lat >= b[1] - pad && lat <= b[3] + pad
}

export function makeMockDataset(): Dataset {
  const rnd = mulberry32(20240202)
  const dLat = CELL_M / 111320
  const dLon = CELL_M / (111320 * Math.cos((33.07 * Math.PI) / 180))
  const rows = Math.round((LAT_MAX - LAT_MIN) / dLat)
  const cols = Math.round((LON_MAX - LON_MIN) / dLon)
  const grid: GridMeta = {
    rows,
    cols,
    latMax: LAT_MAX,
    lonMin: LON_MIN,
    dLat,
    dLon,
    cellM: CELL_M,
    t0: '2024-02-02T12:00:00-03:00',
    sources: { 'Datos de prueba': 'Sintéticos, generados en el navegador (src/data/mock.ts). No representan el territorio real.' },
  }
  const n = rows * cols
  const elevation = new Float32Array(n)
  const fuel = new Uint8Array(n)
  const scar = new Uint8Array(n)
  const isOcean = (lon: number, lat: number) => lon < -71.553 - 0.01 * Math.sin((lat + 33) * 60) && lat > -33.075
  for (let r = 0; r < rows; r++) {
    const lat = LAT_MAX - (r + 0.5) * dLat
    for (let c = 0; c < cols; c++) {
      const lon = LON_MIN + (c + 0.5) * dLon
      const i = r * cols + c
      if (isOcean(lon, lat)) {
        elevation[i] = 0
        fuel[i] = FUEL.NONE
        continue
      }
      const x = (lon - LON_MIN) / (LON_MAX - LON_MIN)
      const y = (LAT_MAX - lat) / (LAT_MAX - LAT_MIN)
      elevation[i] =
        20 + 260 * x * (0.5 + y) + 90 * Math.sin(x * 23 + y * 7) * Math.cos(y * 17 - x * 5) + 40 * Math.sin(x * 61) * Math.sin(y * 53)
      let f: number = FUEL.GRASS
      const noise = Math.sin(x * 97 + y * 31) + Math.cos(y * 83 - x * 19)
      if (y > 0.65) f = noise > -0.6 ? FUEL.FOREST : FUEL.SHRUB
      else if (y > 0.35) f = noise > 0.2 ? FUEL.SHRUB : noise < -1.2 ? FUEL.CROP : FUEL.GRASS
      else if (noise > 1.1) f = FUEL.SHRUB
      if (DENSE.some((b) => inBox(lon, lat, b, 0.008))) f = FUEL.URBAN_LOW
      if (DENSE.some((b) => inBox(lon, lat, b))) f = FUEL.URBAN_DENSE
      fuel[i] = f
      // A made-up "scar": an ellipse running north-west from the synthetic ignitions.
      const u = (lon + 71.49) / 0.05
      const v = (lat + 33.075) / 0.03
      const ru = u * 0.8 + v * 0.6
      const rv = -u * 0.6 + v * 0.8
      scar[i] = ru * ru + (rv * rv) / 0.25 < 1 ? 1 : 0
    }
  }

  // Buildings: random points inside urban cells.
  const bld: number[] = []
  for (let i = 0; i < n; i++) {
    const p = fuel[i] === FUEL.URBAN_DENSE ? 0.7 : fuel[i] === FUEL.URBAN_LOW ? 0.18 : 0
    if (p === 0 || rnd() > p) continue
    const r = Math.floor(i / cols)
    const c = i % cols
    bld.push(LON_MIN + (c + rnd()) * dLon, LAT_MAX - (r + rnd()) * dLat, 60 + rnd() * 140)
  }
  const buildings = new Float32Array(bld)

  // Roads: a lattice every 5 cells, a "highway" along one row.
  const step = 5
  const nr = Math.floor(rows / step)
  const nc = Math.floor(cols / step)
  const nodeId = new Int32Array(nr * nc).fill(-1)
  const nodes: [number, number][] = []
  for (let a = 0; a < nr; a++)
    for (let b = 0; b < nc; b++) {
      const r = a * step + 2
      const c = b * step + 2
      const i = r * cols + c
      if (fuel[i] === FUEL.NONE) continue
      nodeId[a * nc + b] = nodes.length
      nodes.push([LON_MIN + (c + 0.5) * dLon, LAT_MAX - (r + 0.5) * dLat])
    }
  const highwayRow = Math.round(nr * 0.38)
  const edges: [number, number, number, RoadClass][] = []
  const clsAt = (a: number, b: number, horizontal: boolean): RoadClass => {
    if (horizontal && a === highwayRow) return ROAD.MOTORWAY
    const f = fuel[(a * step + 2) * cols + b * step + 2]
    if (f === FUEL.URBAN_DENSE || f === FUEL.URBAN_LOW) return ROAD.LOCAL
    if (f === FUEL.FOREST) return ROAD.PATH
    return b % 4 === 0 || a % 4 === 0 ? ROAD.TERTIARY : ROAD.PATH
  }
  for (let a = 0; a < nr; a++)
    for (let b = 0; b < nc; b++) {
      const u = nodeId[a * nc + b]
      if (u < 0) continue
      if (b + 1 < nc && nodeId[a * nc + b + 1] >= 0) edges.push([u, nodeId[a * nc + b + 1], step * CELL_M, clsAt(a, b, true)])
      if (a + 1 < nr && nodeId[(a + 1) * nc + b] >= 0) edges.push([u, nodeId[(a + 1) * nc + b], step * CELL_M, clsAt(a, b, false)])
    }
  const roads: RoadsFile = { nodes, edges }

  // Weather: hourly, 2 and 3 Feb, hot dry afternoon with south-easterly wind.
  const weather: WeatherFile = {
    source: 'Sintético (pruebas)',
    lat: -33.05,
    lon: -71.47,
    times: [],
    tempC: [],
    rh: [],
    windKmh: [],
    windFromDeg: [],
    gustKmh: [],
  }
  for (let h = 0; h < 48; h++) {
    const hod = h % 24
    const bell = Math.exp(-((hod - 15.5) ** 2) / 18)
    const day = h < 24 ? 1 : 0.7
    weather.times.push(`2024-02-0${h < 24 ? 2 : 3}T${String(hod).padStart(2, '0')}:00`)
    weather.tempC.push(+(17 + 15 * bell * day).toFixed(1))
    weather.rh.push(Math.round(78 - 52 * bell * day))
    weather.windKmh.push(Math.round(8 + 30 * bell * day))
    weather.windFromDeg.push(Math.round(140 + 60 * (1 - bell)) % 360)
    weather.gustKmh.push(Math.round((8 + 30 * bell * day) * 1.6))
  }

  const ignitions: IgnitionPreset[] = [
    { id: 'mock-a', label: 'Foco sintético A', lon: -71.487, lat: -33.112, timeLocal: '2024-02-02T14:20', source: 'Sintético' },
    { id: 'mock-b', label: 'Foco sintético B', lon: -71.455, lat: -33.098, timeLocal: '2024-02-02T15:10', source: 'Sintético' },
  ]
  const firms: FirmsPoint[] = [
    { lon: -71.49, lat: -33.1, timeLocal: '2024-02-02T15:40', satellite: 'Sintético', frp: 40 },
    { lon: -71.5, lat: -33.085, timeLocal: '2024-02-02T15:40', satellite: 'Sintético', frp: 55 },
    { lon: -71.51, lat: -33.065, timeLocal: '2024-02-02T18:30', satellite: 'Sintético', frp: 120 },
    { lon: -71.52, lat: -33.05, timeLocal: '2024-02-02T18:30', satellite: 'Sintético', frp: 90 },
    { lon: -71.525, lat: -33.04, timeLocal: '2024-02-03T02:10', satellite: 'Sintético', frp: 60 },
  ]
  const brigades: BrigadesFile = {
    stations: [
      { id: 'mock-vina-1', cuerpo: 'Sintético', company: '1ª Compañía', lon: -71.53, lat: -33.02, units: [2, 1, 1, 1], unitsSource: null, locationSource: 'Sintético' },
      { id: 'mock-quilpue-1', cuerpo: 'Sintético', company: '2ª Compañía', lon: -71.445, lat: -33.045, units: [1, 1, 0, 0], unitsSource: null, locationSource: 'Sintético' },
    ],
    dispatch: [{ cuerpo: 'Sintético', dispatchLocal: '2024-02-02T15:00', source: null }],
    reinforcements: [
      {
        id: 'mock-rm',
        label: 'Refuerzo sintético',
        units: [4, 0, 0, 0],
        source: null,
        arrivalLocal: '2024-02-02T19:00',
        arrivalSource: null,
        entries: [{ label: 'Entrada sur', lon: -71.47, lat: -33.135, delayMin: 0, source: null }],
      },
    ],
    cuts: [],
  }
  return { grid, elevation, fuel, scar, buildings, roads, weather, ignitions, firms, brigades, synthetic: true }
}
