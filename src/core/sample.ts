// Point-distribution helpers shared by the shape generators.
// Everything here is pure and deterministic.

import type { Mask } from './types'

// --- Masks -------------------------------------------------------------------

export function encodeMask(w: number, h: number, on: (x: number, y: number) => boolean): Mask {
  const bytes = new Uint8Array(Math.ceil((w * h) / 8))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      const i = y * w + x
      bytes[i >> 3]! |= 0x80 >> (i & 7)
    }
  return { w, h, bits: bytesToBase64(bytes) }
}

export function decodeMask(mask: Mask): Uint8Array {
  const bytes = base64ToBytes(mask.bits)
  const out = new Uint8Array(mask.w * mask.h)
  for (let i = 0; i < out.length; i++) out[i] = (bytes[i >> 3]! >> (7 - (i & 7))) & 1
  return out
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = ''
  const CH = 0x8000
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH))
  return btoa(s)
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// --- Curves ------------------------------------------------------------------

/**
 * Sample `n` points equally spaced by arc length along a parametric curve
 * f(t), t ∈ [0, 1]. Closed curves do not repeat the start point.
 */
export function sampleCurve(n: number, closed: boolean, f: (t: number) => [number, number, number]): Float32Array {
  const out = new Float32Array(n * 3)
  if (n === 0) return out
  const STEPS = Math.max(2000, n * 20)
  const xs = new Float64Array(STEPS + 1), ys = new Float64Array(STEPS + 1), zs = new Float64Array(STEPS + 1)
  const len = new Float64Array(STEPS + 1)
  for (let i = 0; i <= STEPS; i++) {
    const p = f(i / STEPS)
    xs[i] = p[0]; ys[i] = p[1]; zs[i] = p[2]
    if (i > 0) len[i] = len[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, ys[i]! - ys[i - 1]!, zs[i]! - zs[i - 1]!)
  }
  const total = len[STEPS]!
  const divisions = closed ? n : Math.max(1, n - 1)
  let seg = 0
  for (let k = 0; k < n; k++) {
    const target = n === 1 && !closed ? total / 2 : (total * k) / divisions
    while (seg < STEPS - 1 && len[seg + 1]! < target) seg++
    const span = len[seg + 1]! - len[seg]!
    const u = span > 0 ? (target - len[seg]!) / span : 0
    out[k * 3] = xs[seg]! + (xs[seg + 1]! - xs[seg]!) * u
    out[k * 3 + 1] = ys[seg]! + (ys[seg + 1]! - ys[seg]!) * u
    out[k * 3 + 2] = zs[seg]! + (zs[seg + 1]! - zs[seg]!) * u
  }
  return out
}

