// ============================================================================
// Spatial hash for pairwise spacing checks at a single timestep.
// Shared by bakeWorker.resolveCollisions and the per-frame validation path.
// ============================================================================

import type { Vec3 } from './types'

export interface PairwiseMinDistResult {
  minDist: number
  violations: number
}

/**
 * For an array of points, compute the closest pair distance (and count of pairs
 * closer than minSpacing) using a uniform spatial hash. O(N) for sparse layouts,
 * O(N²) worst case when all points cluster in the same bucket.
 */
export function computePairwiseMinDist(points: Vec3[], minSpacing: number): PairwiseMinDistResult {
  const result: PairwiseMinDistResult = { minDist: Infinity, violations: 0 }
  if (points.length < 2) {
    result.minDist = 0
    return result
  }

  const bucketSize = Math.max(0.1, minSpacing * 2)
  const buckets = new Map<string, number[]>()
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const key = `${Math.floor(p.x / bucketSize)},${Math.floor(p.y / bucketSize)},${Math.floor(p.z / bucketSize)}`
    let bucket = buckets.get(key)
    if (!bucket) { bucket = []; buckets.set(key, bucket) }
    bucket.push(i)
  }

  const checkedPairs = new Set<number>()
  const encode = (a: number, b: number): number => (a < b ? a * points.length + b : b * points.length + a)

  for (let i = 0; i < points.length; i++) {
    const p = points[i]!
    const bx = Math.floor(p.x / bucketSize)
    const by = Math.floor(p.y / bucketSize)
    const bz = Math.floor(p.z / bucketSize)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const neighbors = buckets.get(`${bx + dx},${by + dy},${bz + dz}`)
          if (!neighbors) continue
          for (const j of neighbors) {
            if (j <= i) continue
            const key = encode(i, j)
            if (checkedPairs.has(key)) continue
            checkedPairs.add(key)
            const q = points[j]!
            const ddx = p.x - q.x, ddy = p.y - q.y, ddz = p.z - q.z
            const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz)
            if (dist < result.minDist) result.minDist = dist
            if (dist < minSpacing) result.violations++
          }
        }
      }
    }
  }

  if (result.minDist === Infinity) result.minDist = 0
  return result
}
