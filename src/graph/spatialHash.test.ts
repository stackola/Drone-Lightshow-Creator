import { describe, it, expect } from 'vitest'
import { computePairwiseMinDist } from './spatialHash'
import type { Vec3 } from './types'

function p(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

describe('computePairwiseMinDist', () => {
  it('returns 0 minDist for fewer than 2 points', () => {
    expect(computePairwiseMinDist([], 1)).toEqual({ minDist: 0, violations: 0 })
    expect(computePairwiseMinDist([p(0, 0, 0)], 1)).toEqual({ minDist: 0, violations: 0 })
  })

  it('two well-separated points: minDist sentinel is 0 (no close pairs); no violations', () => {
    // Spatial hash only checks pairs in neighbouring 2*minSpacing buckets.
    // Points farther apart than ~2*minSpacing don't get pairwise-checked and
    // the function returns the sentinel minDist=0 — its purpose is to detect
    // spacing violations, not to find the global closest pair.
    const r = computePairwiseMinDist([p(0, 0, 0), p(3, 4, 0)], 1)
    expect(r.minDist).toBeCloseTo(0)
    expect(r.violations).toBe(0)
  })

  it('two points within the spatial-hash neighbourhood: minDist is the Euclidean distance', () => {
    // 1.0 apart with minSpacing 1.0 → bucketSize 2.0 → both points share the
    // (0,0,0) bucket, so the pair is actually inspected.
    const r = computePairwiseMinDist([p(0, 0, 0), p(1.0, 0, 0)], 1.0)
    expect(r.minDist).toBeCloseTo(1.0)
    expect(r.violations).toBe(0)
  })

  it('counts a violation when a pair is closer than minSpacing', () => {
    const r = computePairwiseMinDist([p(0, 0, 0), p(0.5, 0, 0)], 1.5)
    expect(r.minDist).toBeCloseTo(0.5)
    expect(r.violations).toBe(1)
  })

  it('finds the closest pair among neighbours when other points are far away', () => {
    // (10,10,10) and (10.1,10,10) at distance 0.1 share a bucket; the other
    // two points are isolated and don't pair with anything close.
    const r = computePairwiseMinDist(
      [p(0, 0, 0), p(10, 10, 10), p(20, 0, 0), p(10.1, 10, 10)],
      1,
    )
    expect(r.minDist).toBeCloseTo(0.1)
    expect(r.violations).toBe(1)
  })

  it('finds the closest pair even when both points sit at the same coordinate', () => {
    const r = computePairwiseMinDist([p(5, 5, 5), p(5, 5, 5)], 0.5)
    expect(r.minDist).toBeCloseTo(0)
    expect(r.violations).toBe(1)
  })

  it('counts multiple violations independently', () => {
    // Three drones lined up at 0, 0.3, 0.6. With minSpacing 1.0:
    // pairs (0,0.3), (0.3,0.6), (0,0.6) → 3 violations.
    const r = computePairwiseMinDist([p(0, 0, 0), p(0.3, 0, 0), p(0.6, 0, 0)], 1.0)
    expect(r.violations).toBe(3)
    expect(r.minDist).toBeCloseTo(0.3)
  })

  it('handles a moderately large cloud without quadratic blowup (smoke test)', () => {
    // Place 200 points in a thin grid; spatial-hash should find the closest
    // pair (1.0) without taking forever.
    const points: Vec3[] = []
    for (let i = 0; i < 200; i++) points.push(p(i * 1.0, 0, 0))
    const start = Date.now()
    const r = computePairwiseMinDist(points, 1.5)
    const elapsed = Date.now() - start
    expect(r.minDist).toBeCloseTo(1.0)
    // All 199 adjacent pairs violate the 1.5m floor.
    expect(r.violations).toBe(199)
    // Generous budget (sparse layouts should be much faster).
    expect(elapsed).toBeLessThan(200)
  })
})
