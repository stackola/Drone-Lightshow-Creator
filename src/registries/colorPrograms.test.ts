// ============================================================================
// Default color program coverage tests — appendix-K, plan §S6.
// Asserts each of the 10 registered defaults produces a finite RGB triple in
// [0, 1] at multiple sample positions and times. Catches regressions in the
// evaluator dispatch as well as in registry registration.
// ============================================================================

import { describe, it, expect, beforeAll } from 'vitest'
import { initRegistries } from './init'
import { getAllColorPrograms, getColorProgram, evaluateColorProgram } from '../graph/colorPrograms'

beforeAll(() => initRegistries())

const SAMPLE_DRONES = 16
const SAMPLE_POSITIONS = Array.from({ length: SAMPLE_DRONES }, (_, i) => ({
  x: i - SAMPLE_DRONES / 2,
  y: 0,
  z: (i % 4) * 2,
}))

function assertValid(color: { r: number; g: number; b: number }, label: string): void {
  expect(Number.isFinite(color.r), `${label} r non-finite`).toBe(true)
  expect(Number.isFinite(color.g), `${label} g non-finite`).toBe(true)
  expect(Number.isFinite(color.b), `${label} b non-finite`).toBe(true)
  // Allow a tiny epsilon over [0, 1] for floating-point gradient math.
  expect(color.r, `${label} r out of range`).toBeGreaterThanOrEqual(-1e-6)
  expect(color.r, `${label} r out of range`).toBeLessThanOrEqual(1 + 1e-6)
  expect(color.g, `${label} g out of range`).toBeGreaterThanOrEqual(-1e-6)
  expect(color.g, `${label} g out of range`).toBeLessThanOrEqual(1 + 1e-6)
  expect(color.b, `${label} b out of range`).toBeGreaterThanOrEqual(-1e-6)
  expect(color.b, `${label} b out of range`).toBeLessThanOrEqual(1 + 1e-6)
}

describe('Color program defaults — coverage', () => {
  it('the 10 expected programs are registered', () => {
    const ids = getAllColorPrograms().map((p) => p.id).sort()
    // We don't lock to an exact set (other programs may be registered by tests),
    // but the 10 defaults must all be present.
    const required = [
      'solid-white', 'solid-red', 'solid-blue', 'solid-green',
      'gradient-blue-red', 'gradient-warm',
      'rainbow', 'rainbow-index',
      'pulse-white',
      'chase-rgb',
      'sweep-cyan-magenta',
    ]
    for (const id of required) {
      expect(ids).toContain(id)
    }
  })

  for (const t of [0, 0.5, 1, 2.5]) {
    it(`every default returns valid RGB at t=${t}s across ${SAMPLE_DRONES} drones`, () => {
      for (const program of getAllColorPrograms()) {
        for (let i = 0; i < SAMPLE_DRONES; i++) {
          const pos = SAMPLE_POSITIONS[i]!
          // Pass the full positions array so spatial programs (gradient/rainbow/sweep)
          // can normalise relative to the formation bounding box.
          const c = evaluateColorProgram(program, i, SAMPLE_DRONES, pos, t, SAMPLE_POSITIONS)
          assertValid(c, `${program.id} @ t=${t} drone=${i}`)
        }
      }
    })
  }

  it('solid programs do not vary across drones or time', () => {
    for (const id of ['solid-white', 'solid-red', 'solid-blue', 'solid-green']) {
      const program = getColorProgram(id)!
      const c0 = evaluateColorProgram(program, 0, 4, { x: 0, y: 0, z: 0 }, 0)
      const c1 = evaluateColorProgram(program, 3, 4, { x: 5, y: 5, z: 5 }, 12)
      expect(c0.r).toBeCloseTo(c1.r, 5)
      expect(c0.g).toBeCloseTo(c1.g, 5)
      expect(c0.b).toBeCloseTo(c1.b, 5)
    }
  })

  it('gradient programs differ across the chosen axis', () => {
    for (const id of ['gradient-blue-red', 'gradient-warm']) {
      const program = getColorProgram(id)!
      const N = 8
      const positions = Array.from({ length: N }, (_, i) => ({ x: i, y: i, z: i }))
      const first = evaluateColorProgram(program, 0, N, positions[0]!, 0, positions)
      const last = evaluateColorProgram(program, N - 1, N, positions[N - 1]!, 0, positions)
      const dist = Math.hypot(last.r - first.r, last.g - first.g, last.b - first.b)
      expect(dist, `${id} should vary across drones; got d=${dist}`).toBeGreaterThan(0.1)
    }
  })

  it('rainbow spans a wide hue range across drones', () => {
    const program = getColorProgram('rainbow')!
    const N = 12
    const positions = Array.from({ length: N }, (_, i) => ({ x: i, y: 0, z: 0 }))
    const seenChannels = new Set<string>()
    for (let i = 0; i < N; i++) {
      const c = evaluateColorProgram(program, i, N, positions[i]!, 0, positions)
      // Bucket the dominant channel — rainbow should hit at least two different ones.
      const dom = c.r >= c.g && c.r >= c.b ? 'r' : c.g >= c.b ? 'g' : 'b'
      seenChannels.add(dom)
    }
    expect(seenChannels.size, 'rainbow should hit multiple dominant channels').toBeGreaterThanOrEqual(2)
  })

  it('pulse program varies brightness over time on the same drone', () => {
    const program = getColorProgram('pulse-white')!
    const samples = [0, 0.25, 0.5, 0.75, 1.0].map((t) =>
      evaluateColorProgram(program, 0, 1, { x: 0, y: 0, z: 0 }, t),
    )
    const brightnesses = samples.map((c) => (c.r + c.g + c.b) / 3)
    const min = Math.min(...brightnesses)
    const max = Math.max(...brightnesses)
    expect(max - min, 'pulse should swing brightness over time').toBeGreaterThan(0.05)
  })

  it('chase + sweep programs both vary over time', () => {
    for (const id of ['chase-rgb', 'sweep-cyan-magenta']) {
      const program = getColorProgram(id)!
      const N = 8
      const positions = Array.from({ length: N }, (_, i) => ({ x: i, y: 0, z: 0 }))
      const a = evaluateColorProgram(program, 3, N, positions[3]!, 0, positions)
      const b = evaluateColorProgram(program, 3, N, positions[3]!, 1.5, positions)
      const dist = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
      expect(dist, `${id} should vary over time for the same drone; got d=${dist}`).toBeGreaterThan(0.05)
    }
  })
})
