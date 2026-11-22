// Where and when the fire reaches the edge of the simulated area (the baked grid).
//
// The grid is a hard boundary. simulateFire drops spread and embers that would leave it (index.ts: the neighbour
// and spotting loops skip cells outside rows x cols), because there is no terrain, fuel or weather beyond it.
// So from the first contact on, everything counted from the burned area (hectares, buildings, households)
// leaves out what the fire would reach on the other side. The app reports this contact (src/ui/edgeNote.ts)
// instead of letting the numbers stop silently at the edge.

export interface EdgeContact {
  /** Earliest arrival on the outer ring of cells, minutes since t0; Infinity if the fire never gets there. */
  firstMin: number
  /** Earliest arrival on each side (row 0 is north, col 0 west); Infinity where the fire does not reach it. */
  north: number
  south: number
  east: number
  west: number
  /** Outer-ring cells the fire reaches (cell index, each once) and their arrival times, sorted by arrival. */
  cells: Int32Array
  times: Float32Array
}

/** Edge contact of one fire result. `arrivalMin` is FireResult.arrivalMin for a rows x cols grid. */
export function edgeContact(rows: number, cols: number, arrivalMin: Float32Array): EdgeContact {
  if (!(Number.isInteger(rows) && Number.isInteger(cols) && rows >= 1 && cols >= 1))
    throw new Error(`edgeContact: invalid grid ${rows} x ${cols}`)
  if (arrivalMin.length !== rows * cols)
    throw new Error(`edgeContact: arrivalMin has ${arrivalMin.length} cells, the grid ${rows} x ${cols} has ${rows * cols}`)

  const minOver = (from: number, count: number, step: number) => {
    let m = Infinity
    for (let k = 0, i = from; k < count; k++, i += step) if (arrivalMin[i] < m) m = arrivalMin[i]
    return m
  }
  const north = minOver(0, cols, 1)
  const south = minOver((rows - 1) * cols, cols, 1)
  const west = minOver(0, rows, cols)
  const east = minOver(cols - 1, rows, cols)

  // Every outer-ring cell once: the top and bottom rows, then the two side columns without their corners.
  const ring: number[] = []
  for (let c = 0; c < cols; c++) ring.push(c)
  if (rows > 1) for (let c = 0; c < cols; c++) ring.push((rows - 1) * cols + c)
  for (let r = 1; r < rows - 1; r++) {
    ring.push(r * cols)
    if (cols > 1) ring.push(r * cols + cols - 1)
  }
  const reached = ring.filter((i) => Number.isFinite(arrivalMin[i])).sort((a, b) => arrivalMin[a] - arrivalMin[b] || a - b)
  const cells = Int32Array.from(reached)
  const times = Float32Array.from(reached, (i) => arrivalMin[i])

  return { firstMin: Math.min(north, south, east, west), north, south, east, west, cells, times }
}
