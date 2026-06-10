import { describe, it, expect } from 'vitest'
import { getTransition, getAllTransitions } from './transitions'
import type { Vec3 } from '../graph/types'

describe('G-04: Transition Registry', () => {
  it('shortest-path transition is registered', () => {
    const t = getTransition('shortest-path')
    expect(t).toBeDefined()
    expect(t!.name).toBe('Shortest Path')
  })

  it('getAllTransitions includes shortest-path', () => {
    const all = getAllTransitions()
    expect(all.some((t) => t.id === 'shortest-path')).toBe(true)
  })

  it('4→4 mapping minimizes total distance', () => {
    const t = getTransition('shortest-path')!
    const from: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 10, y: 0, z: 10 },
    ]
    const to: Vec3[] = [
      { x: 1, y: 0, z: 1 },
      { x: 11, y: 0, z: 1 },
      { x: 1, y: 0, z: 11 },
      { x: 11, y: 0, z: 11 },
    ]
    const mapping = t.mapPoints(from, to, [], [])
    expect(mapping).toHaveLength(4)

    // Each source should map to nearest target
    // source[0]=(0,0,0) → target[0]=(1,0,1)
    // source[1]=(10,0,0) → target[1]=(11,0,1)
    // source[2]=(0,0,10) → target[2]=(1,0,11)
    // source[3]=(10,0,10) → target[3]=(11,0,11)
    const sortedMapping = [...mapping].sort((a, b) => a.sourceIndex - b.sourceIndex)
    expect(sortedMapping[0]!.sourceIndex).toBe(0)
    expect(sortedMapping[0]!.targetIndex).toBe(0)
    expect(sortedMapping[1]!.sourceIndex).toBe(1)
    expect(sortedMapping[1]!.targetIndex).toBe(1)
  })

  it('4→2 split handles fewer targets', () => {
    const t = getTransition('shortest-path')!
    const from: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 10, y: 0, z: 10 },
    ]
    const to: Vec3[] = [
      { x: 0, y: 0, z: 5 },
      { x: 10, y: 0, z: 5 },
    ]
    const mapping = t.mapPoints(from, to, [], [])
    // Only 2 mappings (min of source and target count)
    expect(mapping).toHaveLength(2)
  })

  it('interpolate at t=0 returns source positions', () => {
    const t = getTransition('shortest-path')!
    const from: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]
    const to: Vec3[] = [{ x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }]
    const mapping = t.mapPoints(from, to, [], [])
    const result = t.interpolate(mapping, from, to, 0, {})
    expect(result[0]!.y).toBeCloseTo(0)
    expect(result[1]!.y).toBeCloseTo(0)
  })

  it('interpolate at t=1 returns target positions', () => {
    const t = getTransition('shortest-path')!
    const from: Vec3[] = [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }]
    const to: Vec3[] = [{ x: 0, y: 10, z: 0 }, { x: 10, y: 10, z: 0 }]
    const mapping = t.mapPoints(from, to, [], [])
    const result = t.interpolate(mapping, from, to, 1, {})
    expect(result[0]!.y).toBeCloseTo(10)
    expect(result[1]!.y).toBeCloseTo(10)
  })

  it('interpolate at t=0.5 returns midpoints', () => {
    const t = getTransition('shortest-path')!
    const from: Vec3[] = [{ x: 0, y: 0, z: 0 }]
    const to: Vec3[] = [{ x: 10, y: 10, z: 10 }]
    const mapping = t.mapPoints(from, to, [], [])
    const result = t.interpolate(mapping, from, to, 0.5, {})
    expect(result[0]!.x).toBeCloseTo(5)
    expect(result[0]!.y).toBeCloseTo(5)
    expect(result[0]!.z).toBeCloseTo(5)
  })
})
