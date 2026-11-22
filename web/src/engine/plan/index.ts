// Preparation plan ("Plan de preparación"): measures chosen before any fire, ranked over an ensemble of
// plausible fires (bake.ts writes public/data/plan.json). This module holds what the bake script, the worker
// and the UI share: the 1 km tiling, the 200 m belt around inhabited land and how it is applied to the fire
// inputs, and the programme membership of each building. Pure TypeScript, no DOM. MODEL.md explains it.
import { FUEL, type EvacProgramme, type GridMeta } from '../types'

/** Tile side in grid cells: 17 x 60 m = 1.02 km. */
export const PLAN_TILE_CELLS = 17
/** Belt width: wildland whose cell centre is within this distance (plus half a cell) of inhabited land. */
export const PLAN_BELT_WIDTH_M = 200
/** A built-up cell is inhabited if a building lies within this many cells (5 x 5 window, about 120 m): drops
 *  road corridors and paved land the land-cover map classifies as built-up. */
const INHABITED_WINDOW_CELLS = 2
/** Community preparation programme: drills, go-bags and an agreed way out. Preparation median 10 -> 5 min,
 *  share of households that leave on seeing the fire, embers or neighbours leaving 0.65 -> 0.9. Assumptions
 *  for planning, not measured effects (MODEL.md). */
export const PLAN_PROGRAMME = { prepMedianMin: 5, cueShare: 0.9 } as const

const WILDLAND = new Set<number>([FUEL.GRASS, FUEL.SHRUB, FUEL.FOREST, FUEL.CROP])
const isBuilt = (f: number) => f === FUEL.URBAN_LOW || f === FUEL.URBAN_DENSE

/** Belt treatment per cell. Closed set. */
export const BELT_CELL = {
  NONE: 0,
  /** Wildland with no building: vegetation cleared (becomes a firebreak cell, does not burn). */
  CLEAR: 1,
  /** Wildland holding houses: the houses stay, the vegetation around them is managed (becomes URBAN_LOW). */
  INTERMIX: 2,
} as const

export interface Belt {
  rows: number
  cols: number
  tileCells: number
  /** Tiles per grid row of tiles: ceil(cols / tileCells). */
  tilesPerRow: number
  /** BELT_CELL per grid cell. */
  cell: Uint8Array
  /** Treated cells of each tile (only tiles with at least one). */
  cellsByTile: Map<number, Int32Array>
  /** Building -> its cell's tile (the programme sector), -1 outside the grid. */
  sectorOfBuilding: Int32Array
  cellHa: number
}

export function tileOf(cols: number, tileCells: number, cell: number): number {
  const r = Math.floor(cell / cols)
  const c = cell - r * cols
  return Math.floor(r / tileCells) * Math.ceil(cols / tileCells) + Math.floor(c / tileCells)
}

/** Tile outline as a closed [lon, lat] ring (clipped to the grid). */
export function tileRing(g: GridMeta, tileCells: number, tile: number): [number, number][] {
  const per = Math.ceil(g.cols / tileCells)
  const tr = Math.floor(tile / per)
  const tc = tile - tr * per
  const r0 = tr * tileCells
  const c0 = tc * tileCells
  const r1 = Math.min(g.rows, r0 + tileCells)
  const c1 = Math.min(g.cols, c0 + tileCells)
  if (r0 >= g.rows || c0 >= g.cols || tile < 0) throw new Error(`tileRing: la celda ${tile} está fuera de la grilla`)
  const lon = (c: number) => g.lonMin + c * g.dLon
  const lat = (r: number) => g.latMax - r * g.dLat
  return [
    [lon(c0), lat(r0)],
    [lon(c1), lat(r0)],
    [lon(c1), lat(r1)],
    [lon(c0), lat(r1)],
    [lon(c0), lat(r0)],
  ]
}

