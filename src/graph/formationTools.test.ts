import { describe, it, expect } from 'vitest'
import { applyJitter, mirrorFormation, scaleToFit, applyDensityFalloff } from './formationTools'
import type { Vec3 } from './types'

describe('applyJitter', () => {
  const points: Vec3[] = [
    { x: 0, y: 0, z: 0 },
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 2, z: 2 },
  ]

  it('changes point positions when amplitude > 0', () => {
    const jittered = applyJitter(points, 1)
    const anyDifferent = jittered.some(
      (p, i) => p.x !== points[i]!.x || p.y !== points[i]!.y || p.z !== points[i]!.z,
    )
    expect(anyDifferent).toBe(true)
  })

  it('with amplitude 0 returns unchanged points', () => {
    const jittered = applyJitter(points, 0)
    for (let i = 0; i < points.length; i++) {
      expect(jittered[i]!.x).toBeCloseTo(points[i]!.x)
      expect(jittered[i]!.y).toBeCloseTo(points[i]!.y)
      expect(jittered[i]!.z).toBeCloseTo(points[i]!.z)
    }
  })
})

describe('mirrorFormation', () => {
  it('on X axis negates x coordinates in mirrored portion', () => {
    const points: Vec3[] = [{ x: 5, y: 1, z: 2 }]
    const result = mirrorFormation(points, 'x')
    // Should contain the original point and the mirrored point
    expect(result.some((p) => p.x === 5)).toBe(true)
    expect(result.some((p) => p.x === -5)).toBe(true)
  })

  it('combines original + mirrored with deduplication', () => {
    // A point on the mirror plane (x=0) should not duplicate
    const points: Vec3[] = [
      { x: 0, y: 1, z: 1 },
      { x: 3, y: 1, z: 1 },
    ]
    const result = mirrorFormation(points, 'x')
    // x=0 stays the same when mirrored, so should be deduplicated
    // x=3 mirrors to x=-3
    expect(result.length).toBe(3) // {0,1,1}, {3,1,1}, {-3,1,1}
  })
})

describe('scaleToFit', () => {
  it('returns correct number of points', () => {
    const points: Vec3[] = Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: i * 0.5,
      z: 0,
    }))
    const result = scaleToFit(points, 10, 2)
    expect(result.length).toBe(10)
  })

  it('returns empty for empty input', () => {
    expect(scaleToFit([], 10, 2)).toEqual([])
  })
})

describe('applyDensityFalloff', () => {
  it('with center-dense returns a subset of points', () => {
    const points: Vec3[] = Array.from({ length: 50 }, (_, i) => ({
      x: (i - 25) * 0.5,
      y: 0,
      z: 0,
    }))
    const result = applyDensityFalloff(points, 20, 'center-dense')
    expect(result.length).toBe(20)
    // Center-dense: points closer to center should be favored
    // The average |x| of the result should be less than the average |x| of all points
    const avgAbsX = result.reduce((s, p) => s + Math.abs(p.x), 0) / result.length
    const allAvgAbsX = points.reduce((s, p) => s + Math.abs(p.x), 0) / points.length
    expect(avgAbsX).toBeLessThan(allAvgAbsX)
  })

  it('with none returns first targetCount points', () => {
    const points: Vec3[] = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 0 }))
    const result = applyDensityFalloff(points, 5, 'none')
    expect(result.length).toBe(5)
  })
})
