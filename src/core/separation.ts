// Pairwise separation: the spacing guarantee, closest pairs in a formation,
// and the exact closest approach during a synchronised straight-line move.

const EPS = 1e-6

/** The spacing that guarantees collision-free optimal transitions (√2·min, rounded up). */
export function comfortableSpacing(minSpacing: number): number {
  return Math.ceil(minSpacing * Math.SQRT2 * 1.03 * 10) / 10
}

export function closestPair(pts: Float32Array): { i: number; j: number; d: number; below: (limit: number) => number } {
  const n = pts.length / 3
  let bi = -1, bj = -1, best = Infinity
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!
    for (let j = i + 1; j < n; j++) {
      const dx = x - pts[j * 3]!, dy = y - pts[j * 3 + 1]!, dz = z - pts[j * 3 + 2]!
      const d = dx * dx + dy * dy + dz * dz
      if (d < best) { best = d; bi = i; bj = j }
    }
  }
  return {
    i: bi, j: bj, d: Math.sqrt(best),
    below(limit: number) {
      const l2 = limit * limit
      let count = 0
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) {
          const dx = pts[i * 3]! - pts[j * 3]!, dy = pts[i * 3 + 1]! - pts[j * 3 + 1]!, dz = pts[i * 3 + 2]! - pts[j * 3 + 2]!
          if (dx * dx + dy * dy + dz * dz < l2 - EPS) count++
        }
      return count
    },
  }
}

/** Exact closest approach of all pairs during a synchronised straight-line move. */
export function flightClosestApproach(from: Float32Array, to: Float32Array, limit: number): { d: number; s: number; i: number; j: number; pairsBelow: number } {
  const n = from.length / 3
  let best = Infinity, bs = 0, bi = -1, bj = -1, below = 0
  const l2 = limit * limit
  for (let i = 0; i < n; i++) {
    const ax = from[i * 3]!, ay = from[i * 3 + 1]!, az = from[i * 3 + 2]!
    const ex = to[i * 3]! - ax, ey = to[i * 3 + 1]! - ay, ez = to[i * 3 + 2]! - az
    for (let j = i + 1; j < n; j++) {
      const Ax = ax - from[j * 3]!, Ay = ay - from[j * 3 + 1]!, Az = az - from[j * 3 + 2]!
      const Bx = ex - (to[j * 3]! - from[j * 3]!), By = ey - (to[j * 3 + 1]! - from[j * 3 + 1]!), Bz = ez - (to[j * 3 + 2]! - from[j * 3 + 2]!)
      const bb = Bx * Bx + By * By + Bz * Bz
      let s = bb > 1e-12 ? -(Ax * Bx + Ay * By + Az * Bz) / bb : 0
      if (s < 0) s = 0
      else if (s > 1) s = 1
      const x = Ax + s * Bx, y = Ay + s * By, z = Az + s * Bz
      const d = x * x + y * y + z * z
      if (d < l2 - EPS) below++
      if (d < best) { best = d; bs = s; bi = i; bj = j }
    }
  }
  return { d: Math.sqrt(best), s: bs, i: bi, j: bj, pairsBelow: below }
}

