import type { Vec3 } from './types'

export const DEG = Math.PI / 180

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Round up to a multiple of `step`, tolerant of floating-point noise. */
export function ceilTo(v: number, step: number): number {
  return Math.ceil(v / step - 1e-9) * step
}

export function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step
}

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable per-index hash in [0, 1). */
export function hash01(i: number, salt = 0): number {
  let h = (i * 374761393 + salt * 668265263) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** FNV-1a over the bytes of any typed array; used for cache keys. */
export function hashArray(arr: ArrayBufferView, seed = 2166136261): number {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let h = seed >>> 0
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function hashString(s: string, seed = 2166136261): number {
  let h = seed >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * Row-major 3×3 rotation matrix for Euler angles in degrees, applied in
 * X, then Y, then Z order (R = Rz · Ry · Rx).
 */
export function rotationMatrix(deg: Vec3): number[] {
  const [ax, ay, az] = [deg[0] * DEG, deg[1] * DEG, deg[2] * DEG]
  const cx = Math.cos(ax), sx = Math.sin(ax)
  const cy = Math.cos(ay), sy = Math.sin(ay)
  const cz = Math.cos(az), sz = Math.sin(az)
  // Rz * Ry * Rx
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ]
}

export function isIdentityRotation(deg: Vec3): boolean {
  return deg[0] === 0 && deg[1] === 0 && deg[2] === 0
}

/** In-place: p ← M·p + t for a packed xyz array. */
export function transformPoints(pts: Float32Array, m: number[] | null, t: Vec3): void {
  for (let i = 0; i < pts.length; i += 3) {
    let x = pts[i]!, y = pts[i + 1]!, z = pts[i + 2]!
    if (m) {
      const nx = m[0]! * x + m[1]! * y + m[2]! * z
      const ny = m[3]! * x + m[4]! * y + m[5]! * z
      const nz = m[6]! * x + m[7]! * y + m[8]! * z
      x = nx; y = ny; z = nz
    }
    pts[i] = x + t[0]
    pts[i + 1] = y + t[1]
    pts[i + 2] = z + t[2]
  }
}

/** Smallest distance between any two points (O(n log n)-ish via a grid). */
export function minPairDistance(pts: Float32Array): number {
  const n = pts.length / 3
  if (n < 2) return Infinity
  // Bounding box
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (let i = 0; i < n; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6)
  // Cell size ~ expected spacing; refine with a brute-force fallback for small n.
  if (n <= 400) {
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const xi = pts[i * 3]!, yi = pts[i * 3 + 1]!, zi = pts[i * 3 + 2]!
      for (let j = i + 1; j < n; j++) {
        const dx = xi - pts[j * 3]!, dy = yi - pts[j * 3 + 1]!, dz = zi - pts[j * 3 + 2]!
        const d = dx * dx + dy * dy + dz * dz
        if (d < best) best = d
      }
    }
    return Math.sqrt(best)
  }
  let cell = extent / Math.cbrt(n)
  for (;;) {
    const grid = new Map<number, number[]>()
    const key = (cx: number, cy: number, cz: number) => (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)
    let best = Infinity
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3]!, y = pts[i * 3 + 1]!, z = pts[i * 3 + 2]!
      const cx = Math.floor((x - minX) / cell), cy = Math.floor((y - minY) / cell), cz = Math.floor((z - minZ) / cell)
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++)
          for (let oz = -1; oz <= 1; oz++) {
            const bucket = grid.get(key(cx + ox, cy + oy, cz + oz))
            if (!bucket) continue
            for (const j of bucket) {
              const dx = x - pts[j * 3]!, dy = y - pts[j * 3 + 1]!, dz = z - pts[j * 3 + 2]!
              const d = dx * dx + dy * dy + dz * dz
              if (d < best) best = d
            }
          }
      const k = key(cx, cy, cz)
      const b = grid.get(k)
      if (b) b.push(i)
      else grid.set(k, [i])
    }
    // Valid only if the nearest pair is guaranteed to be within one cell.
    if (Math.sqrt(best) <= cell) return Math.sqrt(best)
    cell *= 2
  }
}

export function centroid(pts: Float32Array): Vec3 {
  const n = pts.length / 3
  let x = 0, y = 0, z = 0
  for (let i = 0; i < pts.length; i += 3) {
    x += pts[i]!; y += pts[i + 1]!; z += pts[i + 2]!
  }
  return n ? [x / n, y / n, z / n] : [0, 0, 0]
}