/** Sample `n` points equally spaced along the perimeter of a closed polygon. */
export function samplePolygonOutline(n: number, poly: [number, number][]): Float32Array {
  const m = poly.length
  const cum = [0]
  for (let i = 0; i < m; i++) {
    const a = poly[i]!, b = poly[(i + 1) % m]!
    cum.push(cum[i]! + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = cum[m]!
  return sampleCurve(n, true, (t) => {
    const d = t * total
    let i = 0
    while (i < m - 1 && cum[i + 1]! < d) i++
    const a = poly[i]!, b = poly[(i + 1) % m]!
    const span = cum[i + 1]! - cum[i]!
    const u = span > 0 ? (d - cum[i]!) / span : 0
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, 0]
  })
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Dense candidate points inside a polygon on a hexagonal lattice. */
export function polygonCandidates(poly: [number, number][], target: number): Float32Array {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  let area = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += (poly[j]![0] + poly[i]![0]) * (poly[j]![1] - poly[i]![1])
  area = Math.abs(area) / 2
  const h = Math.sqrt(area / (target * 0.866))
  const pts: number[] = []
  let row = 0
  for (let y = minY + h / 2; y <= maxY; y += h * 0.866, row++) {
    for (let x = minX + (row % 2 ? h / 2 : 0); x <= maxX; x += h) {
      if (pointInPolygon(x, y, poly)) pts.push(x, y, 0)
    }
  }
  return Float32Array.from(pts)
}

/** Candidate points at the centres of "on" mask pixels, mapped to a box of the given width/height centred on 0 (y up). */
export function maskCandidates(mask: Mask, width: number, height: number, target: number): Float32Array {
  const px = decodeMask(mask)
  let count = 0
  for (let i = 0; i < px.length; i++) count += px[i]!
  if (count === 0) return new Float32Array(0)
  const sx = width / mask.w, sy = height / mask.h
  const pts: number[] = []
  // Subsample very dense masks, supersample very sparse ones.
  const stride = Math.max(1, Math.floor(Math.sqrt(count / target)))
  const sub = count < target / 4 ? 3 : 1
  for (let y = 0; y < mask.h; y += stride)
    for (let x = 0; x < mask.w; x += stride) {
      if (!px[y * mask.w + x]) continue
      for (let a = 0; a < sub; a++)
        for (let b = 0; b < sub; b++) {
          const fx = x + (a + 0.5) / sub, fy = y + (b + 0.5) / sub
          pts.push(fx * sx - width / 2, height / 2 - fy * sy, 0)
        }
    }
  return Float32Array.from(pts)
}

// --- Even selection from candidates -------------------------------------------

/**
 * Pick `n` well-spread points from a candidate set: farthest-point sampling
 * followed by a few rounds of Lloyd relaxation snapped back onto candidates.
 * Returns indices into the candidate array (n distinct indices when possible).
 */
export function spreadPick(cand: Float32Array, n: number, lloydIters = 6): Int32Array {
  const m = cand.length / 3
  const picks = new Int32Array(n)
  if (m === 0) return picks
  if (n >= m) {
    for (let i = 0; i < n; i++) picks[i] = i % m
    return picks
  }
  // Start from the candidate nearest the centroid (deterministic, symmetric-friendly).
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < m; i++) { cx += cand[i * 3]!; cy += cand[i * 3 + 1]!; cz += cand[i * 3 + 2]! }
  cx /= m; cy /= m; cz /= m
  let first = 0, bestD = Infinity
  for (let i = 0; i < m; i++) {
    const d = (cand[i * 3]! - cx) ** 2 + (cand[i * 3 + 1]! - cy) ** 2 + (cand[i * 3 + 2]! - cz) ** 2
    if (d < bestD) { bestD = d; first = i }
  }
  const minD = new Float64Array(m).fill(Infinity)
  let cur = first
  for (let k = 0; k < n; k++) {
    picks[k] = cur
    const x = cand[cur * 3]!, y = cand[cur * 3 + 1]!, z = cand[cur * 3 + 2]!
    let far = -1, farD = -1
    for (let i = 0; i < m; i++) {
      const dx = cand[i * 3]! - x, dy = cand[i * 3 + 1]! - y, dz = cand[i * 3 + 2]! - z
      const d = dx * dx + dy * dy + dz * dz
      if (d < minD[i]!) minD[i] = d
      if (minD[i]! > farD) { farD = minD[i]!; far = i }
    }
    cur = far
  }
  for (let it = 0; it < lloydIters; it++) lloydStep(cand, picks)
  repairSpacing(cand, picks, 4)
  return picks
}

/**
 * Raise the smallest gap. Lloyd relaxation evens out the average spacing,
 * but a formation's size is set by its closest pair: it has to grow until
 * that pair is safe. So, worst gaps first, each drone moves to the nearby
 * candidate (within one spacing) farthest from its neighbours — a local
 * version of farthest-point optimisation. Only moves that widen the drone's
 * own gap are kept, so the smallest gap never shrinks.
 */
export function repairSpacing(cand: Float32Array, picks: Int32Array, rounds: number): void {
  const m = cand.length / 3, n = picks.length
  if (n < 3 || m <= n) return
  const pos = new Float64Array(n * 3)
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++) pos[k * 3 + a] = cand[picks[k]! * 3 + a]!
  // Typical spacing: the median nearest-neighbour distance (brute force on a sample for big sets).
  const nn = (k: number, others: (j: number) => boolean) => {
    let best = Infinity
    for (let j = 0; j < n; j++) {
      if (j === k || !others(j)) continue
      const d = (pos[j * 3]! - pos[k * 3]!) ** 2 + (pos[j * 3 + 1]! - pos[k * 3 + 1]!) ** 2 + (pos[j * 3 + 2]! - pos[k * 3 + 2]!) ** 2
      if (d < best) best = d
    }
    return Math.sqrt(best)
  }
  const probe = Array.from({ length: Math.min(n, 64) }, (_, i) => Math.floor((i * n) / Math.min(n, 64)))
  const ds = probe.map((k) => nn(k, () => true)).sort((x, y) => x - y)
  const s = ds[Math.floor(ds.length / 2)]!
  if (!(s > 0)) return
  const cell = 1.5 * s
  const key = (a: number, b: number, c: number) => (a * 73856093) ^ (b * 19349663) ^ (c * 83492791)
  const ci = (v: number) => Math.floor(v / cell)
  const candGrid = new Map<number, number[]>()
  for (let i = 0; i < m; i++) {
    const kk = key(ci(cand[i * 3]!), ci(cand[i * 3 + 1]!), ci(cand[i * 3 + 2]!))
    const l = candGrid.get(kk)
    if (l) l.push(i)
    else candGrid.set(kk, [i])
  }
  const pickGrid = new Map<number, number[]>()
  const cellOfPick = new Int32Array(n * 3)
  const place = (k: number) => {
    const a = ci(pos[k * 3]!), b = ci(pos[k * 3 + 1]!), c = ci(pos[k * 3 + 2]!)
    cellOfPick[k * 3] = a; cellOfPick[k * 3 + 1] = b; cellOfPick[k * 3 + 2] = c
    const kk = key(a, b, c)
    const l = pickGrid.get(kk)
    if (l) l.push(k)
    else pickGrid.set(kk, [k])
  }
  const unplace = (k: number) => {
    const l = pickGrid.get(key(cellOfPick[k * 3]!, cellOfPick[k * 3 + 1]!, cellOfPick[k * 3 + 2]!))
    if (l) { const i = l.indexOf(k); if (i >= 0) l.splice(i, 1) }
  }
  for (let k = 0; k < n; k++) place(k)
  // Distance from (x, y, z) to the nearest pick other than k, capped at the grid reach.
  const gap = (x: number, y: number, z: number, k: number) => {
    const a = ci(x), b = ci(y), c = ci(z)
    let best = cell * cell
    for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
      const l = pickGrid.get(key(a + da, b + db, c + dc))
      if (!l) continue
      for (const j of l) {
        if (j === k) continue
        const d = (pos[j * 3]! - x) ** 2 + (pos[j * 3 + 1]! - y) ** 2 + (pos[j * 3 + 2]! - z) ** 2
        if (d < best) best = d
      }
    }
    return best
  }
  const used = new Set<number>(picks)
  for (let round = 0; round < rounds; round++) {
    const order = Array.from({ length: n }, (_, k) => k)
    const g0 = order.map((k) => gap(pos[k * 3]!, pos[k * 3 + 1]!, pos[k * 3 + 2]!, k))
    order.sort((x, y) => g0[x]! - g0[y]!)
    let moved = 0
    for (const k of order) {
      const x = pos[k * 3]!, y = pos[k * 3 + 1]!, z = pos[k * 3 + 2]!
      let best = gap(x, y, z, k), bestI = -1
      if (best >= cell * cell * 0.99) continue
      const a = ci(x), b = ci(y), c = ci(z)
      for (let da = -1; da <= 1; da++) for (let db = -1; db <= 1; db++) for (let dc = -1; dc <= 1; dc++) {
        const l = candGrid.get(key(a + da, b + db, c + dc))
        if (!l) continue
        for (const i of l) {
          if (used.has(i)) continue
          const cx = cand[i * 3]!, cy = cand[i * 3 + 1]!, cz = cand[i * 3 + 2]!
          if ((cx - x) ** 2 + (cy - y) ** 2 + (cz - z) ** 2 > s * s) continue
          const g = gap(cx, cy, cz, k)
          if (g > best * 1.0001) { best = g; bestI = i }
        }
      }
      if (bestI < 0) continue
      unplace(k)
      used.delete(picks[k]!)
      picks[k] = bestI
      used.add(bestI)
      pos[k * 3] = cand[bestI * 3]!; pos[k * 3 + 1] = cand[bestI * 3 + 1]!; pos[k * 3 + 2] = cand[bestI * 3 + 2]!
      place(k)
      moved++
    }
    if (!moved) break
  }
}

