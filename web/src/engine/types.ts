// Shared contract between the data pipeline (pipeline/), the engines (src/engine/fire, src/engine/evac)
// and the UI. Change it only together with every consumer.
//
// Units: metres, minutes, km/h, degrees, percent. Engine time is "minutes since GridMeta.t0" (local time
// America/Santiago, UTC-3 in February). Infinity means "never" (e.g. a cell the fire does not reach).

// ---------------------------------------------------------------------------------------------------------
// Data files in web/public/data/ (written by pipeline/, read by src/data/load.ts)
// ---------------------------------------------------------------------------------------------------------

/** grid.json. Row 0 is the NORTH edge, col 0 the WEST edge, row-major (index = r * cols + c).
 *  Cell (r, c) centre: lat = latMax - (r + 0.5) * dLat, lon = lonMin + (c + 0.5) * dLon.
 *  dLat/dLon are chosen so a cell is ~cellM x cellM metres; engines treat cells as square cellM. */
export interface GridMeta {
  rows: number
  cols: number
  latMax: number
  lonMin: number
  dLat: number
  dLon: number
  cellM: number
  /** Simulation clock origin, ISO with offset, e.g. "2024-02-02T12:00:00-03:00". */
  t0: string
  /** Dataset name -> citation / URL, shown on the "Fuentes" panel. */
  sources: Record<string, string>
}

/** fuel.bin: Uint8Array(rows*cols) with these codes. Closed set. */
export const FUEL = {
  NONE: 0, // water, bare rock, paved, sand: does not burn
  GRASS: 1, // grassland / pasture (WorldCover 30)
  SHRUB: 2, // matorral (WorldCover 20)
  FOREST: 3, // tree cover: eucalyptus / pine plantations and native sclerophyll forest (WorldCover 10)
  CROP: 4, // cropland (WorldCover 40)
  URBAN_LOW: 5, // built-up intermix: houses among vegetation (>= 40 % green within 180 m), the wildland-urban interface
  URBAN_DENSE: 6, // consolidated built-up: little vegetation around, spread only structure to structure
} as const
export type FuelCode = (typeof FUEL)[keyof typeof FUEL]
export const FUEL_LABEL_ES: Record<FuelCode, string> = {
  0: 'Sin combustible',
  1: 'Pastizal',
  2: 'Matorral',
  3: 'Bosque / plantación',
  4: 'Cultivo',
  5: 'Urbano en interfaz (casas entre vegetación)',
  6: 'Urbano consolidado',
}

// elevation.bin: Float32Array(rows*cols), metres above sea level (Copernicus GLO-30 resampled).
// scar.bin:      Uint8Array(rows*cols): 1 burned (Sentinel-2 dNBR), 0 not burned, 255 no data.
// buildings.bin: Float32Array(n*3): [lon, lat, footprintAreaM2] per building (Overture / OSM).

/** roads.json: an undirected street graph (every edge is walkable/drivable both ways). */
export interface RoadsFile {
  /** [lon, lat] per node. */
  nodes: [number, number][]
  /** [u, v, lengthM, cls] per edge (u, v are node indices). */
  edges: [number, number, number, RoadClass][]
  /** Optional polyline per edge for drawing, [lon, lat][] (same order as edges). */
  geoms?: [number, number][][]
}
/** Road class, closed set. */
export const ROAD = {
  MOTORWAY: 0, // motorway / trunk
  PRIMARY: 1,
  SECONDARY: 2,
  TERTIARY: 3,
  LOCAL: 4, // residential, unclassified, living_street, service
  PATH: 5, // track, path, footway, steps: on foot only
} as const
export type RoadClass = (typeof ROAD)[keyof typeof ROAD]

/** weather.json: hourly series (Open-Meteo historical archive / ERA5) at one point in the domain. */
export interface WeatherFile {
  source: string
  lat: number
  lon: number
  /** Local time ISO without offset, hourly, e.g. "2024-02-02T14:00". */
  times: string[]
  tempC: number[]
  rh: number[]
  windKmh: number[]
  /** Meteorological convention: the direction the wind blows FROM, degrees clockwise from north. */
  windFromDeg: number[]
  gustKmh: number[]
}

/** ignitions.json */
export interface IgnitionPreset {
  id: string
  label: string
  lon: number
  lat: number
  /** Local time ISO without offset, e.g. "2024-02-02T14:30". */
  timeLocal: string
  source: string
}

