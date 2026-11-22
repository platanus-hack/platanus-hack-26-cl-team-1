// Benchmark: synthetic 464 x 529 grid (the real domain's size, 60 m cells) with mixed fuels and hills,
// 18 h of afternoon-like weather, spotting on and off. Run: pnpm exec tsx src/engine/fire/bench.ts
import { FUEL, type FireInput, type FuelCode, type WeatherSample } from '../types'
import { DEFAULT_FIRE_PARAMS, FIRE_MODEL, flatRosKmh, simulateFire } from './index'

const rows = 464
const cols = 529
const cellM = 60
const n = rows * cols

// Smooth pseudo-noise from a few sines (deterministic).
const noise = (r: number, c: number, s: number) =>
  Math.sin(r * 0.031 * s + 1.3) * Math.cos(c * 0.027 * s + 0.7) + 0.5 * Math.sin((r + c) * 0.053 * s) + 0.25 * Math.cos((r - 2 * c) * 0.071 * s)

const elevation = new Float32Array(n)
const fuel = new Uint8Array(n)
const firebreak = new Uint8Array(n)
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const i = r * cols + c
    // Coastal plain to the west, hills (up to ~500 m, slopes up to ~25 deg) and quebradas inland.
    elevation[i] = Math.max(0, c * 0.6 + 120 * noise(r, c, 1) + 40 * noise(r, c, 3.1))
    const v = noise(r + 400, c + 900, 1.7)
    let f: FuelCode
    if (c < 15) f = FUEL.NONE // sea
    else if (v > 0.9) f = FUEL.URBAN_DENSE
    else if (v > 0.55) f = FUEL.URBAN_LOW
    else if (v > 0.1) f = FUEL.GRASS
    else if (v > -0.4) f = FUEL.SHRUB
    else if (v > -0.9) f = FUEL.FOREST
    else f = FUEL.CROP
    if ((r * 7 + c * 13) % 97 === 0) f = FUEL.NONE // scattered roads / rock
    fuel[i] = f
    if (c === 300 && r > 100 && r < 360) firebreak[i] = 1
  }
}

// Hourly from 12:00, hot dry SW wind peaking in the afternoon.
const samples: WeatherSample[] = []
for (let h = 0; h <= 18; h++) {
  const day = Math.max(0, Math.sin(((h + 2) / 14) * Math.PI))
  samples.push({ tempC: 22 + 13 * day, rh: 60 - 40 * day, windKmh: 12 + 28 * day, windFromDeg: 225 + 20 * Math.sin(h / 3) })
}

const ignitionCell = 300 * cols + 120
if (fuel[ignitionCell] === FUEL.NONE) throw new Error('bench: ignition on NONE, change the seed cell')

function input(spotting: boolean, rosMultiplier = 1): FireInput {
  return {
    grid: { rows, cols, latMax: -32.965, lonMin: -71.625, dLat: 0.00054, dLon: 0.00064, cellM, t0: '2024-02-02T12:00:00-03:00', sources: {} },
    elevation,
    fuel,
    firebreak,
    ignitions: [{ cell: ignitionCell, tMin: 150 }],
    weather: { t0Min: 0, stepMin: 60, samples },
    params: { ...DEFAULT_FIRE_PARAMS, spotting, rosMultiplier },
  }
}

function bench(label: string, spotting: boolean, rosMultiplier = 1, reps = 7) {
  const times: number[] = []
  let burned = 0
  for (let k = 0; k < reps; k++) {
    const t = performance.now()
    const res = simulateFire(input(spotting, rosMultiplier))
    times.push(performance.now() - t)
    burned = res.burnedCells
  }
  times.sort((a, b) => a - b)
  const med = times[Math.floor(times.length / 2)]
  const pct = ((100 * burned) / n).toFixed(1)
  console.log(`${label.padEnd(44)} median ${med.toFixed(0).padStart(4)} ms (min ${times[0].toFixed(0)}, max ${times[reps - 1].toFixed(0)}, ${reps} runs)  burned ${burned} cells (${pct} %)`)
}

console.log(`grid ${rows} x ${cols} = ${n} cells, ${cellM} m, node ${process.version}`)
bench('default params (spotting on)', true)
bench('spotting off', false)
bench('worst case: rosMultiplier 6, most cells burn', true, 6)
const anchors = FIRE_MODEL.anchorMaxCells
FIRE_MODEL.anchorMaxCells = 0
bench('worst case, anchors off (plain 16-neighbour)', true, 6)
FIRE_MODEL.anchorMaxCells = anchors

// Grid anisotropy: head distance / (R_head * t) on flat grass, 30 km/h wind, for head bearings on and between
// the stencil directions (90 and 63.4 are stencil moves, 76.7 and 54 lie between them).
{
  const ar = 141
  const ac = 181
  const an = ar * ac
  const am = 10
  const line: string[] = []
  for (const bearing of [90, 76.7, 63.43, 54, 45]) {
    const w = { tempC: 30, rh: 30, windKmh: 30, windFromDeg: (bearing + 180) % 360 }
    const rh = (flatRosKmh(FUEL.GRASS, w, DEFAULT_FIRE_PARAMS) * 1000) / 60
    const t = (100 * am) / rh
    const ux = Math.sin((bearing * Math.PI) / 180)
    const uy = Math.cos((bearing * Math.PI) / 180)
    const ratio: string[] = []
    for (const cells of [anchors, 0]) {
      FIRE_MODEL.anchorMaxCells = cells
      const res = simulateFire({
        grid: { rows: ar, cols: ac, latMax: 0, lonMin: 0, dLat: 1e-4, dLon: 1e-4, cellM: am, t0: '2024-02-02T12:00:00-03:00', sources: {} },
        elevation: new Float32Array(an),
        fuel: new Uint8Array(an).fill(FUEL.GRASS),
        firebreak: new Uint8Array(an),
        ignitions: [{ cell: 110 * ac + 30, tMin: 0 }],
        weather: { t0Min: 0, stepMin: 60, samples: [w] },
        params: { ...DEFAULT_FIRE_PARAMS, spotting: false, horizonMin: t },
      })
      let best = 0
      for (let r = 0; r < ar; r++)
        for (let c = 0; c < ac; c++) if (Number.isFinite(res.arrivalMin[r * ac + c])) best = Math.max(best, ((c - 30) * ux + (110 - r) * uy) * am)
      ratio.push((best / (rh * t)).toFixed(2))
    }
    line.push(`${bearing}°: ${ratio[0]} / ${ratio[1]}`)
  }
  FIRE_MODEL.anchorMaxCells = anchors
  console.log(`head reach / (R*t), anchors on / off: ${line.join('   ')}`)
}
