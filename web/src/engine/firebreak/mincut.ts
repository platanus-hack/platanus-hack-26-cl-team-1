// Maximum flow / minimum cut (Dinic's algorithm, iterative) on a directed graph with real capacities.
// Used by ./index.ts to propose firebreak lines: a node-capacitated minimum cut of the fire's spread graph.
// Pure TypeScript, no DOM. MODEL.md in this folder explains how the graph is built.

const EPS = 1e-9

function fail(msg: string): never {
  throw new Error(`mincut: ${msg}`)
}

/** A flow network. Arcs are stored in pairs (arc e and its reverse e ^ 1), so the residual graph needs no
 *  extra structure. Capacities may be Infinity (an arc that can never be cut). */
export class FlowNetwork {
  readonly nodeCount: number
  private head: Int32Array
  private next: Int32Array
  private to: Int32Array
  private cap: Float64Array
  /** Capacities as given, so the same network can be solved again (reset) with some arcs rescaled. */
  private cap0: Float64Array
  private arcs = 0

  constructor(nodeCount: number, arcHint = 64) {
    if (!Number.isInteger(nodeCount) || nodeCount < 2) fail(`a network needs at least 2 nodes (got ${nodeCount})`)
    this.nodeCount = nodeCount
    this.head = new Int32Array(nodeCount).fill(-1)
    const m = Math.max(16, 2 * arcHint)
    this.next = new Int32Array(m)
    this.to = new Int32Array(m)
    this.cap = new Float64Array(m)
    this.cap0 = new Float64Array(m)
  }

  private grow() {
    const m = this.next.length * 2
    const grow32 = (a: Int32Array) => {
      const b = new Int32Array(m)
      b.set(a)
      return b
    }
    const grow64 = (a: Float64Array) => {
      const b = new Float64Array(m)
      b.set(a)
      return b
    }
    this.next = grow32(this.next)
    this.to = grow32(this.to)
    this.cap = grow64(this.cap)
    this.cap0 = grow64(this.cap0)
  }

  /** Adds the arc u -> v with this capacity (>= 0, Infinity allowed) and returns its id. */
  addArc(u: number, v: number, capacity: number): number {
    if (!(u >= 0 && u < this.nodeCount && v >= 0 && v < this.nodeCount)) fail(`arc ${u} -> ${v} is outside the ${this.nodeCount} nodes`)
    if (!(capacity >= 0)) fail(`arc ${u} -> ${v} has capacity ${capacity} (must be >= 0)`)
    if (this.arcs + 2 > this.next.length) this.grow()
    const e = this.arcs
    this.to[e] = v
    this.cap[e] = this.cap0[e] = capacity
    this.next[e] = this.head[u]
    this.head[u] = e
    this.to[e + 1] = u
    this.cap[e + 1] = this.cap0[e + 1] = 0
    this.next[e + 1] = this.head[v]
    this.head[v] = e + 1
    this.arcs += 2
    return e
  }

  /** Forgets the flow, so the network can be solved again. */
  reset(): void {
    this.cap.set(this.cap0.subarray(0, this.arcs))
  }

  /** Sets an arc's capacity (and forgets nothing else: call reset() first when re-solving). */
  setCapacity(arc: number, capacity: number): void {
    if (!(arc >= 0 && arc < this.arcs && (arc & 1) === 0)) fail(`unknown arc ${arc}`)
    if (!(capacity >= 0)) fail(`arc ${arc} has capacity ${capacity} (must be >= 0)`)
    this.cap[arc] = this.cap0[arc] = capacity
  }

  /** Flow sent through an arc by the last maxFlow(). */
  flowOn(arc: number): number {
    return this.cap[arc ^ 1]
  }

  /** Maximum flow from s to t. Throws when a path of only-infinite arcs joins them (no finite cut exists). */
  maxFlow(s: number, t: number): number {
    const n = this.nodeCount
    if (s === t) fail('source and sink are the same node')
    const { head, next, to, cap } = this
    const level = new Int32Array(n)
    const it = new Int32Array(n)
    const queue = new Int32Array(n)
    const pathNode = new Int32Array(n + 1)
    const pathArc = new Int32Array(n + 1)
    let flow = 0
    for (;;) {
      // Levels by breadth-first search on the residual graph.
      level.fill(-1)
      level[s] = 0
      let qh = 0
      let qt = 0
      queue[qt++] = s
      while (qh < qt) {
        const u = queue[qh++]
        for (let e = head[u]; e !== -1; e = next[e]) {
          const v = to[e]
          if (cap[e] > EPS && level[v] < 0) {
            level[v] = level[u] + 1
            queue[qt++] = v
          }
        }
      }
      if (level[t] < 0) return flow
      // Blocking flow by depth-first search with current-arc pointers (iterative: paths can be thousands long).
      it.set(head)
      let sp = 0
      pathNode[0] = s
      for (;;) {
        const u = pathNode[sp]
        if (u === t) {
          let b = Infinity
          for (let k = 0; k < sp; k++) if (cap[pathArc[k]] < b) b = cap[pathArc[k]]
          if (b === Infinity) fail('the source reaches the sink through arcs of infinite capacity: no finite cut')
          let firstSaturated = sp
          for (let k = sp - 1; k >= 0; k--) {
            const e = pathArc[k]
            cap[e] -= b
            cap[e ^ 1] += b
            if (!(cap[e] > EPS)) firstSaturated = k
          }
          flow += b
          sp = firstSaturated // resume from the tail of the first saturated arc
          continue
        }
        let e = it[u]
        while (e !== -1 && !(cap[e] > EPS && level[to[e]] === level[u] + 1)) e = next[e]
        it[u] = e
        if (e !== -1) {
          pathArc[sp] = e
          pathNode[++sp] = to[e]
        } else {
          level[u] = -1 // dead end in this phase
          if (sp === 0) break
          sp--
          it[pathNode[sp]] = next[pathArc[sp]]
        }
      }
    }
  }

  /** After maxFlow(s, t): 1 for every node still reachable from s in the residual graph (the source side of a
   *  minimum cut; the cut is the set of arcs leaving it). */
  sourceSide(s: number): Uint8Array {
    const { head, next, to, cap } = this
    const seen = new Uint8Array(this.nodeCount)
    const stack = new Int32Array(this.nodeCount)
    let sp = 0
    stack[sp++] = s
    seen[s] = 1
    while (sp > 0) {
      const u = stack[--sp]
      for (let e = head[u]; e !== -1; e = next[e]) {
        const v = to[e]
        if (cap[e] > EPS && !seen[v]) {
          seen[v] = 1
          stack[sp++] = v
        }
      }
    }
    return seen
  }
}
