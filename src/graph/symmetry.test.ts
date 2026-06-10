import { describe, it, expect } from 'vitest'
import { buildSymmetryPairs, applySymmetricEdit, addSymmetricPoint, reflectAxis } from './symmetry'
import type { Vec3, SymmetryConfig } from './types'

const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }

describe('reflectAxis', () => {
  it('mirrors along x', () => {
    expect(reflectAxis({ x: 3, y: 1, z: 2 }, ORIGIN, 'x')).toEqual({ x: -3, y: 1, z: 2 })
  })
  it('mirrors along y', () => {
    expect(reflectAxis({ x: 3, y: 1, z: 2 }, ORIGIN, 'y')).toEqual({ x: 3, y: -1, z: 2 })
  })
  it('mirrors along z', () => {
    expect(reflectAxis({ x: 3, y: 1, z: 2 }, ORIGIN, 'z')).toEqual({ x: 3, y: 1, z: -2 })
  })
})

describe('buildSymmetryPairs', () => {
  it('pairs all points across X for a symmetric ring', () => {
    const pts: Vec3[] = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      pts.push({ x: Math.cos(a) * 5, y: 5, z: Math.sin(a) * 5 })
    }
    const pairs = buildSymmetryPairs(pts, 'x', ORIGIN, 0.001)
    // 2 on-plane (90° and 270°) + 3 pairs = 5 entries
    const solos = pairs.filter((p) => p.length === 1)
    const duos = pairs.filter((p) => p.length === 2)
    expect(solos.length + duos.length * 2).toBe(pts.length)
  })

  it('locks on-plane points to solos', () => {
    const pts: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
      { x: -3, y: 0, z: 0 },
    ]
    const pairs = buildSymmetryPairs(pts, 'x', ORIGIN, 0.05)
    const solos = pairs.filter((p) => p.length === 1)
    expect(solos.length).toBe(1)
  })
})

describe('applySymmetricEdit', () => {
  const pts: Vec3[] = [
    { x: 2, y: 1, z: 0 },
    { x: -2, y: 1, z: 0 },
  ]
  const cfg: SymmetryConfig = {
    axis: 'x',
    plane: ORIGIN,
    pairs: [[0, 1]],
    epsilon: 0.05,
  }

  it('mirrors a single-sided edit', () => {
    const out = applySymmetricEdit(pts, cfg, new Map([[0, { x: 4, y: 2, z: 0 }]]))
    expect(out[0]).toEqual({ x: 4, y: 2, z: 0 })
    expect(out[1]).toEqual({ x: -4, y: 2, z: 0 })
  })

  it('clamps on-plane solos to the plane', () => {
    const single: Vec3[] = [{ x: 0, y: 5, z: 0 }]
    const cfg2: SymmetryConfig = { axis: 'x', plane: ORIGIN, pairs: [[0]], epsilon: 0.05 }
    const out = applySymmetricEdit(single, cfg2, new Map([[0, { x: 7, y: 6, z: 0 }]]))
    expect(out[0]).toEqual({ x: 0, y: 6, z: 0 })
  })
})

describe('addSymmetricPoint', () => {
  it('adds 2 points off-plane and extends pairs', () => {
    const cfg: SymmetryConfig = { axis: 'x', plane: ORIGIN, pairs: [], epsilon: 0.05 }
    const r = addSymmetricPoint([], cfg, { x: 3, y: 1, z: 0 })
    expect(r.points.length).toBe(2)
    expect(r.pairs).toEqual([[0, 1]])
    expect(r.points[1]).toEqual({ x: -3, y: 1, z: 0 })
  })

  it('adds 1 on-plane point and extends pairs as solo', () => {
    const cfg: SymmetryConfig = { axis: 'x', plane: ORIGIN, pairs: [], epsilon: 0.05 }
    const r = addSymmetricPoint([], cfg, { x: 0.01, y: 1, z: 0 })
    expect(r.points.length).toBe(1)
    expect(r.pairs).toEqual([[0]])
    expect(r.points[0]!.x).toBe(0)
  })
})
