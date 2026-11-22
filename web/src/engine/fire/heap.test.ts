import { describe, expect, it } from 'vitest'
import { CellHeap } from './heap'

describe('CellHeap', () => {
  it('pops cells in key order, with decrease-key and no duplicates', () => {
    let seed = 42
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const n = 2000
    const key = new Float64Array(n).fill(Infinity)
    const heap = new CellHeap(key)
    for (let i = 0; i < n; i++) {
      key[i] = rand() * 1000
      heap.pushOrDecrease(i)
    }
    for (let i = 0; i < n; i += 3) {
      key[i] *= rand() // decrease
      heap.pushOrDecrease(i)
    }
    expect(heap.size).toBe(n)
    let prev = -Infinity
    const seen = new Set<number>()
    while (heap.size > 0) {
      const c = heap.pop()
      expect(key[c]).toBeGreaterThanOrEqual(prev)
      expect(seen.has(c)).toBe(false)
      seen.add(c)
      prev = key[c]
    }
    expect(seen.size).toBe(n)
  })
})