/** firms.json: NASA FIRMS active-fire detections (VIIRS / MODIS), converted to local time. */
export interface FirmsPoint {
  lon: number
  lat: number
  timeLocal: string
  satellite: string
  frp: number
}

// ---------------------------------------------------------------------------------------------------------
// Fire engine API (src/engine/fire/index.ts must export exactly these)
// ---------------------------------------------------------------------------------------------------------

export interface WeatherSample {
  tempC: number
  rh: number
  windKmh: number
  windFromDeg: number
}

/** Weather as the engine sees it: samples at tMin = t0Min + i * stepMin, linearly interpolated (wind
 *  direction interpolated on the circle), held constant outside the range. */
export interface WeatherSeries {
  t0Min: number
  stepMin: number
  samples: WeatherSample[]
}

export interface FireParams {
  /** McArthur drought factor 0..10 (10 = fully dry summer fuels). */
  droughtFactor: number
  /** Grass curing 0..100 %. */
  curingPct: number
  /** Global rate-of-spread calibration multiplier (fitted against the Sentinel-2 scar). */
  rosMultiplier: number
  /** Ember spotting on/off, and max spotting distance in metres per km/h of effective wind. */
  spotting: boolean
  spotMetresPerKmh: number
  /** Stop the simulation at this time (minutes since t0). */
  horizonMin: number
}

export interface Ignition {
  cell: number
  tMin: number
}

export interface FireInput {
  grid: GridMeta
  elevation: Float32Array
  fuel: Uint8Array
  /** 1 = firebreak (fuel removed). Same size as fuel. */
  firebreak: Uint8Array
  ignitions: Ignition[]
  weather: WeatherSeries
  params: FireParams
}

export interface FireResult {
  /** Minutes since t0 when the fire reaches each cell; Infinity if it does not before horizonMin. */
  arrivalMin: Float32Array
  /** Head rate of spread at arrival, m/min (for colouring intensity); 0 where unburned. */
  rosMPerMin: Float32Array
  burnedCells: number
  elapsedMs: number
}

// export function simulateFire(input: FireInput): FireResult
// export const DEFAULT_FIRE_PARAMS: FireParams

// ---------------------------------------------------------------------------------------------------------
// Evacuation engine API (src/engine/evac/index.ts must export exactly these)
// ---------------------------------------------------------------------------------------------------------

export interface EvacParams {
  /** Time the evacuation alert reaches everyone in the domain (minutes since t0). */
  alertMin: number
  /** Environmental-cue (spontaneous) evacuation: a household that responds to cues starts its response
   *  when the fire comes within cueRadiusM (m) of its home, if that is earlier than the alert. 0 = off. */
  cueRadiusM: number
  /** Share of households (0..1) that respond to cues (seeing flames, embers or neighbours leaving); the
   *  rest wait for the alert. 0 = off. */
  cueShare: number
  /** Household preparation delay after the alert (or the cue): lognormal with this median (min) and log-sd. */
  prepMedianMin: number
  prepSigma: number
  /** Share of households evacuating on foot (0..1); the rest by car. */
  footShare: number
  walkKmh: number
  /** Free-flow car speed per RoadClass (km/h). PATH is foot-only. */
  carKmhByClass: number[]
  /** A road is unusable from (fire arrival on or next to it) - safetyMarginMin. */
  safetyMarginMin: number
  /** A node is a safe destination if it is at least this far (m) from burnable wildland fuel
   *  (GRASS, SHRUB, FOREST, CROP) and its own cell does not burn. */
  safeDistanceM: number
  personsPerHousehold: number
}

export interface EvacEdits {
  /** Edge indices closed by the user (blocked roads). */
  closedEdges: number[]
  /** Extra emergency links added by the user between two existing nodes. */
  addedLinks: { u: number; v: number }[]
}

/** Graph precomputation that does not depend on the fire (snap buildings to nodes, edge->cells, ...). */
export interface EvacPrepared {
  nodeCount: number
  edgeCount: number
  // engine-specific internals are allowed here
  [k: string]: unknown
}

export interface EvacInput {
  prepared: EvacPrepared
  arrivalMin: Float32Array
  params: EvacParams
  edits: EvacEdits
}

/** Per-building status, closed set. */
export const HOUSEHOLD = {
  UNAFFECTED: 0, // fire never threatens it or its routes
  SAFE: 1, // threatened, but the household gets out in time (risk < 0.1)
  AT_RISK: 2, // 0.1 <= risk < 0.5
  TRAPPED: 3, // risk >= 0.5: most likely cannot get out by its own means
} as const
export type HouseholdStatus = (typeof HOUSEHOLD)[keyof typeof HOUSEHOLD]

