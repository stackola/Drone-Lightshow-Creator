// ============================================================================
// Tests for Ant Trail Transition (via registry)
// ============================================================================

import { describe, it, expect } from 'vitest'
import { getTransition } from './transitions'
import type { TransitionConstraints } from './transitions'
import type { Vec3 } from '../graph/types'

// Ensure transitions are registered
import './transitions'

function makeGrid(count: number, spacing: number, y: number): Vec3[] {
  const cols = Math.ceil(Math.sqrt(count))
  const pts: Vec3[] = []
  for (let i = 0; i < count; i++) {
    pts.push({
      x: (i % cols - (cols - 1) / 2) * spacing,
      y,
      z: (Math.floor(i / cols) - (Math.ceil(count / cols) - 1) / 2) * spacing,
    })
  }
  return pts
}

function makeRing(count: number, radius: number, y: number): Vec3[] {
  const pts: Vec3[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    pts.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius })
  }
  return pts
}

function dist(a: Vec3, b: Vec3): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

describe('Ant Trail — Registry Integration', () => {
  const antWalk = getTransition('ant-walk')!

  it('is registered', () => {
    expect(antWalk).toBeDefined()
    expect(antWalk.id).toBe('ant-walk')
    expect(antWalk.name).toBe('Ant Trail')
  })

  it('has computeMinDuration method', () => {
    expect(antWalk.computeMinDuration).toBeDefined()
  })

  describe('computeMinDuration', () => {
    const constraints: TransitionConstraints = {
      maxVelocity: 8,
      maxAcceleration: 4,
      minSpacing: 1.0,
      motionSpacing: 0.5,
    }

    it('returns 0 for empty mapping', () => {
      const dur = antWalk.computeMinDuration!([], [], [], {}, constraints)
      expect(dur).toBe(0)
    })

    it('returns positive duration for a real transition', () => {
      const from = makeGrid(20, 2, 10)
      const to = makeRing(20, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const dur = antWalk.computeMinDuration!(mapping, from, to, { laneCount: 2, arcHeight: 5, laneSpread: 8 }, constraints)
      expect(dur).toBeGreaterThan(0)
    })

    it('more drones → longer duration (due to convoy stagger)', () => {
      const from10 = makeGrid(10, 2, 10)
      const to10 = makeRing(10, 8, 15)
      const map10 = from10.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const from50 = makeGrid(50, 2, 10)
      const to50 = makeRing(50, 8, 15)
      const map50 = from50.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const params = { laneCount: 2, arcHeight: 5, laneSpread: 8 }
      const dur10 = antWalk.computeMinDuration!(map10, from10, to10, params, constraints)
      const dur50 = antWalk.computeMinDuration!(map50, from50, to50, params, constraints)

      expect(dur50).toBeGreaterThanOrEqual(dur10)
    })

    it('more lanes → shorter or equal duration', () => {
      const from = makeGrid(40, 2, 10)
      const to = makeRing(40, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const dur2 = antWalk.computeMinDuration!(mapping, from, to, { laneCount: 2, arcHeight: 5, laneSpread: 8 }, constraints)
      const dur4 = antWalk.computeMinDuration!(mapping, from, to, { laneCount: 4, arcHeight: 5, laneSpread: 8 }, constraints)

      expect(dur4).toBeLessThanOrEqual(dur2)
    })

    it('lower trailSpeed → longer duration', () => {
      const from = makeGrid(20, 2, 10)
      const to = makeRing(20, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const durFast = antWalk.computeMinDuration!(mapping, from, to, { laneCount: 2, arcHeight: 5, laneSpread: 8, trailSpeed: 10 }, constraints)
      const durSlow = antWalk.computeMinDuration!(mapping, from, to, { laneCount: 2, arcHeight: 5, laneSpread: 8, trailSpeed: 3 }, constraints)

      expect(durSlow).toBeGreaterThanOrEqual(durFast)
    })
  })

  describe('interpolate — path-constrained motion', () => {
    it('returns source positions at t=0', () => {
      const from = makeGrid(10, 2, 10)
      const to = makeRing(10, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const result = antWalk.interpolate(mapping, from, to, 0, { laneCount: 2, arcHeight: 5, laneSpread: 8, _totalDuration: 20 })
      expect(result).toHaveLength(10)

      for (let i = 0; i < result.length; i++) {
        expect(dist(result[i]!, from[i]!)).toBeLessThan(0.01)
      }
    })

    it('returns target positions at t=1', () => {
      const from = makeGrid(10, 2, 10)
      const to = makeRing(10, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const result = antWalk.interpolate(mapping, from, to, 1, { laneCount: 2, arcHeight: 5, laneSpread: 8, _totalDuration: 60 })
      expect(result).toHaveLength(10)

      for (let i = 0; i < result.length; i++) {
        expect(dist(result[i]!, to[i]!)).toBeLessThan(0.01)
      }
    })

    it('drones are in intermediate positions at t=0.5', () => {
      const from = makeGrid(10, 2, 10)
      const to = makeRing(10, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))

      const result = antWalk.interpolate(mapping, from, to, 0.5, { laneCount: 2, arcHeight: 5, laneSpread: 8, _totalDuration: 30 })
      expect(result).toHaveLength(10)

      let movedCount = 0
      for (let i = 0; i < result.length; i++) {
        if (dist(result[i]!, from[i]!) > 0.5) movedCount++
      }
      expect(movedCount).toBeGreaterThan(0)
    })

    it('handles single drone', () => {
      const from = [{ x: 0, y: 10, z: 0 }]
      const to = [{ x: 20, y: 15, z: 0 }]
      const mapping = [{ sourceIndex: 0, targetIndex: 0 }]

      const result = antWalk.interpolate(mapping, from, to, 0.5, { laneCount: 1, arcHeight: 5, laneSpread: 0, _totalDuration: 10 })
      expect(result).toHaveLength(1)
      expect(result[0]!.y).toBeGreaterThanOrEqual(10)
    })

    it('handles empty mapping', () => {
      const result = antWalk.interpolate([], [], [], 0.5, { _totalDuration: 10 })
      expect(result).toHaveLength(0)
    })

    it('deterministic across calls', () => {
      const from = makeGrid(10, 2, 10)
      const to = makeRing(10, 8, 15)
      const mapping = from.map((_, i) => ({ sourceIndex: i, targetIndex: i }))
      const params = { laneCount: 2, arcHeight: 5, laneSpread: 8, _totalDuration: 20 }

      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const a = antWalk.interpolate(mapping, from, to, t, params)
        const b = antWalk.interpolate(mapping, from, to, t, params)
        expect(JSON.stringify(a)).toBe(JSON.stringify(b))
      }
    })
  })
})
