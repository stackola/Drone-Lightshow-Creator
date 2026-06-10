import { describe, it, expect } from 'vitest'
import { snapToPlane, toLocal, fromLocal } from './snapPlane'

describe('snapPlane', () => {
  it('round-trips through local with identity plane', () => {
    const p = { x: 1.7, y: 2.3, z: -0.9 }
    const round = fromLocal(toLocal(p, { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } }), { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } })
    expect(round.x).toBeCloseTo(p.x)
    expect(round.y).toBeCloseTo(p.y)
    expect(round.z).toBeCloseTo(p.z)
  })

  it('snaps to identity XY plane', () => {
    const plane = { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } }
    const snapped = snapToPlane({ x: 1.3, y: -0.4, z: 5 }, plane, 1)
    expect(snapped.x).toBeCloseTo(1)
    expect(snapped.y).toBeCloseTo(0)
    expect(snapped.z).toBeCloseTo(0)
  })

  it('snaps onto a plane rotated 90° around X (now XZ)', () => {
    const plane = { position: { x: 0, y: 0, z: 0 }, rotationDeg: { x: 90, y: 0, z: 0 } }
    const snapped = snapToPlane({ x: 2.4, y: 5, z: -0.3 }, plane, 1)
    // After 90° X-rotation the plane local Y becomes world Z; z=0 in plane-local
    // maps to y=0 in world.
    expect(snapped.x).toBeCloseTo(2)
    expect(snapped.y).toBeCloseTo(0)
  })

  it('respects plane translation', () => {
    const plane = { position: { x: 5, y: 0, z: 0 }, rotationDeg: { x: 0, y: 0, z: 0 } }
    const snapped = snapToPlane({ x: 6.4, y: 0, z: 2 }, plane, 1)
    // Local x of (6.4-5)=1.4 → 1, mapped back → 6
    expect(snapped.x).toBeCloseTo(6)
  })
})
