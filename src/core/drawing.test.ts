import { describe, expect, it } from 'vitest'
import { generateShape } from './shapes'
import { encodeMask } from './sample'
import type { ShapeSpec } from './types'

const square = { p: [0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.05, 0.95, 0.05, 0.05], closed: true }
const disc = encodeMask(100, 100, (x, y) => Math.hypot(x - 50, y - 50) < 25)
const image = (lines: { p: number[]; closed?: boolean }[], mask = disc): ShapeSpec => ({ kind: 'image', size: 10, name: 'd', mask, colors: null, cw: 0, ch: 0, lines })

function nearest(p: Float32Array): number[] {
  const n = p.length / 3, out: number[] = []
  for (let i = 0; i < n; i++) { let b = Infinity; for (let j = 0; j < n; j++) if (j !== i) b = Math.min(b, Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!)); out.push(b) }
  return out.sort((a, b) => a - b)
}

describe('drawings with strokes', () => {
  it('strokes become evenly spaced single-file lines; the fill sits clear of them', () => {
    const g = generateShape(image([square]), 160)
    expect(g.points.length).toBe(480)
    // Drones on the square's outline (|x| or |y| at 0.45 of the size) and inside the disc.
    let onLine = 0, inDisc = 0
    for (let k = 0; k < 160; k++) {
      const x = g.points[k * 3]! / 10, y = g.points[k * 3 + 1]! / 10
      if (Math.abs(Math.max(Math.abs(x), Math.abs(y)) - 0.45) < 1e-3) onLine++
      else if (Math.hypot(x, y) < 0.26) inDisc++
    }
    expect(onLine + inDisc).toBe(160)
    expect(onLine).toBeGreaterThan(40)
    expect(inDisc).toBeGreaterThan(30)
    // Evenly spread overall: the closest pair isn't much closer than typical.
    const nn = nearest(g.points)
    expect(nn[0]! / nn[80]!).toBeGreaterThan(0.6)
    // Pen order follows the stroke, then the fill.
    expect(g.order![0]).toBe(0)
    expect(Math.max(...Array.from(g.order!.slice(0, onLine)))).toBeLessThanOrEqual(0.7)
  })

  it('a drawing of strokes only puts every drone on its lines', () => {
    const empty = encodeMask(100, 100, () => false)
    const cross = [{ p: [0.1, 0.5, 0.9, 0.5] }, { p: [0.5, 0.1, 0.5, 0.9] }]
    const g = generateShape(image(cross, empty), 41)
    for (let k = 0; k < 41; k++) {
      const x = g.points[k * 3]! / 10, y = g.points[k * 3 + 1]! / 10
      expect(Math.min(Math.abs(x), Math.abs(y))).toBeLessThan(1e-4)
    }
    // 16 m of strokes, 41 drones: 0.4 m apart, and none doubled up where the strokes cross.
    expect(nearest(g.points)[0]).toBeGreaterThan(0.3)
  })
})

describe('drawings in project files', () => {
  it('keep their strokes', async () => {
    const { parseProjectFile, toProjectFile } = await import('./serialize')
    const { newScene, newShow } = await import('./defaults')
    const doc = newShow(60)
    const sc = newScene(doc, 'circle')
    doc.scenes.push({ ...sc, layers: [{ ...sc.layers[0]!, shape: image([square]) }] })
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    expect((back.scenes[0]!.layers[0]!.shape as { lines?: unknown }).lines).toEqual([square])
  })
})
