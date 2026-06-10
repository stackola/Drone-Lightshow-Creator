import { describe, it, expect, beforeEach } from 'vitest'
import {
  evaluateColorProgram,
  registerColorProgram,
  getColorProgram,
  getAllColorPrograms,
  removeColorProgram,
} from './colorPrograms'
import type {
  SolidColorProgram,
  GradientColorProgram,
  MultiStopGradientColorProgram,
  RainbowColorProgram,
  PulseColorProgram,
} from './colorPrograms'

// Helper to clear registry between tests
function clearRegistry() {
  for (const p of getAllColorPrograms()) {
    removeColorProgram(p.id)
  }
}

describe('Color Program Registry', () => {
  beforeEach(() => {
    clearRegistry()
  })

  it('registerColorProgram + getColorProgram round-trip', () => {
    const program: SolidColorProgram = {
      id: 'solid-1',
      name: 'Red',
      type: 'solid',
      color: { r: 1, g: 0, b: 0 },
    }
    registerColorProgram(program)
    const retrieved = getColorProgram('solid-1')
    expect(retrieved).toBeDefined()
    expect(retrieved!.id).toBe('solid-1')
    expect(retrieved!.type).toBe('solid')
  })

  it('getAllColorPrograms returns registered programs', () => {
    registerColorProgram({ id: 'a', name: 'A', type: 'solid', color: { r: 1, g: 0, b: 0 } } as SolidColorProgram)
    registerColorProgram({ id: 'b', name: 'B', type: 'solid', color: { r: 0, g: 1, b: 0 } } as SolidColorProgram)
    const all = getAllColorPrograms()
    expect(all.length).toBe(2)
    expect(all.map((p) => p.id).sort()).toEqual(['a', 'b'])
  })

  it('removeColorProgram removes it', () => {
    registerColorProgram({ id: 'rm-me', name: 'X', type: 'solid', color: { r: 0, g: 0, b: 0 } } as SolidColorProgram)
    expect(getColorProgram('rm-me')).toBeDefined()
    removeColorProgram('rm-me')
    expect(getColorProgram('rm-me')).toBeUndefined()
  })
})

