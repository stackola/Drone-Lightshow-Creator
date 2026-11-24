// Proven checks for motions that aren't synchronised.
//
// Within one flight every drone shares one timing curve, and the validator
// checks pairs in closed form. Groups flying their own sequences don't share
// a clock, so for them (and for keep-out zones, which are arbitrary polygons)
// we use a speed bound instead: no drone moves faster than v, so a distance
// between two drones changes by at most 2v per second, and a drone's distance
// to a fixed shape by at most v. Between two samples dt apart a pair at
// distances d0 and d1 is therefore at least (d0 + d1)/2 − v·dt apart (for
// a zone: (c0 + c1)/2 − v·dt/2). Where that bound isn't enough the interval
// is bisected, until the bound clears it or a sample shows the violation.

export type PosAt = (t: number, out: Float32Array) => void

export interface PairFinding {
  /** Closest distance seen between drones of different groups. */
  d: number
  t: number
  i: number
  j: number
  /** Distinct pairs found closer than the limit. */
  pairsBelow: number
}

const MIN_DT = 1e-3

/** Sample times: the bound's slack v·dt is a quarter of the spacing. */
export function sampleStep(spacing: number, v: number): number {
  return Math.max(0.01, Math.min(0.5, (0.25 * spacing) / Math.max(0.1, v)))
}

function dist(a: Float32Array, b: Float32Array, i: number, j: number): number {
  return Math.hypot(a[i * 3]! - b[j * 3]!, a[i * 3 + 1]! - b[j * 3 + 1]!, a[i * 3 + 2]! - b[j * 3 + 2]!)
}

/** Pairs (i < j) in different groups closer than r, by spatial hashing. */
function closePairs(p: Float32Array, n: number, groupOf: Int32Array, r: number, out: Set<number>): void {
  const cell = new Map<string, number[]>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  for (let i = 0; i < n; i++) {
    if (groupOf[i]! < 0) continue
    const k = key(Math.floor(p[i * 3]! / r), Math.floor(p[i * 3 + 1]! / r), Math.floor(p[i * 3 + 2]! / r))
    const list = cell.get(k)
    if (list) list.push(i)
    else cell.set(k, [i])
  }
  for (let i = 0; i < n; i++) {
    if (groupOf[i]! < 0) continue
    const cx = Math.floor(p[i * 3]! / r), cy = Math.floor(p[i * 3 + 1]! / r), cz = Math.floor(p[i * 3 + 2]! / r)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const list = cell.get(key(cx + dx, cy + dy, cz + dz))
          if (!list) continue
          for (const j of list) {
            if (j <= i || groupOf[j] === groupOf[i]) continue
            if (dist(p, p, i, j) < r) out.add(i * n + j)
          }
        }
  }
}

/**
 * Closest approach between drones of different groups over [t0, t1], proven
 * down to the limit `spacing`: either every pair stays at least `spacing`
 * apart, or the returned closest distance is a real sampled position below it.
 * `groupOf[i]` < 0 leaves drone i out.
 */
