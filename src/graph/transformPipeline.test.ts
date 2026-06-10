// S3-08: Transform pipeline tests — centroid scaling, angle wrapping, applyTransform
import { describe, it, expect } from 'vitest'
import { applyTransform, applyTransformWithPivot } from './interpolateTransform'
import { v3lerpAngle } from './vec3'
import type { Transform3D } from './types'

const IDENTITY_TRANSFORM: Transform3D = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

describe('applyTransform — scale relative to origin', () => {
  it('scaling at origin preserves origin points', () => {
    const t: Transform3D = { ...IDENTITY_TRANSFORM, scale: { x: 2, y: 2, z: 2 } }
    const result = applyTransform({ x: 0, y: 0, z: 0 }, t)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(0)
  })

  it('scaling moves points away from origin', () => {
    const t: Transform3D = { ...IDENTITY_TRANSFORM, scale: { x: 2, y: 2, z: 2 }, position: { x: 10, y: 0, z: 0 } }
    const result = applyTransform({ x: 5, y: 0, z: 0 }, t)
    // 5*2 + 10 = 20
    expect(result.x).toBeCloseTo(20)
  })
})

describe('applyTransformWithPivot — centroid-relative scaling', () => {
  it('scaling around a pivot preserves the pivot point', () => {
    const t: Transform3D = { ...IDENTITY_TRANSFORM, scale: { x: 2, y: 2, z: 2 }, position: { x: 0, y: 0, z: 0 } }
    const pivot = { x: 5, y: 5, z: 5 }
    const result = applyTransformWithPivot({ x: 5, y: 5, z: 5 }, t, pivot)
    // At pivot, offset is 0, scaled is 0, result = position
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(0)
  })

  it('scaling around pivot expands points symmetrically', () => {
    const t: Transform3D = { ...IDENTITY_TRANSFORM, scale: { x: 2, y: 1, z: 1 } }
    const pivot = { x: 5, y: 0, z: 0 }
    const p1 = applyTransformWithPivot({ x: 3, y: 0, z: 0 }, t, pivot)
    const p2 = applyTransformWithPivot({ x: 7, y: 0, z: 0 }, t, pivot)
    // offset from pivot: -2 and +2, scaled: -4 and +4
    expect(p1.x).toBeCloseTo(-4) // -4 + 0(position) = -4
    expect(p2.x).toBeCloseTo(4)  //  4 + 0(position) = 4
    // Equidistant from 0 (the position)
    expect(Math.abs(p1.x)).toBeCloseTo(Math.abs(p2.x))
  })
})

describe('v3lerpAngle — shortest-arc rotation interpolation', () => {
  it('interpolates linearly for small angles', () => {
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 1, y: 0, z: 0 }
    const mid = v3lerpAngle(a, b, 0.5)
    expect(mid.x).toBeCloseTo(0.5)
  })

  it('takes the short path from 350° to 10° (via 0°)', () => {
    const deg2rad = Math.PI / 180
    const a = { x: 0, y: 350 * deg2rad, z: 0 }
    const b = { x: 0, y: 10 * deg2rad, z: 0 }
    const mid = v3lerpAngle(a, b, 0.5)
    // Short path: 350 → 360/0 → 10, midpoint should be around 0° (360°)
    const midDeg = (mid.y * 180 / Math.PI + 360) % 360
    expect(midDeg).toBeCloseTo(0, 0) // within 1 degree of 0
  })

  it('does NOT go through 180° for near-wraparound angles', () => {
    const deg2rad = Math.PI / 180
    const a = { x: 0, y: 350 * deg2rad, z: 0 }
    const b = { x: 0, y: 10 * deg2rad, z: 0 }
    const mid = v3lerpAngle(a, b, 0.5)
    // Should NOT be near 180°
    const midDeg = (mid.y * 180 / Math.PI + 360) % 360
    expect(Math.abs(midDeg - 180)).toBeGreaterThan(90)
  })

  it('handles negative-to-positive wrapping', () => {
    const a = { x: -0.1, y: 0, z: 0 }
    const b = { x: 0.1, y: 0, z: 0 }
    const mid = v3lerpAngle(a, b, 0.5)
    expect(mid.x).toBeCloseTo(0)
  })
})

describe('applyTransform — rotation order XYZ', () => {
  it('applies X rotation correctly', () => {
    const t: Transform3D = { ...IDENTITY_TRANSFORM, rotation: { x: Math.PI / 2, y: 0, z: 0 } }
    // Rotate (0, 1, 0) by 90° around X → (0, 0, 1)
    const result = applyTransform({ x: 0, y: 1, z: 0 }, t)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(1)
  })

  it('applies Y rotation correctly', () => {
    const t: Transform3D = { ...IDENTITY_TRANSFORM, rotation: { x: 0, y: Math.PI / 2, z: 0 } }
    // Rotate (1, 0, 0) by 90° around Y → (0, 0, -1)
    const result = applyTransform({ x: 1, y: 0, z: 0 }, t)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(-1)
  })

  it('scale + rotate + translate compose correctly', () => {
    const t: Transform3D = {
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 1, z: 1 },
    }
    const result = applyTransform({ x: 3, y: 0, z: 0 }, t)
    // Scale: 3*2=6, Rotate: none, Translate: +10 → 16
    expect(result.x).toBeCloseTo(16)
  })
})
