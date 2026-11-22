// STUB (replaced by the fire-engine work): a constant-speed circle so the UI can be built in parallel.
import type { FireInput, FireParams, FireResult } from '../types'

export const DEFAULT_FIRE_PARAMS: FireParams = {
  droughtFactor: 10,
  curingPct: 100,
  rosMultiplier: 1,
  spotting: true,
  spotMetresPerKmh: 12,
  horizonMin: 18 * 60,
}

export function simulateFire(input: FireInput): FireResult {
  const t = performance.now()
  const { rows, cols, cellM } = input.grid
  const arrival = new Float32Array(rows * cols).fill(Infinity)
  const ros = new Float32Array(rows * cols)
  let burned = 0
  for (const ig of input.ignitions) {
    const ir = Math.floor(ig.cell / cols)
    const ic = ig.cell % cols
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        if (input.fuel[i] === 0 || input.firebreak[i]) continue
        const tm = ig.tMin + (Math.hypot(r - ir, c - ic) * cellM) / 20
        if (tm < input.params.horizonMin && tm < arrival[i]) {
          if (arrival[i] === Infinity) burned++
          arrival[i] = tm
          ros[i] = 20
        }
      }
  }
  return { arrivalMin: arrival, rosMPerMin: ros, burnedCells: burned, elapsedMs: performance.now() - t }
}