/** Building cell from buildings.bin ([lon, lat, area] per building), -1 outside the grid. */
function buildingCells(g: GridMeta, buildings: Float32Array): Int32Array {
  const n = buildings.length / 3
  const out = new Int32Array(n)
  for (let b = 0; b < n; b++) {
    const c = Math.floor((buildings[3 * b] - g.lonMin) / g.dLon)
    const r = Math.floor((g.latMax - buildings[3 * b + 1]) / g.dLat)
    out[b] = r >= 0 && c >= 0 && r < g.rows && c < g.cols ? r * g.cols + c : -1
  }
  return out
}

/** The 200 m belt around inhabited land, split into tiles. Deterministic from the grid, fuel and buildings. */
export function buildBelt(g: GridMeta, fuel: Uint8Array, buildings: Float32Array, tileCells = PLAN_TILE_CELLS, widthM = PLAN_BELT_WIDTH_M): Belt {
  const { rows, cols, cellM } = g
  const n = rows * cols
  if (fuel.length !== n) throw new Error(`buildBelt: fuel tiene ${fuel.length} celdas, se esperaban ${n}`)
  const bCell = buildingCells(g, buildings)
  const bldPerCell = new Int32Array(n)
  for (const c of bCell) if (c >= 0) bldPerCell[c]++
  // Inhabited built-up cells.
  const inhabited = new Uint8Array(n)
  const W = INHABITED_WINDOW_CELLS
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!isBuilt(fuel[i])) continue
      let w = 0
      for (let a = -W; a <= W && !w; a++)
        for (let b = -W; b <= W; b++) {
          const rr = r + a
          const cc = c + b
          if (rr >= 0 && cc >= 0 && rr < rows && cc < cols && bldPerCell[rr * cols + cc] > 0) {
            w = 1
            break
          }
        }
      inhabited[i] = w
    }
  // Wildland within widthM + half a cell (centre to centre) of an inhabited cell.
  const reach = widthM + cellM / 2
  const R = Math.ceil(reach / cellM)
  const cell = new Uint8Array(n)
  const cellsByTileArr = new Map<number, number[]>()
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!WILDLAND.has(fuel[i])) continue
      let near = false
      for (let a = -R; a <= R && !near; a++)
        for (let b = -R; b <= R; b++) {
          const rr = r + a
          const cc = c + b
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || !inhabited[rr * cols + cc]) continue
          if (Math.hypot(a, b) * cellM <= reach) {
            near = true
            break
          }
        }
      if (!near) continue
      cell[i] = bldPerCell[i] > 0 ? BELT_CELL.INTERMIX : BELT_CELL.CLEAR
      const t = tileOf(cols, tileCells, i)
      let arr = cellsByTileArr.get(t)
      if (!arr) cellsByTileArr.set(t, (arr = []))
      arr.push(i)
    }
  const cellsByTile = new Map<number, Int32Array>()
  for (const [t, a] of cellsByTileArr) cellsByTile.set(t, Int32Array.from(a))
  const sectorOfBuilding = new Int32Array(bCell.length)
  for (let b = 0; b < bCell.length; b++) sectorOfBuilding[b] = bCell[b] >= 0 ? tileOf(cols, tileCells, bCell[b]) : -1
  return { rows, cols, tileCells, tilesPerRow: Math.ceil(cols / tileCells), cell, cellsByTile, sectorOfBuilding, cellHa: (cellM * cellM) / 1e4 }
}

/** Hectares the belt treats in a tile (0 if the tile has no belt). */
export function tileHa(belt: Belt, tile: number): number {
  return (belt.cellsByTile.get(tile)?.length ?? 0) * belt.cellHa
}

/** Fire inputs with the belt applied in the given tiles: cleared cells join the firebreak mask, cells with
 *  houses become intermix. Cells holding an ignition are left untouched (the engine refuses an unburnable
 *  ignition); their count is returned so the caller can say so. Inputs are not modified. */
