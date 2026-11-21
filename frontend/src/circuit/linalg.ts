/**
 * Dense linear algebra for the circuit solver (circuits are small: < ~200 nodes).
 */

/** Smallest pivot magnitude accepted before declaring the matrix singular. */
const PIVOT_EPS = 1e-18;

/**
 * Solve A·x = b with Gaussian elimination (LU) and partial pivoting.
 * `A` is row-major n×n and is DESTROYED (overwritten with the factors).
 * Returns null when the matrix is singular or the result is not finite.
 */
export function luSolve(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const x = Float64Array.from(b);
  for (let k = 0; k < n; k++) {
    // partial pivoting: largest |a_ik| for i ≥ k
    let p = k;
    let max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > max) {
        max = v;
        p = i;
      }
    }
    if (!(max > PIVOT_EPS)) return null;
    if (p !== k) {
      const rk = k * n;
      const rp = p * n;
      for (let j = k; j < n; j++) {
        const t = A[rk + j];
        A[rk + j] = A[rp + j];
        A[rp + j] = t;
      }
      const t = x[k];
      x[k] = x[p];
      x[p] = t;
    }
    const rk = k * n;
    const pivot = A[rk + k];
    for (let i = k + 1; i < n; i++) {
      const ri = i * n;
      const f = A[ri + k] / pivot;
      if (f === 0) continue;
      A[ri + k] = 0;
      for (let j = k + 1; j < n; j++) A[ri + j] -= f * A[rk + j];
      x[i] -= f * x[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    const ri = i * n;
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= A[ri + j] * x[j];
    x[i] = s / A[ri + i];
    if (!Number.isFinite(x[i])) return null;
  }
  return x;
}
