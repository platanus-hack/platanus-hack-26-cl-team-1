// Preparation plan helpers: the belt around inhabited land, its tiling, applying it to the fire inputs and
// the programme membership (src/engine/plan/index.ts).
import { describe, expect, it } from 'vitest'
import { FUEL, type GridMeta } from '../types'
import {
  BELT_CELL,
  PLAN_PROGRAMME,
  applyBelt,
  buildBelt,
  checkPlanAgainstData,
  fillBudget,
  programmeFor,
  sectorHouseholds,
  tileHa,
  tileOf,
  tileRing,
} from './index'

// A 9 x 28 grid of 60 m cells, grass everywhere except:
// - (4, 4) URBAN_LOW with no building of its own; a building 2 cells east at (4, 6) (a NONE cell) makes it
//   inhabited. Its belt: grass cells whose centre is within 200 + 30 m, i.e. hypot(dr, dc) <= 3.83 cells.
// - (4, 2) URBAN_DENSE with no building within 2 cells: not inhabited, and never treated (it is not wildland).
// - (1, 5) grass holding a building, inside the belt (hypot(3, 1) = 3.16): INTERMIX. It is 3 cells from (4, 4)
//   (Chebyshev), so it does not make (4, 4) inhabited by itself.
// - (4, 8) grass holding a building, just outside the belt (4 cells): untreated.
// - (4, 22) URBAN_LOW whose nearest building, at (4, 25) (a NONE cell), is 3 cells away: not inhabited, no belt.
// - One building outside the grid.
// Tiles of 5 x 5 cells: 6 tiles per row (the last one 3 cells wide), 2 tile rows (the last one 4 cells tall).
const ROWS = 9
const COLS = 28
const TILE = 5
const grid: GridMeta = {
  rows: ROWS,
  cols: COLS,
  latMax: -33,
  lonMin: -71.6,
  dLat: 0.001,
  dLon: 0.001,
  cellM: 60,
  t0: '2024-02-02T12:00:00-03:00',
  sources: {},
}
const at = (r: number, c: number) => r * COLS + c
function makeFuel(): Uint8Array {
  const fuel = new Uint8Array(ROWS * COLS).fill(FUEL.GRASS)
  fuel[at(4, 4)] = FUEL.URBAN_LOW
  fuel[at(4, 6)] = FUEL.NONE
  fuel[at(4, 2)] = FUEL.URBAN_DENSE
  fuel[at(4, 22)] = FUEL.URBAN_LOW
  fuel[at(4, 25)] = FUEL.NONE
  return fuel
}
const BUILDING_CELLS: [number, number][] = [
  [4, 6],
  [1, 5],
  [4, 8],
  [4, 25],
]
function makeBuildings(): Float32Array {
  const out: number[] = []
  for (const [r, c] of BUILDING_CELLS) out.push(grid.lonMin + (c + 0.5) * grid.dLon, grid.latMax - (r + 0.5) * grid.dLat, 100)
  out.push(grid.lonMin - 0.01, grid.latMax + 0.01, 100) // outside the grid
  return new Float32Array(out)
}

