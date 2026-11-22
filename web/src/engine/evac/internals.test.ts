// Randomized checks of the two search routines against brute force.
import { describe, expect, it } from 'vitest'
import { buildCsr, NodeHash, wildlandDistanceCells } from './prepare'
import { latestDeparture, MaxHeap } from './simulate'

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
}

describe('latestDeparture', () => {
  it('matches a brute-force fixed-point iteration on random graphs', () => {
    const rand = rng(7)
    for (let trial = 0; trial < 200; trial++) {
      const N = 2 + Math.floor(rand() * 25)
      const M = Math.floor(rand() * N * 2)
      const us = new Int32Array(M)
      const vs = new Int32Array(M)
      const travel = new Float64Array(M)
      const closes = new Float64Array(M)
      for (let e = 0; e < M; e++) {
        us[e] = Math.floor(rand() * N)
        vs[e] = Math.floor(rand() * N)
        const r = rand()
        travel[e] = r < 0.1 ? Infinity : r < 0.15 ? 0 : 0.5 + rand() * 10
        const c = rand()
        closes[e] = c < 0.4 ? Infinity : c < 0.5 ? -Infinity : rand() * 100
      }
      const deadline = new Float64Array(N)
      for (let i = 0; i < N; i++) deadline[i] = rand() < 0.5 ? Infinity : rand() * 100
      const safeList: number[] = []
      for (let i = 0; i < N; i++) if (rand() < 0.2) safeList.push(i)
      const safe = Int32Array.from(safeList)
      const lab = latestDeparture(N, buildCsr(N, us, vs), travel, closes, deadline, safe, new MaxHeap(4))

      // Brute force: Bellman-Ford style relaxation to the fixed point.
      const L = new Float64Array(N).fill(-Infinity)
      for (const s of safeList) L[s] = Infinity
      for (let it = 0; it <= N + 1; it++) {
        let changed = false
        for (let e = 0; e < M; e++) {
          if (travel[e] === Infinity) continue
          for (const [u, v] of [
            [us[e], vs[e]],
            [vs[e], us[e]],
          ]) {
            if (L[u] === Infinity && safeList.includes(u)) continue
            const cand = Math.min(Math.min(L[v], closes[e]) - travel[e], deadline[u])
            if (cand > L[u]) {
              L[u] = cand
              changed = true
            }
          }
        }
        if (!changed) break
      }
      for (let i = 0; i < N; i++) {
        if (Number.isFinite(L[i])) expect(lab.L[i]).toBeCloseTo(L[i], 9)
        else expect(lab.L[i]).toBe(L[i])
      }
      // The next hop of every settled non-safe node points to a node settled before it, over an edge
      // that realizes its label.
      const pos = new Int32Array(N).fill(-1)
      for (let k = 0; k < lab.nOrder; k++) pos[lab.order[k]] = k
      for (let i = 0; i < N; i++) {
        const e = lab.nextEdge[i]
        if (e < 0) continue
        const v = lab.nextNode[i]
        expect(pos[v]).toBeLessThan(pos[i])
        expect(Math.min(Math.min(lab.L[v], closes[e]) - travel[e], deadline[i])).toBe(lab.L[i])
      }
    }
  })
})

describe('NodeHash', () => {
  it('finds the true nearest node, including for points outside the node bounding box', () => {
    const rand = rng(11)
    for (let trial = 0; trial < 30; trial++) {
      const n = 1 + Math.floor(rand() * 300)
      const xs = new Float64Array(n)
      const ys = new Float64Array(n)
      for (let i = 0; i < n; i++) {
        // clustered points, some far away
        xs[i] = rand() < 0.9 ? rand() * 1000 : 5000 + rand() * 3000
        ys[i] = rand() * 2000
      }
      const include = new Uint8Array(n).map(() => (rand() < 0.7 ? 1 : 0))
      include[0] = 1
      const h = new NodeHash(xs, ys, include)
      for (let q = 0; q < 200; q++) {
        const px = -3000 + rand() * 14000
        const py = -3000 + rand() * 8000
        let best = Infinity
        for (let i = 0; i < n; i++) if (include[i]) best = Math.min(best, Math.hypot(xs[i] - px, ys[i] - py))
        const got = h.nearest(px, py)
        expect(include[got]).toBe(1)
        expect(h.lastDist).toBeCloseTo(best, 6)
      }
    }
  })
})

describe('wildlandDistanceCells', () => {
  it('is within the chamfer error of the exact Euclidean distance', () => {
    const rows = 40
    const cols = 50
    const fuel = new Uint8Array(rows * cols).fill(6)
    const seeds = [
      [3, 4],
      [30, 40],
      [20, 10],
    ]
    for (const [r, c] of seeds) fuel[r * cols + c] = 3
    const d = wildlandDistanceCells(fuel, rows, cols, 1).dist
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const exact = Math.min(...seeds.map(([sr, sc]) => Math.hypot(r - sr, c - sc)))
        expect(d[r * cols + c]).toBeGreaterThanOrEqual(exact - 1e-4)
        expect(d[r * cols + c]).toBeLessThanOrEqual(exact * 1.09 + 1e-4) // 1/sqrt-2 chamfer: < 8.3 % over
      }
  })

  it('ignores wildland patches smaller than minPatchCells', () => {
    const rows = 20
    const cols = 20
    const fuel = new Uint8Array(rows * cols).fill(6)
    fuel[5 * cols + 5] = 1 // a 1-cell park
    for (let r = 10; r < 14; r++) for (let c = 0; c < 3; c++) fuel[r * cols + c] = 2 // a 12-cell patch
    const { dist, ignoredPatches } = wildlandDistanceCells(fuel, rows, cols, 5)
    expect(ignoredPatches).toBe(1)
    expect(dist[5 * cols + 5]).toBeGreaterThan(0) // the park is not wildland
    expect(dist[10 * cols + 0]).toBe(0)
    expect(dist[10 * cols + 6]).toBe(4)
  })
})