export function crossGroupSeparation(posAt: PosAt, n: number, groupOf: Int32Array, t0: number, t1: number, spacing: number, v: number): PairFinding {
  const best: PairFinding = { d: Infinity, t: t0, i: 0, j: 0, pairsBelow: 0 }
  if (t1 <= t0 || n < 2) return best
  const below = new Set<number>()
  const dt0 = sampleStep(spacing, v)
  const steps = Math.max(1, Math.ceil((t1 - t0) / dt0))
  const dt = (t1 - t0) / steps
  const reach = spacing + v * dt
  const cache = new Map<number, Float32Array>()
  const at = (t: number) => {
    let p = cache.get(t)
    if (!p) { p = new Float32Array(n * 3); posAt(t, p); cache.set(t, p) }
    return p
  }
  const note = (d: number, t: number, i: number, j: number) => {
    if (d < best.d) { best.d = d; best.t = t; best.i = i; best.j = j }
    if (d < spacing - 1e-6) below.add(i * n + j)
  }
  // Prove a pair clear on [ta, tb], bisecting where the bound is too loose.
  const refine = (i: number, j: number, ta: number, tb: number, da: number, db: number, depth: number) => {
    if ((da + db) / 2 - v * (tb - ta) >= spacing) return
    if (da < spacing || db < spacing || tb - ta < MIN_DT || depth > 24) return
    const tm = (ta + tb) / 2
    const pm = at(tm)
    const dm = dist(pm, pm, i, j)
    note(dm, tm, i, j)
    refine(i, j, ta, tm, da, dm, depth + 1)
    refine(i, j, tm, tb, dm, db, depth + 1)
  }
  let prev = at(t0)
  let prevPairs = new Set<number>()
  closePairs(prev, n, groupOf, reach, prevPairs)
  for (const key of prevPairs) { const i = Math.floor(key / n), j = key % n; note(dist(prev, prev, i, j), t0, i, j) }
  for (let k = 1; k <= steps; k++) {
    const ta = t0 + (k - 1) * dt, tb = k === steps ? t1 : t0 + k * dt
    const cur = at(tb)
    const curPairs = new Set<number>()
    closePairs(cur, n, groupOf, reach, curPairs)
    for (const key of new Set([...prevPairs, ...curPairs])) {
      const i = Math.floor(key / n), j = key % n
      const da = dist(prev, prev, i, j), db = dist(cur, cur, i, j)
      note(db, tb, i, j)
      refine(i, j, ta, tb, da, db, 0)
    }
    // Keep the cache small: only the current sample is reused.
    for (const t of cache.keys()) if (t !== tb) cache.delete(t)
    prev = cur
    prevPairs = curPairs
  }
  best.pairsBelow = below.size
  return best
}

export interface ZoneFinding {
  /** Smallest clearance seen (negative = inside the zone or its buffer). */
  clearance: number
  t: number
  drone: number
}

/**
 * Smallest clearance of every drone against a fixed region over [t0, t1],
 * proven: `clearance(x, y, z)` is the distance to the region minus what must
 * be kept (it changes at most as fast as the drone moves). Either every drone
 * keeps clearance ≥ 0 throughout, or the finding is a real sampled position
 * below 0. `skip(t)` can exclude times (e.g. on the ground).
 */
export function zoneClearance(posAt: PosAt, n: number, t0: number, t1: number, clearance: (x: number, y: number, z: number) => number, v: number, step = 0.5): ZoneFinding {
  const best: ZoneFinding = { clearance: Infinity, t: t0, drone: 0 }
  if (t1 < t0) return best
  const steps = Math.max(1, Math.ceil((t1 - t0) / step))
  const dt = (t1 - t0) / steps
  const pa = new Float32Array(n * 3), pb = new Float32Array(n * 3), pm = new Float32Array(n * 3)
  const ca = new Float32Array(n), cb = new Float32Array(n)
  const clr = (p: Float32Array, i: number) => clearance(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!)
  const note = (c: number, t: number, i: number) => { if (c < best.clearance) { best.clearance = c; best.t = t; best.drone = i } }
  posAt(t0, pa)
  for (let i = 0; i < n; i++) { ca[i] = clr(pa, i); note(ca[i]!, t0, i) }
  const refine = (i: number, ta: number, tb: number, a: number, b: number, depth: number) => {
    if ((a + b) / 2 - (v * (tb - ta)) / 2 >= 0) return
    if (a < 0 || b < 0 || tb - ta < MIN_DT || depth > 24) return
    const tm = (ta + tb) / 2
    posAt(tm, pm)
    const m = clr(pm, i)
    note(m, tm, i)
    refine(i, ta, tm, a, m, depth + 1)
    refine(i, tm, tb, m, b, depth + 1)
  }
  for (let k = 1; k <= steps; k++) {
    const ta = t0 + (k - 1) * dt, tb = k === steps ? t1 : t0 + k * dt
    posAt(tb, pb)
    for (let i = 0; i < n; i++) {
      cb[i] = clr(pb, i)
      note(cb[i]!, tb, i)
      refine(i, ta, tb, ca[i]!, cb[i]!, 0)
    }
    pa.set(pb)
    ca.set(cb)
  }
  return best
}