describe('buildBelt', () => {
  const fuel = makeFuel()
  const buildings = makeBuildings()
  const belt = buildBelt(grid, fuel, buildings, TILE)

  it('treats exactly the wildland within 200 m (plus half a cell) of inhabited land', () => {
    const reachCells = (200 + 30) / 60
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const i = at(r, c)
        const inReach = Math.hypot(r - 4, c - 4) <= reachCells
        const wild = fuel[i] === FUEL.GRASS
        const hasBuilding = BUILDING_CELLS.some(([br, bc]) => br === r && bc === c)
        const expected = inReach && wild ? (hasBuilding ? BELT_CELL.INTERMIX : BELT_CELL.CLEAR) : BELT_CELL.NONE
        expect([r, c, belt.cell[i]]).toEqual([r, c, expected])
      }
    // Spot checks of the edges.
    expect(belt.cell[at(4, 1)]).toBe(BELT_CELL.CLEAR) // 3 cells = 180 m
    expect(belt.cell[at(4, 0)]).toBe(BELT_CELL.NONE) // 4 cells = 240 m > 230 m
    expect(belt.cell[at(7, 6)]).toBe(BELT_CELL.CLEAR) // hypot(3, 2) = 3.61 cells = 216 m
    expect(belt.cell[at(7, 7)]).toBe(BELT_CELL.NONE) // hypot(3, 3) = 4.24 cells
    expect(belt.cell[at(1, 5)]).toBe(BELT_CELL.INTERMIX)
    expect(belt.cell[at(4, 8)]).toBe(BELT_CELL.NONE)
    // Built-up and non-burnable cells are never treated.
    for (const [r, c] of [
      [4, 4],
      [4, 2],
      [4, 6],
      [4, 22],
      [4, 25],
    ])
      expect(belt.cell[at(r, c)]).toBe(BELT_CELL.NONE)
    // Nothing around the uninhabited built-up cell (4, 22).
    for (let r = 0; r < ROWS; r++) for (let c = 15; c < COLS; c++) expect(belt.cell[at(r, c)]).toBe(BELT_CELL.NONE)
    // 45 cells within reach, minus the 3 non-wildland ones; one of them holds a house.
    let clear = 0
    let intermix = 0
    for (const v of belt.cell) {
      if (v === BELT_CELL.CLEAR) clear++
      if (v === BELT_CELL.INTERMIX) intermix++
    }
    expect([clear, intermix]).toEqual([41, 1])
  })

  it('a built-up cell needs a building within 2 cells to count as inhabited', () => {
    // Move the building at (4, 6) to (4, 7), 3 cells from (4, 4): nothing is inhabited, no belt at all.
    const far = makeBuildings()
    far[0] = grid.lonMin + 7.5 * grid.dLon
    const none = buildBelt(grid, fuel, far, TILE)
    expect(none.cell.every((v) => v === BELT_CELL.NONE)).toBe(true)
    expect(none.cellsByTile.size).toBe(0)
    // A building in the cell itself is enough.
    const own = makeBuildings()
    own[0] = grid.lonMin + 4.5 * grid.dLon
    expect(buildBelt(grid, fuel, own, TILE).cell[at(4, 1)]).toBe(BELT_CELL.CLEAR)
  })

  it('tiles and sectors are consistent with tileOf', () => {
    expect(belt.tilesPerRow).toBe(6)
    expect(belt.tileCells).toBe(TILE)
    expect(belt.cellHa).toBeCloseTo(0.36, 12)
    // The belt spans rows 1..7 and columns 1..7: tiles 0, 1 (row 0) and 6, 7 (row 1).
    expect([...belt.cellsByTile.keys()].sort((a, b) => a - b)).toEqual([0, 1, 6, 7])
    const seen = new Set<number>()
    for (const [t, cells] of belt.cellsByTile) {
      expect(cells.length).toBeGreaterThan(0)
      for (const i of cells) {
        expect(tileOf(COLS, TILE, i)).toBe(t)
        expect(belt.cell[i]).not.toBe(BELT_CELL.NONE)
        expect(seen.has(i)).toBe(false)
        seen.add(i)
      }
      expect(tileHa(belt, t)).toBeCloseTo(cells.length * 0.36, 9)
    }
    expect(seen.size).toBe(42)
    expect(tileHa(belt, 5)).toBe(0)
    // Buildings: (4, 6) and (1, 5) in tile 1, (4, 8) in tile 1, (4, 25) in tile 5, the last one outside.
    expect([...belt.sectorOfBuilding]).toEqual([1, 1, 1, 5, -1])
    BUILDING_CELLS.forEach(([r, c], b) => expect(belt.sectorOfBuilding[b]).toBe(tileOf(COLS, TILE, at(r, c))))
    expect(sectorHouseholds(belt)).toEqual(
      new Map([
        [1, 3],
        [5, 1],
      ]),
    )
  })

  it('tileOf and tileRing agree on the tiling, partial tiles included', () => {
    expect(tileOf(COLS, TILE, at(0, 0))).toBe(0)
    expect(tileOf(COLS, TILE, at(4, 4))).toBe(0)
    expect(tileOf(COLS, TILE, at(4, 5))).toBe(1)
    expect(tileOf(COLS, TILE, at(0, 27))).toBe(5) // last, 3-cell-wide tile of the row
    expect(tileOf(COLS, TILE, at(5, 0))).toBe(6)
    expect(tileOf(COLS, TILE, at(8, 27))).toBe(11)
    const ring = tileRing(grid, TILE, 11)
    const lon = (c: number) => grid.lonMin + c * grid.dLon
    const lat = (r: number) => grid.latMax - r * grid.dLat
    expect(ring).toEqual([
      [lon(25), lat(5)],
      [lon(28), lat(5)],
      [lon(28), lat(9)],
      [lon(25), lat(9)],
      [lon(25), lat(5)],
    ])
    expect(() => tileRing(grid, TILE, 12)).toThrow()
    expect(() => tileRing(grid, TILE, -1)).toThrow()
  })

  it('rejects a fuel raster of the wrong size', () => {
    expect(() => buildBelt(grid, new Uint8Array(10), buildings, TILE)).toThrow(/fuel/)
  })
})

