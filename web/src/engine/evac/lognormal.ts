// Lognormal CDF used for the household preparation delay.

/** Complementary error function (Numerical Recipes "erfcc", Chebyshev fit, fractional error < 1.2e-7
 *  everywhere, including the tails). */
export function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + 0.5 * z)
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? r : 2 - r
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2)
}

/** P(delay <= x) for a lognormal delay with this median (> 0) and log-sd (> 0).
 *  0 for x <= 0 (including -Infinity), 1 for x = +Infinity. Throws on NaN (an upstream bug). */
export function lognormalCdf(x: number, median: number, sigma: number): number {
  return makeLognormalCdf(median, sigma)(x)
}

/** lognormalCdf with median and sigma fixed: precomputes the log terms, and returns exactly 1 from
 *  z >= 8.3, where 1 - Phi(z) < 6e-17 already rounds to 1 in float64 (no change in results). */
export function makeLognormalCdf(median: number, sigma: number): (x: number) => number {
  if (!(median > 0 && sigma > 0)) throw new Error(`makeLognormalCdf: median ${median} and sigma ${sigma} must be > 0`)
  const lnMedian = Math.log(median)
  const invSigma = 1 / sigma
  const xOne = median * Math.exp(8.3 * sigma)
  return (x: number) => {
    if (x !== x) throw new Error('lognormalCdf: x is NaN')
    if (x <= 0) return 0
    if (x >= xOne) return 1
    return normalCdf((Math.log(x) - lnMedian) * invSigma)
  }
}