export function applyBelt(
  belt: Belt,
  tiles: readonly number[],
  fuel: Uint8Array,
  firebreak: Uint8Array,
  ignitionCells: readonly number[] = [],
): { fuel: Uint8Array; firebreak: Uint8Array; skippedIgnitionCells: number } {
  const n = belt.rows * belt.cols
  if (fuel.length !== n || firebreak.length !== n) throw new Error('applyBelt: fuel y firebreak deben cubrir la grilla')
  const outFuel = fuel.slice()
  const outFb = firebreak.slice()
  const ign = new Set(ignitionCells)
  let skipped = 0
  for (const t of tiles) {
    const cells = belt.cellsByTile.get(t)
    if (!cells) throw new Error(`applyBelt: la celda de plan ${t} no tiene franja`)
    for (const i of cells) {
      if (ign.has(i)) {
        skipped++
        continue
      }
      if (belt.cell[i] === BELT_CELL.CLEAR) outFb[i] = 1
      else if (belt.cell[i] === BELT_CELL.INTERMIX) outFuel[i] = FUEL.URBAN_LOW
    }
  }
  return { fuel: outFuel, firebreak: outFb, skippedIgnitionCells: skipped }
}

/** The programme for the households of the given sectors (EvacInput.programme), or undefined if none.
 *  `current` is the behaviour everyone else has (the Evacuación settings): the programme never makes a
 *  household slower or less responsive than that, so its members get the faster preparation and the higher
 *  cue share of the two (a modelling choice; with the defaults, 10 min and 0.65, it is PLAN_PROGRAMME). */
export function programmeFor(
  belt: Belt,
  sectors: readonly number[],
  current: { prepMedianMin: number; cueShare: number } = { prepMedianMin: Infinity, cueShare: 0 },
): EvacProgramme | undefined {
  if (sectors.length === 0) return undefined
  const set = new Set(sectors)
  const member = new Uint8Array(belt.sectorOfBuilding.length)
  for (let b = 0; b < member.length; b++) if (set.has(belt.sectorOfBuilding[b])) member[b] = 1
  return {
    member,
    prepMedianMin: Math.min(PLAN_PROGRAMME.prepMedianMin, current.prepMedianMin),
    cueShare: Math.max(PLAN_PROGRAMME.cueShare, current.cueShare),
  }
}

/** Checks plan.json against the belt and households built from the current data (a rebake of fuel or buildings
 *  without `pnpm plan` would otherwise show wrong hectares and enrol other households). Throws in Spanish. */
export function checkPlanAgainstData(belt: Belt, plan: { tiles: { tile: number; ha: number }[]; sectors: { sector: number; households: number }[] }): void {
  const stale = (what: string) => {
    throw new Error(`plan.json no coincide con los datos (${what}): vuelve a generar el plan (pnpm plan)`)
  }
  for (const t of plan.tiles) {
    if (!belt.cellsByTile.has(t.tile)) stale(`la celda ${t.tile} no tiene franja`)
    if (Math.abs(tileHa(belt, t.tile) - t.ha) > 0.01) stale(`la celda ${t.tile} tiene ${tileHa(belt, t.tile).toFixed(2)} ha, el plan dice ${t.ha}`)
  }
  const hh = sectorHouseholds(belt)
  for (const s of plan.sectors) if ((hh.get(s.sector) ?? 0) !== s.households) stale(`el sector ${s.sector} tiene ${hh.get(s.sector) ?? 0} hogares, el plan dice ${s.households}`)
}

/** Households (buildings) per sector. */
export function sectorHouseholds(belt: Belt): Map<number, number> {
  const m = new Map<number, number>()
  for (const s of belt.sectorOfBuilding) if (s >= 0) m.set(s, (m.get(s) ?? 0) + 1)
  return m
}

/** Take items in ranked order while the budget allows (skipping any that would overflow it). */
export function fillBudget<T>(ranked: readonly T[], cost: (x: T) => number, budget: number): T[] {
  const out: T[] = []
  let used = 0
  for (const x of ranked) {
    const c = cost(x)
    if (used + c > budget) continue
    out.push(x)
    used += c
  }
  return out
}
