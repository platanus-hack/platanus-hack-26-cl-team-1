// Indexed binary min-heap over cell indices, keyed by an external Float64Array (the tentative arrival times).
// Typed arrays only, decrease-key in place, so the heap never holds more than one entry per cell.

export class CellHeap {
  private readonly heap: Int32Array
  /** Position of each cell in `heap`, -1 when not in the heap. */
  private readonly pos: Int32Array
  private readonly key: Float64Array
  size = 0

  constructor(key: Float64Array) {
    this.key = key
    this.heap = new Int32Array(key.length)
    this.pos = new Int32Array(key.length).fill(-1)
  }

  /** Insert `cell`, or move it up after its key decreased. */
  pushOrDecrease(cell: number): void {
    let p = this.pos[cell]
    if (p < 0) {
      p = this.size++
      this.heap[p] = cell
      this.pos[cell] = p
    }
    this.siftUp(p)
  }

  /** Remove and return the cell with the smallest key. Caller checks size > 0. */
  pop(): number {
    const heap = this.heap
    const top = heap[0]
    this.pos[top] = -1
    const last = heap[--this.size]
    if (this.size > 0) {
      heap[0] = last
      this.pos[last] = 0
      this.siftDown(0)
    }
    return top
  }

  private siftUp(p: number): void {
    const heap = this.heap
    const pos = this.pos
    const key = this.key
    const cell = heap[p]
    const k = key[cell]
    while (p > 0) {
      const q = (p - 1) >> 1
      const parent = heap[q]
      if (key[parent] <= k) break
      heap[p] = parent
      pos[parent] = p
      p = q
    }
    heap[p] = cell
    pos[cell] = p
  }

  private siftDown(p: number): void {
    const heap = this.heap
    const pos = this.pos
    const key = this.key
    const n = this.size
    const cell = heap[p]
    const k = key[cell]
    for (;;) {
      const l = 2 * p + 1
      if (l >= n) break
      const r = l + 1
      let m = l
      if (r < n && key[heap[r]] < key[heap[l]]) m = r
      const child = heap[m]
      if (key[child] >= k) break
      heap[p] = child
      pos[child] = p
      p = m
    }
    heap[p] = cell
    pos[cell] = p
  }
}
