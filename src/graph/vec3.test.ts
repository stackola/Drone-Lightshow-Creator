import { describe, it, expect } from 'vitest'
import {
  v3add, v3sub, v3scale, v3lerp, v3dist, v3distSq, v3len, v3normalize,
  v3cross, v3dot, v3lerpAngle, centroid,
} from './vec3'

describe('vec3', () => {
  it('v3add adds component-wise', () => {
    expect(v3add({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toEqual({ x: 5, y: 7, z: 9 })
  })

  it('v3sub subtracts component-wise', () => {
    expect(v3sub({ x: 4, y: 5, z: 6 }, { x: 1, y: 2, z: 3 })).toEqual({ x: 3, y: 3, z: 3 })
  })

  it('v3scale multiplies all components by the scalar', () => {
    expect(v3scale({ x: 1, y: 2, z: 3 }, 2)).toEqual({ x: 2, y: 4, z: 6 })
    expect(v3scale({ x: 1, y: 2, z: 3 }, 0)).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('v3lerp interpolates at t=0, 0.5, 1', () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 10, y: 20, z: 30 }
    expect(v3lerp(a, b, 0)).toEqual(a)
    expect(v3lerp(a, b, 1)).toEqual(b)
    const mid = v3lerp(a, b, 0.5)
    expect(mid.x).toBeCloseTo(5)
    expect(mid.y).toBeCloseTo(10)
    expect(mid.z).toBeCloseTo(15)
  })

  it('v3dist + v3distSq agree on magnitude', () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 3, y: 4, z: 0 }
    expect(v3dist(a, b)).toBeCloseTo(5)
    expect(v3distSq(a, b)).toBeCloseTo(25)
  })

  it('v3len matches distance from origin', () => {
    expect(v3len({ x: 3, y: 4, z: 0 })).toBeCloseTo(5)
    expect(v3len({ x: 0, y: 0, z: 0 })).toBeCloseTo(0)
  })

  it('v3normalize returns unit-length vector', () => {
    const n = v3normalize({ x: 3, y: 4, z: 0 })
    expect(v3len(n)).toBeCloseTo(1)
    expect(n.x).toBeCloseTo(0.6)
    expect(n.y).toBeCloseTo(0.8)
  })

  it('v3normalize falls back to +Z for zero vector', () => {
    expect(v3normalize({ x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('v3cross is anti-commutative', () => {
    const a = { x: 1, y: 0, z: 0 }
    const b = { x: 0, y: 1, z: 0 }
    expect(v3cross(a, b)).toEqual({ x: 0, y: 0, z: 1 })
    expect(v3cross(b, a)).toEqual({ x: 0, y: 0, z: -1 })
  })

  it('v3dot follows the standard inner-product math', () => {
    expect(v3dot({ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 })).toBe(32) // 4+10+18
    expect(v3dot({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBe(0)
  })

  it('v3lerpAngle picks the shortest arc through PI', () => {
    // a.y = -3.0, b.y = 3.0. The "direct" delta is 6 rad; the wrapped delta
    // is 6 - 2π ≈ -0.283 rad. At t=0.5 the result should be near -3 + (-0.283/2) ≈ -3.142.
    const a = { x: 0, y: -3.0, z: 0 }
    const b = { x: 0, y: 3.0, z: 0 }
    const mid = v3lerpAngle(a, b, 0.5)
    // The midpoint should wrap to ~ -π (i.e. very close to -3.14159), not 0.
    expect(Math.abs(mid.y)).toBeGreaterThan(3.0)
  })

  it('centroid averages a list of points', () => {
    expect(centroid([{ x: 0, y: 0, z: 0 }, { x: 10, y: 20, z: 30 }])).toEqual({ x: 5, y: 10, z: 15 })
  })

  it('centroid of empty list returns origin', () => {
    expect(centroid([])).toEqual({ x: 0, y: 0, z: 0 })
  })
})
