// Fire behaviour formulas: pure functions, no state, no DOM. References and derivations are in MODEL.md.
//
// - McArthur Mk5 forest fire danger meter, as equations by Noble, Bary & Gill (1980), Aust. J. Ecol. 5:201-203.
// - CSIRO grassland fire spread model, Cheney, Gould & Catchpole (1998), Int. J. Wildland Fire 8:1-13.
// - Fire shape (length-to-breadth vs wind), Alexander (1985), Proc. 8th Conf. Fire and Forest Meteorology.
// - Wind + slope combined as one effective wind vector, in the spirit of Rothermel (1972) / FARSITE.
import { FUEL, type FireParams, type FuelCode, type WeatherSample, type WeatherSeries } from '../types'

/** Which spread model a fuel uses. Closed set. */
export const SPREAD_MODEL = {
  NONE: 0, // does not burn
  MCARTHUR_FOREST: 1, // McArthur Mk5 forest meter (Noble et al. 1980)
  CSIRO_GRASS: 2, // CSIRO grassland model, natural pasture (Cheney et al. 1998)
} as const
export type SpreadModel = (typeof SPREAD_MODEL)[keyof typeof SPREAD_MODEL]

export interface FuelSpread {
  model: SpreadModel
  /** Fine fuel load W in t/ha (MCARTHUR_FOREST only: R = 0.0012 * FFDI * W). */
  loadTHa: number
  /** Multiplier on the model's rate of spread (derives CROP and URBAN_* from grass). */
  factor: number
  /** Whether a burning cell of this fuel lofts embers (spotting source). */
  spotSource: boolean
  /** Whether an ember landing on this fuel can start a spot fire (spotting target). */
  spotTarget: boolean
  /** Multiplier on the maximum spotting distance (params.spotMetresPerKmh * wind) of embers lofted from
   *  this fuel. Ignored when spotSource is false. */
  spotDistanceFactor: number
}

/** McArthur's wind coefficient in FFDI (per km/h): FFDI ~ exp(0.0234 V). */
export const MCARTHUR_WIND_COEF = 0.0234
/** McArthur's slope coefficient (per degree): ROS ~ exp(0.069 slope), i.e. doubles every ~10 degrees. */
export const MCARTHUR_SLOPE_COEF = 0.069

/** Calibration of the ERA5 wind direction (degrees added to "wind from"), applied to the historical series
 *  only (scenario.ts mode "real", calibrate.ts). Fitted on the scar: the reanalysis (0.25 deg) blows from
 *  195-207 deg in the afternoon and drives the head NNE into Quilpué, while the scar's axis and the FIRMS
 *  detections run N (bearing ~5 deg) into El Olivar / Villa Independencia. The only station nearby
 *  (Concón SCVM) reads 220 deg, so this is a fitted stand-in for terrain channelling that ERA5 cannot
 *  resolve, not an observed wind. See MODEL.md section 6. */
export const ERA5_WIND_DIR_CORRECTION_DEG = -10

/** Every calibration knob of the engine in one place. simulateFire reads it at call time, so the integrator
 *  can tune it (e.g. against the Sentinel-2 scar) without touching the code. */
