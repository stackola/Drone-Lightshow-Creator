import { describe, it, expect } from 'vitest'
import { applyEasing, cubicBezierEasing } from './easing'
import type { EasingType } from './easing'

describe('applyEasing', () => {
  it('linear returns t unchanged', () => {
    expect(applyEasing(0, 'linear')).toBe(0)
    expect(applyEasing(0.25, 'linear')).toBe(0.25)
    expect(applyEasing(0.5, 'linear')).toBe(0.5)
    expect(applyEasing(1, 'linear')).toBe(1)
  })

  it('ease-in at t=0 returns 0, t=1 returns 1', () => {
    expect(applyEasing(0, 'ease-in')).toBe(0)
    expect(applyEasing(1, 'ease-in')).toBe(1)
  })

  it('ease-out at t=0 returns 0, t=1 returns 1', () => {
    expect(applyEasing(0, 'ease-out')).toBe(0)
    expect(applyEasing(1, 'ease-out')).toBe(1)
  })

  describe('all polynomial easings: t=0 -> 0, t=1 -> 1', () => {
    const polynomials: EasingType[] = [
      'ease-in-cubic', 'ease-out-cubic', 'ease-in-out-cubic',
      'ease-in-quartic', 'ease-out-quartic', 'ease-in-out-quartic',
      'ease-in-quintic', 'ease-out-quintic', 'ease-in-out-quintic',
    ]
    for (const easing of polynomials) {
      it(`${easing}: t=0 -> 0, t=1 -> 1`, () => {
        expect(applyEasing(0, easing)).toBeCloseTo(0, 10)
        expect(applyEasing(1, easing)).toBeCloseTo(1, 10)
      })
    }
  })

  describe('all physics easings: t=0 -> 0, t=1 -> 1', () => {
    const physics: EasingType[] = [
      'ease-in-sine', 'ease-out-sine', 'ease-in-out-sine',
      'ease-in-expo', 'ease-out-expo', 'ease-in-out-expo',
      'ease-in-circ', 'ease-out-circ', 'ease-in-out-circ',
    ]
    for (const easing of physics) {
      it(`${easing}: t=0 -> 0, t=1 -> ~1`, () => {
        expect(applyEasing(0, easing)).toBeCloseTo(0, 5)
        expect(applyEasing(1, easing)).toBeCloseTo(1, 5)
      })
    }
  })

  it('spring easing eventually approaches 1', () => {
    const result = applyEasing(1, 'spring')
    expect(result).toBeCloseTo(1, 1)
  })
})

describe('cubicBezierEasing', () => {
  it('with (0,0,1,1) is approximately linear', () => {
    for (const t of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(cubicBezierEasing(t, { x1: 0, y1: 0, x2: 1, y2: 1 })).toBeCloseTo(t, 1)
    }
  })

  it('at t=0 returns 0, t=1 returns 1', () => {
    expect(cubicBezierEasing(0, { x1: 0.42, y1: 0, x2: 0.58, y2: 1 })).toBe(0)
    expect(cubicBezierEasing(1, { x1: 0.42, y1: 0, x2: 0.58, y2: 1 })).toBe(1)
  })
})

describe("applyEasing with 'cubic-bezier'", () => {
  it('routes to cubicBezierEasing with provided config', () => {
    // CSS `ease-in-out` ≈ cubic-bezier(0.42, 0, 0.58, 1) — at t=0.5 it's ≈ 0.5
    const cfg = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 }
    expect(applyEasing(0.5, 'cubic-bezier', undefined, cfg)).toBeCloseTo(0.5, 1)
    expect(applyEasing(0, 'cubic-bezier', undefined, cfg)).toBe(0)
    expect(applyEasing(1, 'cubic-bezier', undefined, cfg)).toBe(1)
  })

  it("falls back to CSS `ease` defaults when no config is provided", () => {
    // CSS `ease` = cubic-bezier(0.25, 0.1, 0.25, 1) — definitely not linear at 0.5.
    const result = applyEasing(0.5, 'cubic-bezier')
    expect(result).toBeGreaterThan(0.5) // ease accelerates fast then settles
    expect(result).toBeLessThan(1)
  })
})
