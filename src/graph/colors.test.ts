import { describe, it, expect } from 'vitest'
import {
  lerpColor,
  COLOR_WHITE, COLOR_FORMATION, COLOR_TRANSITION, COLOR_IDLE,
  COLOR_LAUNCH, COLOR_LAND_START,
} from './colors'

describe('colors', () => {
  describe('semantic constants', () => {
    it('every constant is a valid Color3 in [0,1]', () => {
      const all = [COLOR_WHITE, COLOR_FORMATION, COLOR_TRANSITION, COLOR_IDLE, COLOR_LAUNCH, COLOR_LAND_START]
      for (const c of all) {
        expect(c.r).toBeGreaterThanOrEqual(0)
        expect(c.r).toBeLessThanOrEqual(1)
        expect(c.g).toBeGreaterThanOrEqual(0)
        expect(c.g).toBeLessThanOrEqual(1)
        expect(c.b).toBeGreaterThanOrEqual(0)
        expect(c.b).toBeLessThanOrEqual(1)
      }
    })

    it('COLOR_WHITE is pure white', () => {
      expect(COLOR_WHITE).toEqual({ r: 1, g: 1, b: 1 })
    })
  })

  describe('lerpColor', () => {
    it('returns a at t=0', () => {
      const r = lerpColor({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0)
      expect(r.r).toBeCloseTo(0)
      expect(r.g).toBeCloseTo(0)
      expect(r.b).toBeCloseTo(0)
    })

    it('returns b at t=1', () => {
      const r = lerpColor({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 1)
      expect(r.r).toBeCloseTo(1)
      expect(r.g).toBeCloseTo(1)
      expect(r.b).toBeCloseTo(1)
    })

    it('interpolates channels independently', () => {
      const r = lerpColor({ r: 0, g: 1, b: 0 }, { r: 1, g: 0, b: 1 }, 0.5)
      expect(r.r).toBeCloseTo(0.5)
      expect(r.g).toBeCloseTo(0.5)
      expect(r.b).toBeCloseTo(0.5)
    })

    it('extrapolates correctly outside [0,1] (defensive — out-of-range t)', () => {
      // The implementation doesn't clamp, so t=2 means "extend the segment".
      const r = lerpColor({ r: 0, g: 0, b: 0 }, { r: 0.5, g: 0.5, b: 0.5 }, 2)
      expect(r.r).toBeCloseTo(1)
      expect(r.g).toBeCloseTo(1)
      expect(r.b).toBeCloseTo(1)
    })
  })
})