export const FIRE_MODEL = {
  fuels: {
    [FUEL.NONE]: { model: SPREAD_MODEL.NONE, loadTHa: 0, factor: 0, spotSource: false, spotTarget: false, spotDistanceFactor: 1 },
    [FUEL.GRASS]: { model: SPREAD_MODEL.CSIRO_GRASS, loadTHa: 0, factor: 1, spotSource: false, spotTarget: true, spotDistanceFactor: 1 },
    // Matorral spreads at half the McArthur rate of tree cover (x4 below, so x2 net; forest x4). Fitted on the
    // satellite pace back test (MODEL.md section 6, robust over ERA5 wind x0.9-1.1): with one factor for both,
    // the head runs too fast through the scrub south of Lago Peñuelas and the eastern fire overburns.
    [FUEL.SHRUB]: { model: SPREAD_MODEL.MCARTHUR_FOREST, loadTHa: 12, factor: 0.5, spotSource: true, spotTarget: true, spotDistanceFactor: 1 },
    [FUEL.FOREST]: { model: SPREAD_MODEL.MCARTHUR_FOREST, loadTHa: 20, factor: 1, spotSource: true, spotTarget: true, spotDistanceFactor: 1 },
    [FUEL.CROP]: { model: SPREAD_MODEL.CSIRO_GRASS, loadTHa: 0, factor: 0.6, spotSource: false, spotTarget: true, spotDistanceFactor: 1 },
    // Built-up fuels (split in pipeline/steps/wui.py by the pre-fire vegetation within 180 m; MODEL.md section 6):
    // - URBAN_LOW, intermix (houses among scrub, quebradas, gardens): 25 % of grass ROS, and embers ignite it
    //   (roofs, eaves, yards). This is where the 2024 fire destroyed homes.
    // - URBAN_DENSE, consolidated city: spreads only structure to structure (5 % of grass ROS) and embers do
    //   not start new fires there (little fine fuel between houses). Checked with calibrate.ts --scan.
    [FUEL.URBAN_LOW]: { model: SPREAD_MODEL.CSIRO_GRASS, loadTHa: 0, factor: 0.25, spotSource: false, spotTarget: true, spotDistanceFactor: 1 },
    [FUEL.URBAN_DENSE]: { model: SPREAD_MODEL.CSIRO_GRASS, loadTHa: 0, factor: 0.05, spotSource: false, spotTarget: false, spotDistanceFactor: 1 },
  } as Record<FuelCode, FuelSpread>,
  /** Calibration per spread model, multiplying every fuel that uses it (on top of params.rosMultiplier).
   *  Fitted against the Sentinel-2 scar with calibrate.ts (see MODEL.md, "Calibration"):
   *  - McArthur x4 (x3 before the satellite pace back test of 2026-11-22, which also put matorral at half of
   *    it: see fuels). Project Vesta (Cheney et al. 2012) found the Mk5 meter under-predicts summer spread in
   *    dry eucalypt forest by ~2-3x; x4 is above that range and is a fit to this one fire (MODEL.md section 6).
   *  - CSIRO grass x0.25: fitted. The natural-pasture equation is Cheney's fastest pasture type; much of the
   *    domain's WorldCover "grassland" is grazed or sparse herbaceous cover on dry slopes, which spreads
   *    slower (Cheney et al. 1998 grazed pasture; eaten-out pasture slower still). */
  modelFactor: {
    [SPREAD_MODEL.NONE]: 0,
    [SPREAD_MODEL.MCARTHUR_FOREST]: 4,
    [SPREAD_MODEL.CSIRO_GRASS]: 0.25,
  } as Record<SpreadModel, number>,
  /** Equivalent wind per degree of slope, km/h: exp(0.0234 * U_s) = exp(0.069 * slope). */
  slopeWindKmhPerDeg: MCARTHUR_SLOPE_COEF / MCARTHUR_WIND_COEF,
  /** Physical cap on slope (degrees). McArthur's slope rule was fitted on slopes up to ~20 deg; steeper cells
   *  in a 30 m DEM are cliffs, cuts or artefacts, where exp(0.069 * slope) would explode. At 40 deg the slope
   *  alone is worth ~118 km/h of wind (x15.8 on ROS). */
  maxSlopeDeg: 40,
  /** Spotting: only when the 10 m wind (not slope) is at least this (km/h). */
  spotMinWindKmh: 15,
  /** Spotting: only from cells whose head ROS is at least this (m/min). Lofting embers needs an intense fire;
   *  without this gate a cool night-time fire would keep spotting as long as the wind blows (see MODEL.md,
   *  "Spotting"). 0 turns the gate off. */
  spotMinSourceRosMPerMin: 15,
  /** Spotting: ember distance grows with the intensity of the source fire. D_max is multiplied by
   *  (source head ROS / spotRefRosMPerMin) ^ spotIntensityExponent, at most spotMaxScale. For one fuel, fireline
   *  intensity is proportional to ROS (Byram), and the height embers are lofted to grows with intensity
   *  (Albini 1979), so a fast head in steep forest throws embers farther than a slow one in grass and scattered
   *  trees. 0 turns it off (D_max = spotMetresPerKmh * wind, as before). See MODEL.md, "Spotting". */
  spotIntensityExponent: 0,
  spotRefRosMPerMin: 30,
  /** Physical cap on that multiplier: eucalyptus spotting of 0.5-2 km is common, i.e. up to ~3x the
   *  ~700 m D_max of the afternoon wind. */
  spotMaxScale: 3,
  /** Ensemble spotting (MODEL.md, "Spotting"): each source cell's D_max is multiplied by a lognormal factor
   *  with mean 1 and this log-standard deviation, drawn from a hash of (cell, spotJitterSeed), so a run is
   *  deterministic for a seed and members of an ensemble differ cell by cell. 0 turns it off. */
  spotJitterSigma: 0,
  spotJitterSeed: 0,
  /** Spotting: nearest landing distance, in cells (closer than that is ordinary spread). */
  spotMinCells: 3,
  /** Spotting: travel time = spotDelayMin + spotTravelMin * (d / D_max). */
  spotDelayMin: 4,
  spotTravelMin: 10,
  /** Any-angle correction (see MODEL.md, "Grid anisotropy"): a cell may take its arrival time straight from
   *  its parent's own source cell ("anchor"), up to this many cells away, while fuel, ROS and head direction
   *  stay similar. 0 turns it off (plain 16-neighbour Dijkstra). */
  anchorMaxCells: 8,
  /** Anchor kept only while the head ROS differs from the anchor's by at most this fraction... */
  anchorMaxRosChange: 0.25,
  /** ...and the head direction turned by at most this many degrees. */
  anchorMaxTurnDeg: 20,
}