describe('applyBelt', () => {
  const fuel = makeFuel()
  const buildings = makeBuildings()
  const belt = buildBelt(grid, fuel, buildings, TILE)

  it('clears CLEAR cells and turns INTERMIX cells into URBAN_LOW only in the given tiles, without touching the inputs', () => {
    const firebreak = new Uint8Array(ROWS * COLS)
    firebreak[at(0, 0)] = 1 // a user firebreak elsewhere is kept
    const fuel0 = fuel.slice()
    const fb0 = firebreak.slice()
    const ignition = at(2, 6) // a CLEAR cell of tile 1
    const outside = at(6, 3) // a CLEAR cell of tile 6 (not applied): not counted
    expect(belt.cell[ignition]).toBe(BELT_CELL.CLEAR)
    expect(belt.cell[outside]).toBe(BELT_CELL.CLEAR)
    const r = applyBelt(belt, [1], fuel, firebreak, [ignition, outside])
    expect(fuel).toEqual(fuel0)
    expect(firebreak).toEqual(fb0)
    expect(r.skippedIgnitionCells).toBe(1)
    const inTile = new Set(belt.cellsByTile.get(1)!)
    for (let i = 0; i < ROWS * COLS; i++) {
      const treated = inTile.has(i) && i !== ignition
      const clear = treated && belt.cell[i] === BELT_CELL.CLEAR
      const intermix = treated && belt.cell[i] === BELT_CELL.INTERMIX
      expect([i, r.firebreak[i]]).toEqual([i, clear ? 1 : firebreak[i]])
      expect([i, r.fuel[i]]).toEqual([i, intermix ? FUEL.URBAN_LOW : fuel[i]])
    }
    expect(r.fuel[at(1, 5)]).toBe(FUEL.URBAN_LOW)
    expect(r.firebreak[at(1, 5)]).toBe(0)
    expect(r.firebreak[ignition]).toBe(0)
    expect(r.firebreak[at(0, 0)]).toBe(1)
  })

  it('applies several tiles and no tiles', () => {
    const firebreak = new Uint8Array(ROWS * COLS)
    const all = applyBelt(belt, [0, 1, 6, 7], fuel, firebreak)
    let cleared = 0
    for (const v of all.firebreak) cleared += v
    expect(cleared).toBe(41)
    expect(all.skippedIgnitionCells).toBe(0)
    const none = applyBelt(belt, [], fuel, firebreak)
    expect(none.fuel).toEqual(fuel)
    expect(none.firebreak).toEqual(firebreak)
  })

  it('throws on a tile without belt and on inputs of the wrong size', () => {
    const firebreak = new Uint8Array(ROWS * COLS)
    expect(() => applyBelt(belt, [5], fuel, firebreak)).toThrow(/5/)
    expect(() => applyBelt(belt, [1], fuel.subarray(1), firebreak)).toThrow()
    expect(() => applyBelt(belt, [1], fuel, new Uint8Array(3))).toThrow()
  })
})

