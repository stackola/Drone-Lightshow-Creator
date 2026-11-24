// Optimal assignment of drones to target points.
//
// Minimising the sum of *squared* distances, combined with synchronised
// straight-line motion (every drone shares the same time-scaling s(t)), gives
// a classic guarantee (Turpin, Michael & Kumar, "CAPT", 2014): if start points
// and goal points are each separated by more than √2·d, no two drones come
// closer than d during the transition. The validator still checks every pair
// exactly; this is why the defaults rarely need it.

/**
 * Hungarian algorithm (shortest augmenting path with potentials), O(n³).
 * `from` and `to` are packed xyz arrays of equal length.
 * Returns `match` where match[i] = index in `to` assigned to `from[i]`.
 */
export function assignMinSquared(from: Float32Array, to: Float32Array): Int32Array {
  const n = from.length / 3
  if (to.length / 3 !== n) throw new Error('assign: point counts differ')
  const ax = new Float64Array(n), ay = new Float64Array(n), az = new Float64Array(n)
  const bx = new Float64Array(n), by = new Float64Array(n), bz = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    ax[i] = from[i * 3]!; ay[i] = from[i * 3 + 1]!; az[i] = from[i * 3 + 2]!
    bx[i] = to[i * 3]!; by[i] = to[i * 3 + 1]!; bz[i] = to[i * 3 + 2]!
  }
  // 1-indexed arrays per the classic formulation; row 0 / column 0 are sentinels.
  const u = new Float64Array(n + 1)
  const v = new Float64Array(n + 1)
  const p = new Int32Array(n + 1) // p[j] = row matched to column j
  const way = new Int32Array(n + 1)
  const minv = new Float64Array(n + 1)
  const used = new Uint8Array(n + 1)
  // Warm start (column reduction): v[j] = min_i c(i,j), and greedily match each
  // column to its cheapest row when that row is still free. Reduced costs stay
  // non-negative and matched edges are tight, so the augmenting phase below
  // remains exact while skipping most of the work.
  const rowTaken = new Uint8Array(n + 1)
  for (let j = 1; j <= n; j++) {
    const x = bx[j - 1]!, y = by[j - 1]!, z = bz[j - 1]!
    let best = Infinity, bi = 0
    for (let i = 0; i < n; i++) {
      const dx = ax[i]! - x, dy = ay[i]! - y, dz = az[i]! - z
      const c = dx * dx + dy * dy + dz * dz
      if (c < best) { best = c; bi = i + 1 }
    }
    v[j] = best
    if (!rowTaken[bi]) { rowTaken[bi] = 1; p[j] = bi }
  }
  for (let i = 1; i <= n; i++) {
    if (rowTaken[i]) continue
    p[0] = i
    let j0 = 0
    minv.fill(Infinity)
    used.fill(0)
    do {
      used[j0] = 1
      const i0 = p[j0]!
      const x = ax[i0 - 1]!, y = ay[i0 - 1]!, z = az[i0 - 1]!
      const ui0 = u[i0]!
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue
        const dx = x - bx[j - 1]!, dy = y - by[j - 1]!, dz = z - bz[j - 1]!
        const cur = dx * dx + dy * dy + dz * dz - ui0 - v[j]!
        if (cur < minv[j]!) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j]! < delta) {
          delta = minv[j]!
          j1 = j
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta
          v[j]! -= delta
        } else {
          minv[j]! -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0)
  }
  const match = new Int32Array(n)
  for (let j = 1; j <= n; j++) match[p[j]! - 1] = j - 1
  return match
}

export function totalSquared(from: Float32Array, to: Float32Array, match: Int32Array): number {
  let s = 0
  for (let i = 0; i < match.length; i++) {
    const j = match[i]!
    const dx = from[i * 3]! - to[j * 3]!, dy = from[i * 3 + 1]! - to[j * 3 + 1]!, dz = from[i * 3 + 2]! - to[j * 3 + 2]!
    s += dx * dx + dy * dy + dz * dz
  }
  return s
}
