import { describe, expect, it } from 'vitest'
import { compile } from './compile'
import { newScene, newShow } from './defaults'
import { simulate, simVerdict, windVector, WIND_PRESETS } from './simulate'
import { evaluate } from './evaluate'

function smallShow() {
  const doc = newShow(40)
  doc.scenes.push(newScene(doc, 'circle'), newScene(doc, 'heart'))
  doc.scenes[1]!.hold = 8
  return { doc, c: compile(doc) }
}

describe('wind simulation', () => {
  it('blows the way the compass says', () => {
    const [ex, ez] = windVector(270) // from the west → toward +x (east)
    expect(ex).toBeCloseTo(1, 9); expect(ez).toBeCloseTo(0, 9)
    const [sx, sz] = windVector(180) // from the audience (south, +z) → toward −z
    expect(sx).toBeCloseTo(0, 9); expect(sz).toBeCloseTo(-1, 9)
  })

  it('tracks the plan closely in still air', () => {
    const { doc, c } = smallShow()
    const r = simulate(c, doc.limits.minSpacing, { speed: 0, gust: 0, turbulence: 0, from: 0, seed: 1 })
    expect(r.maxDeviation).toBeLessThan(0.3)
    expect(r.closePairs).toBe(0)
    expect(r.saturated).toBe(0)
    expect(simVerdict(r, doc.limits.minSpacing).level).toBe('ok')
  })

  it('drifts more in stronger wind, downwind, and is deterministic for a seed', () => {
    const { doc, c } = smallShow()
    const run = (i: number, seed = 3) => simulate(c, doc.limits.minSpacing, { ...WIND_PRESETS[i]!.wind, from: 270, seed }, { record: 0.5 })
    const calm = run(0), windy = run(2)
    expect(windy.rmsDeviation).toBeGreaterThan(calm.rmsDeviation * 2)
    expect(run(2).maxDeviation).toBe(windy.maxDeviation)
    // Wind from the west pushes drones east (+x) on average while they fight it.
    const f = windy.frames!, n = c.n, ref = new Float32Array(n * 3)
    let sum = 0, count = 0
    for (let k = 0; k * windy.frameDt < c.duration; k += 4) {
      evaluate(c, k * windy.frameDt, ref, null)
      for (let i = 0; i < n; i++) if (ref[i * 3 + 1]! > 5) { sum += f[(k * n + i) * 3]! - ref[i * 3]!; count++ }
    }
    expect(sum / count).toBeGreaterThan(0.01)
  })

  it('records frames that start on the pads', () => {
    const { doc, c } = smallShow()
    const r = simulate(c, doc.limits.minSpacing, { speed: 3, gust: 1, turbulence: 0.3, from: 90, seed: 2 }, { record: 0.1 })
    expect(r.frameDt).toBeCloseTo(0.1, 9)
    expect(r.frames!.length % (c.n * 3)).toBe(0)
    for (let i = 0; i < c.n; i++) {
      expect(r.frames![i * 3]).toBeCloseTo(c.pads[i * 3]!, 4)
      expect(r.frames![i * 3 + 1]).toBeCloseTo(0, 4)
    }
  })

  it('can be cancelled', () => {
    const { doc, c } = smallShow()
    const r = simulate(c, doc.limits.minSpacing, { speed: 3, gust: 1, turbulence: 0.3, from: 90, seed: 2 }, { onProgress: (f) => f < 0.1 })
    expect(r.cancelled).toBe(true)
  })
})