export interface EvacResult {
  /** Probability per building of NOT getting out in time (0..1). */
  householdRisk: Float32Array
  householdStatus: Uint8Array
  /** Sum of householdRisk. */
  expectedTrappedHouseholds: number
  expectedTrappedPeople: number
  /** Buildings whose cell the fire reaches before horizon. */
  buildingsReached: number
  /** Expected households routed over each edge (for drawing evacuation flow / bottlenecks). */
  edgeFlow: Float32Array
  /** Time each edge becomes unusable (minutes since t0), Infinity if never. */
  edgeClosesMin: Float32Array
  /** Curve: expected trapped households if the alert had been at each time (same fire). */
  riskByAlert: { alertMin: number; expectedTrappedHouseholds: number }[]
  elapsedMs: number
}

// export function prepareEvac(grid: GridMeta, fuel: Uint8Array, roads: RoadsFile, buildings: Float32Array,
//   params: Pick<EvacParams, 'safeDistanceM'>): EvacPrepared
// export function simulateEvac(input: EvacInput): EvacResult
// export const DEFAULT_EVAC_PARAMS: EvacParams

// ---------------------------------------------------------------------------------------------------------
// Population: where people are by time of day (pipeline/steps/population.py, src/engine/population/)
// ---------------------------------------------------------------------------------------------------------

// population_home.bin: Float32Array(rows*cols), residents per cell: where people are at night and, in this model,
//   all weekend (WorldPop 2024 refined onto the grid).
// population_work.bin: Float32Array(rows*cols), where people are if every resident is at their workplace or
//   school (gravity model to non-residential building volume, GHSL 2025). It counts commuters from outside the grid
//   and leaves out residents who work outside it, so its total differs from home's.
// The share of residents actually away at a given local time is PresenceParams; people in a cell at that time
// = home + away * (work - home).

/** national/population_cl.json: the same two layers for all of Chile on a 30" grid (~0.9 km), aligned with
 *  WorldPop's 3" grid. Row 0 is the NORTH edge; cell index = r * cols + c. The binary
 *  national/population_cl.bin holds, little-endian: Uint32 cell[n] (ascending), Float32 home[n],
 *  Float32 work[n], Float32 nonResidentialM3[n]. Only cells with residents, workers or non-residential
 *  buildings are stored. sum(home) == sum(work): the gravity model moves people, it does not create them. */
export interface NationalPopulationMeta {
  version: 1
  lonMin: number
  latMax: number
  dLon: number
  dLat: number
  rows: number
  cols: number
  /** Number of stored cells. */
  n: number
  layout: string
  /** Gravity kernel exp(-d / scaleM), cut at maxM (metres). */
  commute: { scaleM: number; maxM: number }
  totals: { home: number; work: number; stayHome: number; nonResidentialMillionM3: number }
  source: string
}

export interface NationalPopulation {
  meta: NationalPopulationMeta
  cell: Uint32Array
  home: Float32Array
  work: Float32Array
  nonResidentialM3: Float32Array
}

/** Who is out of home at a given local time. Piecewise-linear schedules are [hour (0..24), share 0..1] knots
 *  in increasing hour order. Weekends (Saturday, Sunday) everyone is home. */
export interface PresenceParams {
  /** Employed persons / population. */
  workerShare: number
  /** Enrolled students (school + higher education) / population. */
  studentShare: number
  /** Share of workers at their workplace on a weekday, by local hour. */
  workSchedule: [number, number][]
  /** Share of students at school on a school day, by local hour. */
  schoolSchedule: [number, number][]
  /** School term [month (1-12), day] start and end, both inclusive, and the winter break inside it. */
  schoolTerm: { start: [number, number]; end: [number, number]; winterBreak: [[number, number], [number, number]] }
}

/** Which day the population model assumes. 'real' = the simulation's own date. Closed set. */
export const POPULATION_DAY = {
  REAL: 'real',
  WEEKDAY_SCHOOL: 'laboral_con_clases',
  WEEKDAY_NO_SCHOOL: 'laboral_sin_clases',
  WEEKEND: 'fin_de_semana',
} as const
export type PopulationDay = (typeof POPULATION_DAY)[keyof typeof POPULATION_DAY]

// export function awayShare(localIso: string, params: PresenceParams, day?: PopulationDay): number
// export function peopleInBurnedArea(...)  (src/engine/population/index.ts)
// export const DEFAULT_PRESENCE_PARAMS: PresenceParams
