// ============================================================================
// Slice 1 Step 8: Generator parameter validation.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { initRegistries } from './init'
import { validateGeneratorParams } from './generators'

beforeAll(() => initRegistries())

describe('validateGeneratorParams', () => {
  it('returns error for unknown generator', () => {
    const errors = validateGeneratorParams('does-not-exist', { count: 10 })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatch(/unknown generator/)
  })

  it('returns error for count <= 0', () => {
    const errors = validateGeneratorParams('ring', { count: 0, radius: 10 }, 1.0)
    expect(errors.some((e) => /count must be positive/.test(e))).toBe(true)
  })

  it('no errors for well-spaced ring', () => {
    // 10 drones on r=10 ring → arc spacing ≈ 6.28m, well above 1m
    const errors = validateGeneratorParams('ring', { count: 10, radius: 10 }, 1.0)
    expect(errors).toHaveLength(0)
  })

  it('flags ring that packs drones closer than minSpacing', () => {
    // 100 drones on r=1 ring → arc spacing ≈ 0.063m
    const errors = validateGeneratorParams('ring', { count: 100, radius: 1 }, 1.0)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => /apart at closest/.test(e))).toBe(true)
  })

  it('flags sphere with too many drones for radius', () => {
    // 5000 drones on r=1 sphere → very dense
    const errors = validateGeneratorParams('sphere', { count: 5000, radius: 1 }, 1.0)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('skips spacing check when minSpacing not provided', () => {
    const errors = validateGeneratorParams('ring', { count: 100, radius: 1 })
    expect(errors).toHaveLength(0)
  })

  it('grid: spacing param controls density', () => {
    const dense = validateGeneratorParams('grid', { cols: 10, rows: 10, spacing: 0.5 }, 1.0)
    expect(dense.length).toBeGreaterThan(0)
    const sparse = validateGeneratorParams('grid', { cols: 10, rows: 10, spacing: 2 }, 1.0)
    expect(sparse).toHaveLength(0)
  })
})