describe('programme and budget helpers', () => {
  const belt = buildBelt(grid, makeFuel(), makeBuildings(), TILE)

  it('programmeFor marks the buildings of the given sectors', () => {
    expect(programmeFor(belt, [])).toBeUndefined()
    const p = programmeFor(belt, [5])!
    expect([...p.member]).toEqual([0, 0, 0, 1, 0])
    expect(p.prepMedianMin).toBe(PLAN_PROGRAMME.prepMedianMin)
    expect(p.cueShare).toBe(PLAN_PROGRAMME.cueShare)
    expect([...programmeFor(belt, [1, 5])!.member]).toEqual([1, 1, 1, 1, 0])
    // A sector with no buildings enrols nobody (but is still a programme).
    expect([...programmeFor(belt, [0])!.member]).toEqual([0, 0, 0, 0, 0])
  })

  it('programmeFor never makes a household slower or less responsive than the current settings', () => {
    const defaults = programmeFor(belt, [5], { prepMedianMin: 10, cueShare: 0.65 })!
    expect(defaults.prepMedianMin).toBe(PLAN_PROGRAMME.prepMedianMin)
    expect(defaults.cueShare).toBe(PLAN_PROGRAMME.cueShare)
    const faster = programmeFor(belt, [5], { prepMedianMin: 3, cueShare: 1 })!
    expect(faster.prepMedianMin).toBe(3)
    expect(faster.cueShare).toBe(1)
  })

  it('checkPlanAgainstData accepts a plan built from the same belt and refuses a stale one', () => {
    const hh = sectorHouseholds(belt)
    const t = [...belt.cellsByTile.keys()][0]
    const s = [...hh.keys()][0]
    const ok = { tiles: [{ tile: t, ha: tileHa(belt, t) }], sectors: [{ sector: s, households: hh.get(s)! }] }
    expect(() => checkPlanAgainstData(belt, ok)).not.toThrow()
    expect(() => checkPlanAgainstData(belt, { ...ok, tiles: [{ tile: t, ha: tileHa(belt, t) + 1 }] })).toThrow(/pnpm plan/)
    expect(() => checkPlanAgainstData(belt, { ...ok, sectors: [{ sector: s, households: hh.get(s)! + 1 }] })).toThrow(/pnpm plan/)
    const noBelt = [...Array(belt.tilesPerRow * 4).keys()].find((x) => !belt.cellsByTile.has(x))!
    expect(() => checkPlanAgainstData(belt, { ...ok, tiles: [{ tile: noBelt, ha: 1 }] })).toThrow(/no tiene franja/)
  })

  it('fillBudget takes ranked items while they fit, skipping the ones that would overflow', () => {
    const items = [
      { id: 'a', cost: 3 },
      { id: 'b', cost: 5 },
      { id: 'c', cost: 2 },
      { id: 'd', cost: 1 },
    ]
    const ids = (budget: number) => fillBudget(items, (x) => x.cost, budget).map((x) => x.id)
    expect(ids(6)).toEqual(['a', 'c', 'd'])
    expect(ids(5)).toEqual(['a', 'c'])
    expect(ids(0)).toEqual([])
    expect(ids(100)).toEqual(['a', 'b', 'c', 'd'])
  })
})