/** McArthur Mk5 Forest Fire Danger Index (Noble et al. 1980). df 0..10, rh %, tempC, windKmh at 10 m. */
export function mcArthurFFDI(df: number, rh: number, tempC: number, windKmh: number): number {
  return 2 * Math.exp(-0.45 + 0.987 * Math.log(df) - 0.0345 * rh + 0.0338 * tempC + MCARTHUR_WIND_COEF * windKmh)
}

/** McArthur forest ROS on flat ground, km/h: R = 0.0012 * FFDI * W (W fine fuel load, t/ha). */
export function forestRosKmh(ffdi: number, loadTHa: number): number {
  return 0.0012 * ffdi * loadTHa
}

/** Dead grass fuel moisture content, % (Cheney et al. 1998, after McArthur): MC = 9.58 - 0.205 T + 0.138 H. */
export function grassMoisturePct(tempC: number, rh: number): number {
  return 9.58 - 0.205 * tempC + 0.138 * rh
}

/** Grass moisture coefficient phi_M (Cheney et al. 1998). Reaches 0 at the moisture of extinction
 *  (MC = 20 % in light wind, 24 % in strong wind): that floor is the model's, not a clamp. */
export function grassMoistureFactor(mc: number, windKmh: number): number {
  if (mc < 12) return Math.exp(-0.108 * mc)
  const phi = windKmh < 10 ? 0.684 - 0.0342 * mc : 0.547 - 0.0228 * mc
  return phi > 0 ? phi : 0
}

/** Grass curing coefficient phi_C (Cheney et al. 1998), curing in %. */
export function grassCuringFactor(curingPct: number): number {
  return 1.12 / (1 + 59.2 * Math.exp(-0.124 * (curingPct - 50)))
}

/** CSIRO grassland ROS on flat ground for natural pasture, km/h (Cheney et al. 1998). */
export function grassRosKmh(windKmh: number, phiM: number, phiC: number): number {
  const base = windKmh < 5 ? 0.054 + 0.209 * windKmh : 1.4 + 0.838 * Math.pow(windKmh - 5, 0.844)
  return base * phiM * phiC
}

/** Head rate of spread on flat ground, km/h, for one fuel and one weather sample. Includes the fuel's
 *  factor, the model's calibration factor and params.rosMultiplier. */
export function flatRosKmh(fuel: FuelCode, w: WeatherSample, params: FireParams): number {
  const f = FIRE_MODEL.fuels[fuel]
  if (!f) throw new Error(`flatRosKmh: unknown fuel code ${fuel}`)
  let r: number
  if (f.model === SPREAD_MODEL.MCARTHUR_FOREST) {
    r = forestRosKmh(mcArthurFFDI(params.droughtFactor, w.rh, w.tempC, w.windKmh), f.loadTHa)
  } else if (f.model === SPREAD_MODEL.CSIRO_GRASS) {
    const phiM = grassMoistureFactor(grassMoisturePct(w.tempC, w.rh), w.windKmh)
    r = grassRosKmh(w.windKmh, phiM, grassCuringFactor(params.curingPct))
  } else {
    return 0
  }
  return r * f.factor * FIRE_MODEL.modelFactor[f.model] * params.rosMultiplier
}

