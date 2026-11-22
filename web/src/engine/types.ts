// Shared contract between the data pipeline (pipeline/), the engines (src/engine/fire, src/engine/evac)
// and the UI. Change it only together with every consumer.
//
// Units: metres, minutes, km/h, degrees, percent. Engine time is "minutes since GridMeta.t0", in the event's
// local wall-clock time (Viña: America/Santiago, UTC-3 in February; Eaton: America/Los_Angeles, UTC-8 in
// January; neither window crosses a DST change). Infinity means "never" (e.g. a cell the fire does not reach).

// ---------------------------------------------------------------------------------------------------------
// Data files in web/public/data/<event dir>/ (written by pipeline/, read by src/data/load.ts; Viña's at the root,
// the others in their own folder: src/data/events.ts)
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
  /** Simulation clock origin, ISO with offset, e.g. "2024-02-02T12:00:00-03:00" (Viña), "2025-01-07T18:00:00-08:00" (Eaton). */
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

/** Which timeline the explorer simulates. Closed set.
 *  - VINA_2024: the baked files as they are (grid.t0 = 2 Feb 2024 12:00, ERA5 weather, the two ignitions,
 *    FIRMS detections and the Sentinel-2 scar to score against), over their validated window (12:00-24:00).
 *  - TODAY: the same territory today, 00:00 to 24:00, with today's hourly forecast for the weather.json point
 *    (fetched in the browser, src/data/forecast.ts), the 2024 ignition points at the same time of day, and no
 *    satellite detections. src/data/timeline.ts builds it.
 *  - EATON_2025: the Eaton fire (Altadena / Pasadena, California, 7 Jan 2025 18:00 to 8 Jan 12:00 Pacific time),
 *    its own baked files in public/data/eaton-2025/ (another territory: src/data/events.ts).
 *  - TALCA: a hypothetical fire around Talca (Maule region) on a hot reference day (ERA5 weather of
 *    8 Feb 2025, 12:00-24:00) with one hypothetical ignition point; its own baked files in public/data/talca/.
 *    No fire was observed there: no scar (scar.bin is all "no data"), no FIRMS, no validation. */
export const TIMELINE = {
  TODAY: 'hoy',
  VINA_2024: 'vina-2024',
  EATON_2025: 'eaton-2025',
  TALCA: 'talca',
} as const
export type TimelineId = (typeof TIMELINE)[keyof typeof TIMELINE]

/** firms.json: NASA FIRMS active-fire detections (VIIRS / MODIS), converted to local time. goes.json (GOES-16 ABI fire
 *  pixels every 10 min, `satellite` = "GOES-16 ABI", read only by the scoring script) uses the same shape. */
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

/** Cells defended by firefighters (src/engine/brigade). Per cell: a cell the fire reaches at t with
 *  fromMin <= t <= toMin, and whose fireline intensity at t is <= maxKwM, does not burn and stays unburnable
 *  (the front passed while it was held). fromMin = Infinity where the cell is not defended. */