describe('evaluateColorProgram', () => {
  it('solid returns the solid color', () => {
    const program: SolidColorProgram = {
      id: 'solid-test',
      name: 'Red',
      type: 'solid',
      color: { r: 1, g: 0.5, b: 0.25 },
    }
    const result = evaluateColorProgram(program, 0, 10, { x: 0, y: 0, z: 0 }, 0)
    expect(result.r).toBeCloseTo(1)
    expect(result.g).toBeCloseTo(0.5)
    expect(result.b).toBeCloseTo(0.25)
  })

  it('gradient returns interpolated color based on position', () => {
    const program: GradientColorProgram = {
      id: 'grad-test',
      name: 'Gradient',
      type: 'gradient',
      colorStart: { r: 0, g: 0, b: 0 },
      colorEnd: { r: 1, g: 1, b: 1 },
      axis: 'x',
    }
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ]
    // At x=0 (min), should be colorStart
    const atStart = evaluateColorProgram(program, 0, 3, positions[0]!, 0, positions)
    expect(atStart.r).toBeCloseTo(0)
    expect(atStart.g).toBeCloseTo(0)

    // At x=10 (max), should be colorEnd
    const atEnd = evaluateColorProgram(program, 2, 3, positions[2]!, 0, positions)
    expect(atEnd.r).toBeCloseTo(1)
    expect(atEnd.g).toBeCloseTo(1)

    // At x=5 (midpoint), should be roughly 0.5
    const atMid = evaluateColorProgram(program, 1, 3, positions[1]!, 0, positions)
    expect(atMid.r).toBeCloseTo(0.5)
  })

  it('rainbow returns HSV-based color with valid RGB range', () => {
    const program: RainbowColorProgram = {
      id: 'rainbow-test',
      name: 'Rainbow',
      type: 'rainbow',
      mode: 'index',
      axis: 'x',
      saturation: 1,
      brightness: 1,
      speed: 0,
    }
    const result = evaluateColorProgram(program, 0, 10, { x: 0, y: 0, z: 0 }, 0)
    expect(result.r).toBeGreaterThanOrEqual(0)
    expect(result.r).toBeLessThanOrEqual(1)
    expect(result.g).toBeGreaterThanOrEqual(0)
    expect(result.g).toBeLessThanOrEqual(1)
    expect(result.b).toBeGreaterThanOrEqual(0)
    expect(result.b).toBeLessThanOrEqual(1)
  })

  it('pulse returns brightness-modulated color', () => {
    const program: PulseColorProgram = {
      id: 'pulse-test',
      name: 'Pulse',
      type: 'pulse',
      color: { r: 1, g: 1, b: 1 },
      frequency: 1,
      amplitude: 1,
      minBrightness: 0,
    }
    // At time 0, sin(0) = 0, so brightness = 0 + 1 * 1 * (0+1)/2 = 0.5
    const atZero = evaluateColorProgram(program, 0, 1, { x: 0, y: 0, z: 0 }, 0)
    expect(atZero.r).toBeCloseTo(0.5)

    // At time 0.25 (quarter period), sin(pi/2) = 1, brightness = 0 + 1*1*(1+1)/2 = 1
    const atQuarter = evaluateColorProgram(program, 0, 1, { x: 0, y: 0, z: 0 }, 0.25)
    expect(atQuarter.r).toBeCloseTo(1)
  })

  // S6 (2026-05-21) — multi-stop gradient evaluator coverage.
  describe('multi-gradient color program', () => {
    const positions = [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 15, y: 0, z: 0 },
      { x: 20, y: 0, z: 0 },
    ]

    it('a 3-stop red→green→blue gradient hits each stop colour at the right axis position', () => {
      const program: MultiStopGradientColorProgram = {
        id: 'mg-3',
        name: '3-stop',
        type: 'multi-gradient',
        axis: 'x',
        stops: [
          { t: 0, color: { r: 1, g: 0, b: 0 } },
          { t: 0.5, color: { r: 0, g: 1, b: 0 } },
          { t: 1, color: { r: 0, g: 0, b: 1 } },
        ],
      }
      const head = evaluateColorProgram(program, 0, 5, positions[0]!, 0, positions)
      expect(head.r).toBeCloseTo(1)
      expect(head.g).toBeCloseTo(0)
      expect(head.b).toBeCloseTo(0)
      // x=10 is exactly the midpoint of [0,20] → t=0.5 → green stop
      const mid = evaluateColorProgram(program, 2, 5, positions[2]!, 0, positions)
      expect(mid.r).toBeCloseTo(0)
      expect(mid.g).toBeCloseTo(1)
      expect(mid.b).toBeCloseTo(0)
      const tail = evaluateColorProgram(program, 4, 5, positions[4]!, 0, positions)
      expect(tail.r).toBeCloseTo(0)
      expect(tail.g).toBeCloseTo(0)
      expect(tail.b).toBeCloseTo(1)
    })

    it('interpolates between adjacent stops linearly', () => {
      const program: MultiStopGradientColorProgram = {
        id: 'mg-lerp',
        name: 'lerp',
        type: 'multi-gradient',
        axis: 'x',
        stops: [
          { t: 0, color: { r: 0, g: 0, b: 0 } },
          { t: 1, color: { r: 1, g: 1, b: 1 } },
        ],
      }
      const quarter = evaluateColorProgram(program, 1, 5, positions[1]!, 0, positions)
      expect(quarter.r).toBeCloseTo(0.25)
    })

    it('tolerates unsorted input stops', () => {
      const program: MultiStopGradientColorProgram = {
        id: 'mg-unsorted',
        name: 'unsorted',
        type: 'multi-gradient',
        axis: 'x',
        stops: [
          { t: 1, color: { r: 0, g: 0, b: 1 } },
          { t: 0, color: { r: 1, g: 0, b: 0 } },
          { t: 0.5, color: { r: 0, g: 1, b: 0 } },
        ],
      }
      const mid = evaluateColorProgram(program, 2, 5, positions[2]!, 0, positions)
      expect(mid.g).toBeCloseTo(1)
    })

    it('clamps at the endpoints when t is outside [0,1]', () => {
      // Position out of the registered formation range still returns nearest stop.
      const program: MultiStopGradientColorProgram = {
        id: 'mg-clamp',
        name: 'clamp',
        type: 'multi-gradient',
        axis: 'x',
        stops: [
          { t: 0.2, color: { r: 1, g: 0, b: 0 } },
          { t: 0.8, color: { r: 0, g: 0, b: 1 } },
        ],
      }
      // x=0 → t=0 → below first stop → red
      const below = evaluateColorProgram(program, 0, 5, positions[0]!, 0, positions)
      expect(below.r).toBeCloseTo(1)
      // x=20 → t=1 → above last stop → blue
      const above = evaluateColorProgram(program, 4, 5, positions[4]!, 0, positions)
      expect(above.b).toBeCloseTo(1)
    })

    it('handles edge cases: zero stops returns white, one stop returns that colour', () => {
      const empty: MultiStopGradientColorProgram = {
        id: 'mg-empty', name: 'empty', type: 'multi-gradient', axis: 'x', stops: [],
      }
      const r = evaluateColorProgram(empty, 0, 1, { x: 0, y: 0, z: 0 }, 0)
      expect(r.r).toBeCloseTo(1); expect(r.g).toBeCloseTo(1); expect(r.b).toBeCloseTo(1)
      const single: MultiStopGradientColorProgram = {
        id: 'mg-single', name: 'single', type: 'multi-gradient', axis: 'y',
        stops: [{ t: 0.5, color: { r: 0.3, g: 0.4, b: 0.5 } }],
      }
      const s = evaluateColorProgram(single, 0, 1, { x: 0, y: 0, z: 0 }, 0)
      expect(s.r).toBeCloseTo(0.3); expect(s.g).toBeCloseTo(0.4); expect(s.b).toBeCloseTo(0.5)
    })
  })
})