function lloydStep(cand: Float32Array, picks: Int32Array): void {
  const m = cand.length / 3, n = picks.length
  // Uniform grid over the current samples for nearest-sample queries.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < m; i++) {
    const x = cand[i * 3]!, y = cand[i * 3 + 1]!, z = cand[i * 3 + 2]!
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const ext = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9)
  const flat = maxZ - minZ < ext * 1e-6
  const cell = flat ? ext / Math.sqrt(n) : ext / Math.cbrt(n)
  const key = (a: number, b: number, c: number) => a * 1000003 + b * 1009 + c
  const grid = new Map<number, number[]>()
  const cellOf = (x: number, y: number, z: number): [number, number, number] => [
    Math.floor((x - minX) / cell), Math.floor((y - minY) / cell), Math.floor((z - minZ) / cell),
  ]
  for (let k = 0; k < n; k++) {
    const p = picks[k]!
    const [a, b, c] = cellOf(cand[p * 3]!, cand[p * 3 + 1]!, cand[p * 3 + 2]!)
    const kk = key(a, b, c)
    const arr = grid.get(kk)
    if (arr) arr.push(k)
    else grid.set(kk, [k])
  }
  const owner = new Int32Array(m)
  for (let i = 0; i < m; i++) {
    const x = cand[i * 3]!, y = cand[i * 3 + 1]!, z = cand[i * 3 + 2]!
    const [a, b, c] = cellOf(x, y, z)
    let best = -1, bestD = Infinity
    for (let r = 1; r < 64 && best < 0; r++) {
      const rz = flat ? 0 : r
      for (let da = -r; da <= r; da++)
        for (let db = -r; db <= r; db++)
          for (let dc = -rz; dc <= rz; dc++) {
            const arr = grid.get(key(a + da, b + db, c + dc))
            if (!arr) continue
            for (const k of arr) {
              const p = picks[k]!
              const d = (cand[p * 3]! - x) ** 2 + (cand[p * 3 + 1]! - y) ** 2 + (cand[p * 3 + 2]! - z) ** 2
              if (d < bestD) { bestD = d; best = k }
            }
          }
    }
    owner[i] = best
  }
  const sx = new Float64Array(n), sy = new Float64Array(n), sz = new Float64Array(n), cnt = new Int32Array(n)
  for (let i = 0; i < m; i++) {
    const k = owner[i]!
    if (k < 0) continue
    sx[k]! += cand[i * 3]!; sy[k]! += cand[i * 3 + 1]!; sz[k]! += cand[i * 3 + 2]!; cnt[k]!++
  }
  // Snap each centroid to the closest candidate it owns.
  const bestIdx = new Int32Array(n).fill(-1)
  const bestDist = new Float64Array(n).fill(Infinity)
  for (let i = 0; i < m; i++) {
    const k = owner[i]!
    if (k < 0 || cnt[k] === 0) continue
    const mx = sx[k]! / cnt[k]!, my = sy[k]! / cnt[k]!, mz = sz[k]! / cnt[k]!
    const d = (cand[i * 3]! - mx) ** 2 + (cand[i * 3 + 1]! - my) ** 2 + (cand[i * 3 + 2]! - mz) ** 2
    if (d < bestDist[k]!) { bestDist[k] = d; bestIdx[k] = i }
  }
  for (let k = 0; k < n; k++) if (bestIdx[k]! >= 0) picks[k] = bestIdx[k]!
}

/** Gather picked candidates into a packed xyz array. */
export function gather(cand: Float32Array, picks: Int32Array): Float32Array {
  const out = new Float32Array(picks.length * 3)
  for (let k = 0; k < picks.length; k++) {
    const p = picks[k]!
    out[k * 3] = cand[p * 3]!; out[k * 3 + 1] = cand[p * 3 + 1]!; out[k * 3 + 2] = cand[p * 3 + 2]!
  }
  return out
}

/** Sort points top-to-bottom, left-to-right so "order" effects read naturally. */
export function readingOrder(pts: Float32Array, rowHeight: number): Float32Array {
  const n = pts.length / 3
  const idx = Array.from({ length: n }, (_, i) => i)
  idx.sort((a, b) => {
    const ra = Math.round(-pts[a * 3 + 1]! / rowHeight), rb = Math.round(-pts[b * 3 + 1]! / rowHeight)
    return ra - rb || pts[a * 3]! - pts[b * 3]!
  })
  const out = new Float32Array(n * 3)
  idx.forEach((src, k) => {
    out[k * 3] = pts[src * 3]!; out[k * 3 + 1] = pts[src * 3 + 1]!; out[k * 3 + 2] = pts[src * 3 + 2]!
  })
  return out
}