/** Slope correction for a head driven by effective wind U (wind + slope, km/h) when the 10 m wind is V.
 *  For McArthur fuels R(U) = R(V) * exp(0.0234 (U - V)) exactly; using the same factor for grass-based fuels
 *  applies McArthur's slope rule (x2 per 10 deg upslope, /2 per 10 deg downslope) to them too, instead of
 *  feeding U into Cheney's wind curve (which would make a 10 deg slope in calm air ~150x faster). */
export function slopeFactor(effectiveWindKmh: number, windKmh: number): number {
  return Math.exp(MCARTHUR_WIND_COEF * (effectiveWindKmh - windKmh))
}

/** Fire length-to-breadth ratio vs wind speed at 10 m, km/h (Alexander 1985). */
export function lengthToBreadth(windKmh: number): number {
  return 1 + 8.729 * Math.pow(1 - Math.exp(-0.03 * windKmh), 2.155)
}

/** Eccentricity of the fire ellipse from its length-to-breadth ratio. */
export function eccentricity(lb: number): number {
  return Math.sqrt(1 - 1 / (lb * lb))
}

/** ROS in a direction at angle phi from the head (cosPhi = cos(phi)), for an ellipse with the ignition at a
 *  focus: R(phi) = R_head * (1 - e) / (1 - e cos(phi)). */
export function rosAtAngle(rHead: number, e: number, cosPhi: number): number {
  return (rHead * (1 - e)) / (1 - e * cosPhi)
}

/** Weather at tMin: linear interpolation between samples, wind direction along the shorter arc, held
 *  constant outside the series. Writes into `out` (no allocation) and returns it. */
export function weatherInto(s: WeatherSeries, tMin: number, out: WeatherSample): WeatherSample {
  const n = s.samples.length
  const x = (tMin - s.t0Min) / s.stepMin
  if (!(x > 0) || n === 1) return copySample(s.samples[0], out)
  if (x >= n - 1) return copySample(s.samples[n - 1], out)
  const i = Math.floor(x)
  const f = x - i
  const a = s.samples[i]
  const b = s.samples[i + 1]
  out.tempC = a.tempC + f * (b.tempC - a.tempC)
  out.rh = a.rh + f * (b.rh - a.rh)
  out.windKmh = a.windKmh + f * (b.windKmh - a.windKmh)
  const d = ((((b.windFromDeg - a.windFromDeg) % 360) + 540) % 360) - 180 // signed shorter arc, [-180, 180)
  out.windFromDeg = normDeg(a.windFromDeg + f * d)
  return out
}

/** Weather at tMin (allocating version of weatherInto, for the UI and tests). */
export function weatherAt(s: WeatherSeries, tMin: number): WeatherSample {
  return weatherInto(s, tMin, { tempC: 0, rh: 0, windKmh: 0, windFromDeg: 0 })
}

function copySample(a: WeatherSample, out: WeatherSample): WeatherSample {
  out.tempC = a.tempC
  out.rh = a.rh
  out.windKmh = a.windKmh
  out.windFromDeg = normDeg(a.windFromDeg)
  return out
}

/** Same direction, expressed in [0, 360). */
function normDeg(d: number): number {
  const r = d % 360
  return r < 0 ? r + 360 : r
}

/** Byram fireline intensity I = H w R (kW/m with H kJ/kg, w kg/m^2 consumed, R m/s), used only to decide
 *  whether firefighters can attack a cell directly (FireInput.defense.maxKwM). */
export const FIRELINE = {
  /** Low heat of combustion of fine fuels, the value Byram's intensity is usually computed with. */
  heatKJPerKg: 18000,
  /** Grass fuel load for grass-model fuels (their spread model needs none): 4.5 t/ha, the standard natural
   *  pasture load of the CSIRO grassland model (Cheney & Sullivan 2008, Grassfires, CSIRO Publishing). */
  grassLoadTHa: 4.5,
} as const
