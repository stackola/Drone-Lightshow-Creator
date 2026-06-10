import { describe, it, expect } from 'vitest'
import { interpolateTransform, applyTransform } from './interpolateTransform'
import type { Transform3D, TransformKeyframe } from './types'

const BASE: Transform3D = {
  position: { x: 0, y: 10, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

describe('interpolateTransform', () => {
  it('returns base when no keyframes', () => {
    const result = interpolateTransform(BASE, [], 3)
    expect(result).toEqual(BASE)
  })

  it('returns base at t=0 with a keyframe at t>0', () => {
    const kfs: TransformKeyframe[] = [{
      time: 5,
      transform: { position: { x: 10, y: 20, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
      easing: 'linear',
    }]
    const result = interpolateTransform(BASE, kfs, 0)
    expect(result.position.x).toBeCloseTo(0)
    expect(result.position.y).toBeCloseTo(10)
    expect(result.scale.x).toBeCloseTo(1)
  })

  it('lerps linearly between base and first keyframe', () => {
    const kfs: TransformKeyframe[] = [{
      time: 4,
      transform: { position: { x: 8, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      easing: 'linear',
    }]
    // At t=2 (midpoint) should be halfway
    const result = interpolateTransform(BASE, kfs, 2)
    expect(result.position.x).toBeCloseTo(4)
  })

  it('holds last keyframe value after its time', () => {
    const kfs: TransformKeyframe[] = [{
      time: 2,
      transform: { position: { x: 5, y: 15, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      easing: 'linear',
    }]
    const result = interpolateTransform(BASE, kfs, 10)
    expect(result.position.x).toBeCloseTo(5)
    expect(result.position.y).toBeCloseTo(15)
  })

  it('interpolates between two keyframes', () => {
    const kfs: TransformKeyframe[] = [
      {
        time: 2,
        transform: { position: { x: 4, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        easing: 'linear',
      },
      {
        time: 6,
        transform: { position: { x: 12, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        easing: 'linear',
      },
    ]
    // At t=4 (midpoint of kf1-kf2)
    const result = interpolateTransform(BASE, kfs, 4)
    expect(result.position.x).toBeCloseTo(8)
  })

  it('applies ease-in easing', () => {
    const kfs: TransformKeyframe[] = [{
      time: 4,
      transform: { position: { x: 10, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      easing: 'ease-in',
    }]
    // At t=2 (50% linear), ease-in: 0.5^2 = 0.25
    const result = interpolateTransform(BASE, kfs, 2)
    expect(result.position.x).toBeCloseTo(2.5)
  })

  it('applies ease-out easing', () => {
    const kfs: TransformKeyframe[] = [{
      time: 4,
      transform: { position: { x: 10, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      easing: 'ease-out',
    }]
    // At t=2 (50% linear), ease-out: 1 - (1-0.5)^2 = 0.75
    const result = interpolateTransform(BASE, kfs, 2)
    expect(result.position.x).toBeCloseTo(7.5)
  })

  it('interpolates scale correctly', () => {
    const kfs: TransformKeyframe[] = [{
      time: 4,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 3, z: 3 } },
      easing: 'linear',
    }]
    const result = interpolateTransform(BASE, kfs, 2)
    expect(result.scale.x).toBeCloseTo(2)
    expect(result.scale.y).toBeCloseTo(2)
  })

  it('interpolates rotation correctly', () => {
    const kfs: TransformKeyframe[] = [{
      time: 4,
      transform: { position: { x: 0, y: 10, z: 0 }, rotation: { x: 0, y: Math.PI, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
      easing: 'linear',
    }]
    const result = interpolateTransform(BASE, kfs, 2)
    expect(result.rotation.y).toBeCloseTo(Math.PI / 2)
  })

  it('handles keyframe at t=0 (replaces base)', () => {
    const kfs: TransformKeyframe[] = [{
      time: 0,
      transform: { position: { x: 5, y: 5, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 } },
      easing: 'linear',
    }]
    const result = interpolateTransform(BASE, kfs, 0)
    expect(result.position.x).toBeCloseTo(5)
    expect(result.scale.x).toBeCloseTo(2)
  })

  it('handles three keyframes correctly', () => {
    const kfs: TransformKeyframe[] = [
      { time: 1, transform: { position: { x: 2, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, easing: 'linear' },
      { time: 3, transform: { position: { x: 6, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, easing: 'linear' },
      { time: 5, transform: { position: { x: 2, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, easing: 'linear' },
    ]
    // At t=2 (midpoint of kf0-kf1)
    const r2 = interpolateTransform(BASE, kfs, 2)
    expect(r2.position.x).toBeCloseTo(4)
    // At t=4 (midpoint of kf1-kf2) — goes back
    const r4 = interpolateTransform(BASE, kfs, 4)
    expect(r4.position.x).toBeCloseTo(4)
  })
})

describe('applyTransform', () => {
  it('applies translation', () => {
    const t: Transform3D = {
      position: { x: 5, y: 10, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
    const result = applyTransform({ x: 1, y: 2, z: 3 }, t)
    expect(result.x).toBeCloseTo(6)
    expect(result.y).toBeCloseTo(12)
    expect(result.z).toBeCloseTo(6)
  })

  it('applies scale', () => {
    const t: Transform3D = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 2, y: 3, z: 0.5 },
    }
    const result = applyTransform({ x: 1, y: 1, z: 1 }, t)
    expect(result.x).toBeCloseTo(2)
    expect(result.y).toBeCloseTo(3)
    expect(result.z).toBeCloseTo(0.5)
  })

  it('applies Y rotation (90 deg)', () => {
    const t: Transform3D = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    }
    // (1,0,0) rotated 90° around Y → (0,0,-1)
    const result = applyTransform({ x: 1, y: 0, z: 0 }, t)
    expect(result.x).toBeCloseTo(0)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(-1)
  })

  it('applies scale + rotation + translation together', () => {
    const t: Transform3D = {
      position: { x: 10, y: 0, z: 0 },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      scale: { x: 2, y: 1, z: 1 },
    }
    // (1,0,0) → scale → (2,0,0) → rotY 90° → (0,0,-2) → translate → (10,0,-2)
    const result = applyTransform({ x: 1, y: 0, z: 0 }, t)
    expect(result.x).toBeCloseTo(10)
    expect(result.y).toBeCloseTo(0)
    expect(result.z).toBeCloseTo(-2)
  })
})
