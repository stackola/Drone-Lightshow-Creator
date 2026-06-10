import { describe, it, expect } from 'vitest'
import { alignAxisToMean, distributeAxisEvenly, type Positioned } from './alignDistribute'

function p(id: string, x: number, y: number, z: number): Positioned {
  return { id, position: { x, y, z } }
}

describe('alignDistribute', () => {
  describe('alignAxisToMean', () => {
    it('returns empty when fewer than 2 items', () => {
      expect(alignAxisToMean([], 'x')).toEqual([])
      expect(alignAxisToMean([p('a', 1, 2, 3)], 'x')).toEqual([])
    })

    it('sets every items chosen axis to the mean', () => {
      const items = [p('a', 0, 5, 1), p('b', 10, 5, 1), p('c', 20, 5, 1)]
      const out = alignAxisToMean(items, 'x')
      expect(out.map((o) => o.position.x)).toEqual([10, 10, 10])
    })

    it('does not touch the other axes', () => {
      const items = [p('a', 0, 1, 1), p('b', 10, 2, 2)]
      const out = alignAxisToMean(items, 'x')
      expect(out[0]!.position.y).toBe(1)
      expect(out[0]!.position.z).toBe(1)
      expect(out[1]!.position.y).toBe(2)
      expect(out[1]!.position.z).toBe(2)
    })

    it('preserves input order in the output', () => {
      const items = [p('a', 5, 0, 0), p('b', 0, 0, 0), p('c', 10, 0, 0)]
      const out = alignAxisToMean(items, 'x')
      expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    })
  })

  describe('distributeAxisEvenly', () => {
    it('returns empty when fewer than 3 items', () => {
      expect(distributeAxisEvenly([], 'x')).toEqual([])
      expect(distributeAxisEvenly([p('a', 0, 0, 0), p('b', 5, 0, 0)], 'x')).toEqual([])
    })

    it('spaces 5 items evenly between min and max', () => {
      // Random initial spacing: 0, 3, 5, 11, 12.
      const items = [p('a', 0, 0, 0), p('b', 3, 0, 0), p('c', 5, 0, 0), p('d', 11, 0, 0), p('e', 12, 0, 0)]
      const out = distributeAxisEvenly(items, 'x')
      // Sorted by x: a(0), b(3), c(5), d(11), e(12) → step = (12-0)/4 = 3
      // So a→0, b→3, c→6, d→9, e→12.
      const xByid = new Map(out.map((o) => [o.id, o.position.x]))
      expect(xByid.get('a')).toBeCloseTo(0)
      expect(xByid.get('b')).toBeCloseTo(3)
      expect(xByid.get('c')).toBeCloseTo(6)
      expect(xByid.get('d')).toBeCloseTo(9)
      expect(xByid.get('e')).toBeCloseTo(12)
    })

    it('preserves bookends (min and max stay put)', () => {
      const items = [p('a', -7, 0, 0), p('b', 0, 0, 0), p('c', 14, 0, 0)]
      const out = distributeAxisEvenly(items, 'x')
      const xByid = new Map(out.map((o) => [o.id, o.position.x]))
      expect(xByid.get('a')).toBeCloseTo(-7)
      expect(xByid.get('c')).toBeCloseTo(14)
      // b should sit at mean = 3.5.
      expect(xByid.get('b')).toBeCloseTo(3.5)
    })

    it('preserves input order in the output even though sort happens internally', () => {
      const items = [p('a', 100, 0, 0), p('b', 0, 0, 0), p('c', 50, 0, 0)]
      const out = distributeAxisEvenly(items, 'x')
      expect(out.map((o) => o.id)).toEqual(['a', 'b', 'c'])
    })

    it('handles the Y (altitude) axis', () => {
      const items = [p('a', 0, 10, 0), p('b', 0, 20, 0), p('c', 0, 30, 0)]
      const out = distributeAxisEvenly(items, 'y')
      const yByid = new Map(out.map((o) => [o.id, o.position.y]))
      expect(yByid.get('a')).toBeCloseTo(10)
      expect(yByid.get('b')).toBeCloseTo(20)
      expect(yByid.get('c')).toBeCloseTo(30)
    })
  })
})