export interface FireDefense {
  fromMin: Float32Array
  toMin: Float32Array
  /** Direct-attack intensity limit, kW/m (Infinity = no limit, structure protection). */
  maxKwM: Float32Array
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
  /** Optional firefighter defence (absent = no firefighting, the calibrated model). */
  defense?: FireDefense
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

/** Households in a community preparation programme (drills, go-bags, an agreed way out): they use their own
 *  preparation median and cue share; everything else (fire, routes, alert, cue radius) is shared. */
export interface EvacProgramme {
  /** 1 per building in the programme, 0 otherwise (length = building count). */
  member: Uint8Array
  prepMedianMin: number
  /** Share 0..1 of the programme's households that leave on environmental cues. */
  cueShare: number
}

export interface EvacInput {
  prepared: EvacPrepared
  arrivalMin: Float32Array
  params: EvacParams
  edits: EvacEdits
  /** Optional: households in a preparation programme (Plan de preparación). */
  programme?: EvacProgramme
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
// Firefighters: brigades.json (hand-curated, read by src/data/load.ts) and the brigade engine
// ---------------------------------------------------------------------------------------------------------

/** Truck (unit) type, closed set. Index into every `units` array. */
export const UNIT = {
  BOMBA: 0, // carro bomba: water, structure protection
  FORESTAL: 1, // carro forestal: small tank, direct attack on wildland fronts
  ALJIBE: 2, // carro aljibe: water supply for the units at its site
  RESCATE: 3, // escala / rescate: no water, rescues households
} as const
export type UnitType = (typeof UNIT)[keyof typeof UNIT]
export const UNIT_COUNT = 4
export const UNIT_LABEL_ES: Record<UnitType, string> = { 0: 'Bomba', 1: 'Forestal', 2: 'Aljibe', 3: 'Escala / rescate' }
export const UNIT_SHORT_ES: Record<UnitType, string> = { 0: 'B', 1: 'F', 2: 'Z', 3: 'R' }

/** A company (compañía) at its cuartel. units: count per UnitType. A null source means "supuesto". */
export interface BrigadeStation {
  id: string
  cuerpo: string
  company: string
  lon: number
  lat: number
  units: number[]
  unitsSource: string | null
  locationSource: string
}

/** When a cuerpo's companies leave their cuarteles (local time ISO without offset). */
export interface CuerpoDispatch {
  cuerpo: string
  dispatchLocal: string
  source: string | null
}

/** A road into the grid for a reinforcement group; delayMin is added to the group's arrival time. */
export interface ReinforcementEntry {
  label: string
  lon: number
  lat: number
  delayMin: number
  source: string | null
}

/** Units from outside the area that enter the grid at arrivalLocal (+ entry delay). */
export interface Reinforcement {
  id: string
  label: string
  units: number[]
  source: string | null
  arrivalLocal: string
  arrivalSource: string | null
  entries: ReinforcementEntry[]
}

/** A documented road cut: road edges along `lines` are unusable from fromLocal until toLocal (null = never reopens). */
export interface RouteCut {
  id: string
  label: string
  lines: [number, number][][]
  fromLocal: string
  toLocal: string | null
  source: string
}

export interface BrigadesFile {
  stations: BrigadeStation[]
  dispatch: CuerpoDispatch[]
  reinforcements: Reinforcement[]
  cuts: RouteCut[]
}

// ---------------------------------------------------------------------------------------------------------
// Fire companies of all of Chile: national/bomberos_cl.json (pipeline/steps/bomberos.py, read by
// src/data/load.ts). The input for building a scenario anywhere in Chile: stationsInBox() turns it into
// BrigadeStation[] for the brigade engine.
// ---------------------------------------------------------------------------------------------------------

/** Vehicle class of the Chilean "material mayor", closed set (pipeline/steps/bomberos.py VEHICLE_KIND_UNIT). The
 *  JNB register (Memoria 2025, p. 34) counts bomba (+ bomba_rescate), forestal, aljibe, escala, rescate, hazmat,
 *  primera intervención, ambulancia and "otros" (mando, transporte, otro). Codes vary by cuerpo. */
export const VEHICLE_KIND = {
  BOMBA: 'bomba', // B / BX: pump with tank (multipropósito semiurbano / pesado)
  BOMBA_RESCATE: 'bomba_rescate', // BR / RB: pump with rescue equipment
  FORESTAL: 'forestal', // F / BF: 4x4 pump for wildland fronts
  PRIMERA_INTERVENCION: 'primera_intervencion', // light first-response unit with a small tank
  ALJIBE: 'aljibe', // Z / BT: water tender
  ESCALA: 'escala', // Q (porta escalas) / M, MX (aerial ladder or platform)
  RESCATE: 'rescate', // R / RX / UR: rescue, no water
  HAZMAT: 'hazmat', // H / HX: hazardous materials
  AMBULANCIA: 'ambulancia', // S
  MANDO: 'mando', // X / K: command
  TRANSPORTE: 'transporte', // T / J / L: crew or logistics
  OTRO: 'otro', // utility units and estimated "otros" of the register
} as const
export type VehicleKind = (typeof VEHICLE_KIND)[keyof typeof VEHICLE_KIND]
/** Which engine unit type a vehicle counts as; null = not modelled by the brigade engine. A first-response unit
 *  carries a small tank like a forestal (JNB C-1: 250-750 gal), so it counts as Forestal; ladders and rescue as
 *  Escala / rescate. */
export const VEHICLE_KIND_UNIT: Record<VehicleKind, UnitType | null> = {
  bomba: UNIT.BOMBA,
  bomba_rescate: UNIT.BOMBA,
  forestal: UNIT.FORESTAL,
  primera_intervencion: UNIT.FORESTAL,
  aljibe: UNIT.ALJIBE,
  escala: UNIT.RESCATE,
  rescate: UNIT.RESCATE,
  hazmat: null,
  ambulancia: null,
  mando: null,
  transporte: null,
  otro: null,
}

/** Company specialty, closed set. 'desconocida' when no source states it. */
export const COMPANY_SPECIALTY = ['agua', 'escala', 'rescate', 'hazmat', 'forestal', 'mixta', 'desconocida'] as const
export type CompanySpecialty = (typeof COMPANY_SPECIALTY)[number]
/** Station kind: a numbered compañía, a cuerpo's cuartel general, or a station whose name says neither. */
export const STATION_KIND = ['compania', 'cuartel_general', 'otro'] as const
export type StationKind = (typeof STATION_KIND)[number]
/** urbano = more than 15,000 residents within 2.5 km of the station (national population product). */
export const SETTLEMENT = ['urbano', 'rural'] as const
export type Settlement = (typeof SETTLEMENT)[number]

/** One truck. source null = "supuesto" (estimated vehicle; make/model drawn from the documented ones). */
export interface NationalVehicle {
  /** As the cuerpo writes it, e.g. "B-12", "M-1"; null when estimated or not given. */
  code: string | null
  kind: VehicleKind
  make: string | null
  model: string | null
  year: number | null
  source: string | null
}

export interface NationalStation {
  id: string
  /** e.g. "Viña del Mar" (Cuerpo de Bomberos de Viña del Mar). */
  cuerpo: string
  /** true when the name did not say the cuerpo and it was taken from the comuna (or a researched comuna → cuerpo
   *  list). */
  cuerpoInferred: boolean
  /** Company number (1 = Primera Compañía); null for a cuartel general or an unnumbered station. */
  number: number | null
  /** Display label, e.g. "8ª Compañía" or the OSM name. */
  company: string
  kind: StationKind
  specialty: CompanySpecialty
  region: string
  comuna: string
  lon: number
  lat: number
  settlement: Settlement
  /** Residents within 2.5 km of the station (national population product, WorldPop 2024). */
  peopleNearby: number
  locationSource: string
  vehicles: NationalVehicle[]
  /** Count per UnitType (UNIT_COUNT), derived from vehicles through VEHICLE_KIND_UNIT. */
  units: number[]
  /** Where the documented vehicles come from; null = no vehicle documented, the whole fleet is "supuesto"
   *  (estimated, see NationalStationsFile.estimateMethod). */
  fleetSource: string | null
  /** true when the source lists the company's whole fleet; false when only some vehicles are documented (e.g. a
   *  delivery note) and the rest are estimated (vehicles with source null). */
  fleetComplete: boolean
}

export interface NationalStationsFile {
  version: 1
  /** Local date of the bake (YYYY-MM-DD). */
  baked: string
  totals: {
    stations: number
    /** Stations with at least one documented vehicle (fleetSource not null). */
    documentedFleets: number
    vehicles: number
    /** Sum of units per UnitType over all stations. */
    units: number[]
  }
  /** National reference figures (Junta Nacional de Bomberos etc.) with their sources, for context. */
  reference: { label: string; value: number; source: string }[]
  estimateMethod: string
  sources: string[]
  stations: NationalStation[]
}

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
  /** [month, day] dates, inclusive. A range whose start is after its end crosses New Year (a northern-hemisphere
   *  school year, August to June; a winter break from December to January). */
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

// ---------------------------------------------------------------------------------------------------------
// Preparation plan (plan.json, written by src/engine/plan/bake.ts; helpers in src/engine/plan/index.ts)
// ---------------------------------------------------------------------------------------------------------

/** A measure the preparation plan ranks. Closed set. */
export const PLAN_MEASURE = {
  /** Clear wildland within beltWidthM of inhabited land, by tile (cost: hectares). */
  BELT: 'franja',
  /** Community preparation programme, by sector (cost: households). */
  PROGRAMME: 'programa',
} as const
export type PlanMeasure = (typeof PLAN_MEASURE)[keyof typeof PLAN_MEASURE]

/** One budget of the plan, scored on fires the ranking never saw and on 2 Feb 2024. Percentages are of the
 *  summed expected households cut off (EvacResult.expectedTrappedHouseholds) without the plan. */
export interface PlanValidation {
  measure: PlanMeasure
  /** Hectares (BELT) or households (PROGRAMME). */
  budget: number
  /** Held-out fires of the ensemble (same weather as 2 Feb, ignitions the ranking never saw). */
  unseenPct: number
  /** The same budget filled at random (several draws): min, median, max on the held-out fires. */
  randomUnseenPct: [number, number, number]
  /** 2 Feb 2024 (real ignitions, alert 18:00), real ERA5 weather. */
  feb2Pct: number
  /** Same, mean over the weather members (wind +-20 %, direction +-10 degrees). */
  feb2MeanPct: number
}

/** plan.json: a preparation plan ranked over an ensemble of plausible fires, never knowing where or when the
 *  next one starts. Tiles and sectors are cells of a coarse grid of tileCells x tileCells grid cells:
 *  tile = floor(row / tileCells) * ceil(cols / tileCells) + floor(col / tileCells). */
export interface PlanFile {
  /** Plain description of how the plan was built (Spanish, shown in the panel). */
  method: string
  tileCells: number
  beltWidthM: number
  programme: { prepMedianMin: number; cueShare: number }
  ensemble: {
    fires: number
    trainFires: number
    testFires: number
    /** The alert reaches everyone this long after the ignition (minutes). */
    alertLagMin: number
    /** Ignitions in wildland this far from inhabited land (metres). */
    ignitionBandM: [number, number]
    /** No ignition within this distance (m) of the 2 Feb 2024 ignitions (so 2 Feb is a fair test). */
    excludeNearRealM: number
  }
  /** Belt tiles, best first by savedPerFire / ha. savedPerFire: expected households saved by the tile alone,
   *  per training fire. */
  tiles: { tile: number; ha: number; savedPerFire: number }[]
  /** Programme sectors, best first by savedPerFire / households. savedPerFire: expected households saved by
   *  the sector alone, per training fire. */
  sectors: { sector: number; households: number; savedPerFire: number }[]
  validation: PlanValidation[]
}
