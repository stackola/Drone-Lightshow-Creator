import { describe, it, expect } from 'vitest'
import { computeSnapGuides, type Positioned } from './snapGuides'

const peers: Positioned[] = [
  { id: 'a', position: { x: 10, y: 5, z: 0 } },
  { id: 'b', position: { x: -4, y: 5, z: 8 } },
]

describe('computeSnapGuides', () => {
  it('snaps an axis within threshold to the nearest peer center', () => {
    const r = computeSnapGuides({ x: 10.4, y: 0, z: 0 }, peers, 0.6)
    expect(r.position.x).toBeCloseTo(10) // snapped to peer a
    expect(r.position.y).toBe(0) // y=0 not near any peer y=5
    expect(r.guides.some((g) => g.axis === 'x' && g.peerId === 'a')).toBe(true)
  })

  it('leaves axes outside threshold untouched and emits no guide', () => {
    const r = computeSnapGuides({ x: 100, y: 100, z: 100 }, peers, 0.6)
    expect(r.position).toEqual({ x: 100, y: 100, z: 100 })
    expect(r.guides).toHaveLength(0)
  })

  it('snaps multiple axes independently (X and Y align to different peers)', () => {
    const r = computeSnapGuides({ x: 10.3, y: 5.2, z: 50 }, peers, 0.6)
    expect(r.position.x).toBeCloseTo(10)
    expect(r.position.y).toBeCloseTo(5)
    expect(r.position.z).toBe(50)
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'y'])
  })

  it('picks the closest peer when two are within threshold on the same axis', () => {
    const close: Positioned[] = [
      { id: 'near', position: { x: 0.2, y: 0, z: 0 } },
      { id: 'far', position: { x: 0.5, y: 0, z: 0 } },
    ]
    const r = computeSnapGuides({ x: 0, y: 0, z: 0 }, close, 0.6)
    expect(r.position.x).toBeCloseTo(0.2)
    expect(r.guides[0]!.peerId).toBe('near')
  })

  it('guide endpoints reflect the fully-snapped position', () => {
    const r = computeSnapGuides({ x: 10.3, y: 5.2, z: 0 }, peers, 0.6)
    for (const g of r.guides) {
      expect(g.to.x).toBeCloseTo(r.position.x)
      expect(g.to.y).toBeCloseTo(r.position.y)
    }
  })
})
