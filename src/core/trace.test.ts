import { describe, expect, it } from 'vitest'
import { traceImage } from './trace'
import { generateShape } from './shapes'
import { decodeMask } from './sample'
import type { ShapeSpec } from './types'

/** A 400×400 picture: a red ring (a line), a green diagonal (a line) and a solid blue block (a fill), on black. */
function picture(): Uint8ClampedArray {
  const W = 400, px = new Uint8ClampedArray(W * W * 4)
  const set = (x: number, y: number, r: number, g: number, b: number) => { const o = (y * W + x) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255 }
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    set(x, y, 0, 0, 0)
    if (Math.abs(Math.hypot(x - 140, y - 140) - 90) < 3) set(x, y, 255, 40, 60)
    if (Math.abs(x - y) < 3 && x > 250 && x < 380) set(x, y, 60, 255, 80)
    if (x > 260 && x < 360 && y > 40 && y < 140) set(x, y, 50, 90, 255)
  }
  return px
}

describe('tracing a picture', () => {
  const t = traceImage(picture(), 400, 400)
  it('finds the lines as strokes and the solid block as a fill', () => {
    expect(t.lines.some((l) => l.closed)).toBe(true) // the ring
    expect(t.lines.length).toBeGreaterThanOrEqual(2)
    const m = decodeMask(t.mask)
    let filled = 0
    for (let i = 0; i < m.length; i++) filled += m[i]!
    // Roughly the block (100×100 of 400×400 = 6%).
    expect(filled / m.length).toBeGreaterThan(0.04)
    expect(filled / m.length).toBeLessThan(0.09)
  })
  it('becomes drones in the picture’s colours at any count', () => {
    const shape: ShapeSpec = { kind: 'image', size: 10, name: 'test', mask: t.mask, colors: t.colors, cw: t.cw, ch: t.ch, lines: t.lines }
    for (const n of [60, 240]) {
      const g = generateShape(shape, n)
      expect(g.points.length).toBe(n * 3)
      let red = 0, green = 0, blue = 0
      for (let i = 0; i < n; i++) {
        const [r, gg, b] = [g.colors![i * 3]!, g.colors![i * 3 + 1]!, g.colors![i * 3 + 2]!]
        if (r > 0.8 && gg < 0.4) red++
        else if (gg > 0.8 && r < 0.5) green++
        else if (b > 0.8 && r < 0.5) blue++
      }
      // Full-brightness colours, each where it belongs.
      expect(red).toBeGreaterThan(n * 0.2)
      expect(green).toBeGreaterThan(0)
      expect(blue).toBeGreaterThan(0)
    }
  })
})
