import { describe, expect, it } from 'vitest'
import { glyphMap, thin } from './textOrder'
import { pixelTextMask } from './pixelFont'
import { generateShape } from './shapes'
import { compile, sceneGeometry } from './compile'
import { evaluate } from './evaluate'
import { effectColor, blankLook, textBitmap } from './effects'
import { newLedSign, newScene, newShow, rasterizeText } from './defaults'
import { normalizeDoc } from './serialize'
import { validate } from './validate'
import type { Effect, ShapeSpec } from './types'

const noBeat = () => null

describe('pen order for text', () => {
  it('thins a thick bar to a one-pixel line', () => {
    const w = 20, h = 9
    const px = new Uint8Array(w * h)
    for (let y = 2; y < 7; y++) for (let x = 2; x < 18; x++) px[y * w + x] = 1
    const sk = thin(px, w, h)
    let count = 0
    for (let x = 0; x < w; x++) { let c = 0; for (let y = 0; y < h; y++) c += sk[y * w + x]!; if (c) count++; expect(c).toBeLessThanOrEqual(1) }
    expect(count).toBeGreaterThan(8)
  })

  it('splits text into letters and orders them left to right', () => {
    const map = glyphMap(pixelTextMask('HI A', 6))
    expect(map.glyphs).toBe(3)
    const spec: ShapeSpec = { kind: 'text', size: 1, text: 'HI', font: 'pixel', mask: rasterizeText('HI', 'pixel') }
    const s = generateShape(spec, 80)
    expect(s.glyphs).toBe(2)
    // Order is sorted and letter-major: every point of H comes before every point of I.
    for (let k = 1; k < 80; k++) expect(s.order![k]!).toBeGreaterThanOrEqual(s.order![k - 1]!)
    let maxH = -Infinity, minI = Infinity
    for (let k = 0; k < 80; k++) {
      if (s.order![k]! < 0.5) maxH = Math.max(maxH, s.points[k * 3]!)
      else minI = Math.min(minI, s.points[k * 3]!)
    }
    expect(maxH).toBeLessThan(minI)
  })

  it('traces a letter as a continuous pen stroke', () => {
    // An "L": the pen should start at the top of the stem and end at the right of the foot.
    const spec: ShapeSpec = { kind: 'text', size: 1, text: 'L', font: 'pixel', mask: rasterizeText('L', 'pixel') }
    const s = generateShape(spec, 40)
    const first = s.points.subarray(0, 3), last = s.points.subarray(39 * 3, 40 * 3)
    expect(first[1]!).toBeGreaterThan(last[1]!) // starts high
    expect(last[0]!).toBeGreaterThan(first[0]!) // ends to the right
  })
})

describe('text reveal effects', () => {
  const look = (order: number, glyphs = 4) => ({ ...blankLook(), order, glyphs })
  const lit = (e: Effect, order: number, tau: number, glyphs = 4) => {
    const out: [number, number, number] = [0, 0, 0]
    effectColor(e, look(order, glyphs), tau, tau, noBeat, out)
    return out[0] + out[1] + out[2] > 0.3
  }

  it('write-on reveals in order and finishes lit', () => {
    const e: Effect = { kind: 'write', a: '#ff0000', b: '#000000', pen: '#ffffff', duration: 4, brightness: 1 }
    expect(lit(e, 0.1, 0)).toBe(false)
    expect(lit(e, 0.1, 1)).toBe(true)
    expect(lit(e, 0.9, 1)).toBe(false)
    expect(lit(e, 0.9, 4)).toBe(true)
  })

  it('typewriter shows whole letters at a time', () => {
    const e: Effect = { kind: 'type', a: '#00ff00', b: '#000000', cursor: '#ffffff', duration: 4, brightness: 1 }
    // 4 letters, one per second: at 1.5 s the first letter is fully on, the third is off.
    expect(lit(e, 0.01, 1.5)).toBe(true)
    expect(lit(e, 0.24, 1.5)).toBe(true)
    expect(lit(e, 0.6, 1.5)).toBe(false)
  })

  it('flip board settles letters left to right', () => {
    const e: Effect = { kind: 'flip', a: '#ffffff', b: '#000000', duration: 4, rate: 12, brightness: 1 }
    expect(lit(e, 0.1, 1.2)).toBe(true) // first letter settled at 1 s
    expect(lit(e, 0.9, 4.2)).toBe(true)
  })
})

describe('LED sign', () => {
  it('is a 7-drone-tall grid that passes every check', () => {
    const doc = newShow(200)
    const scene = newLedSign(doc, 'HI')
    doc.scenes.push(scene)
    const c = compile(doc)
    expect(validate(doc, c).issues).toEqual([])
    const g = sceneGeometry(scene, 200)
    const ys = new Set<number>()
    for (let k = 0; k < g.layerCounts[0]!; k++) ys.add(Math.round(g.points[k * 3 + 1]! * 100))
    expect(ys.size).toBe(7)
  })

  it('shows the exact dot-matrix bitmap when static', () => {
    const doc = newShow(7 * 40)
    const scene = newLedSign(doc, 'HI', { speed: 0 })
    doc.scenes.push(scene)
    const c = compile(doc)
    const t = c.sceneTimes[0]!.holdStart + 1
    const pos = new Float32Array(c.n * 3), col = new Float32Array(c.n * 3)
    evaluate(c, t, pos, col)
    const bmp = textBitmap('HI')
    let litCount = 0
    for (let i = 0; i < c.n; i++) if (col[i * 3]! > 0.5) litCount++
    let on = 0
    for (let k = 0; k < bmp.on.length; k++) on += bmp.on[k]!
    expect(litCount).toBe(on)
  })

  it('scrolls: the lit pattern moves left over time', () => {
    const doc = newShow(7 * 40)
    doc.scenes.push(newLedSign(doc, 'I', { speed: 4 }))
    const c = compile(doc)
    const t0 = c.sceneTimes[0]!.holdStart
    const pos = new Float32Array(c.n * 3), col = new Float32Array(c.n * 3)
    const meanX = (t: number) => {
      evaluate(c, t, pos, col)
      let s = 0, k = 0
      for (let i = 0; i < c.n; i++) if (col[i * 3]! > 0.5) { s += pos[i * 3]!; k++ }
      return k ? s / k : NaN
    }
    const a = meanX(t0 + 2), b = meanX(t0 + 4)
    expect(b).toBeLessThan(a)
  })

  it('keeps LED text through save and load', () => {
    const doc = newShow(100)
    doc.scenes.push(newLedSign(doc, 'SALE 50%'))
    const back = normalizeDoc(JSON.parse(JSON.stringify(doc)))
    expect(back.scenes[0]!.layers[0]!.effect).toMatchObject({ kind: 'matrix', text: 'SALE 50%' })
  })

  it('write-on works on a plain text scene', () => {
    const doc = newShow(150)
    const sc = newScene(doc, 'text')
    sc.layers[0]!.effect = { kind: 'write', a: '#ffffff', b: '#000000', pen: '#ffd000', duration: 3, brightness: 1 }
    sc.hold = 6
    doc.scenes.push(sc)
    const c = compile(doc)
    const t0 = c.sceneTimes[0]!.holdStart
    const pos = new Float32Array(c.n * 3), col = new Float32Array(c.n * 3)
    const count = (t: number) => { evaluate(c, t, pos, col); let k = 0; for (let i = 0; i < c.n; i++) if (col[i * 3]! > 0.3) k++; return k }
    expect(count(t0 + 0.01)).toBeLessThan(10)
    const mid = count(t0 + 1.5)
    expect(mid).toBeGreaterThan(40); expect(mid).toBeLessThan(110)
    expect(count(t0 + 3.5)).toBe(150)
  })
})

describe('small LED panels', () => {
  const lit = (doc: ReturnType<typeof newShow>) => {
    const c = compile(doc)
    const pos = new Float32Array(c.n * 3), col = new Float32Array(c.n * 3)
    evaluate(c, c.sceneTimes[0]!.holdStart + 0.5, pos, col)
    const on: [number, number][] = []
    for (let i = 0; i < c.n; i++) if (col[i * 3]! > 0.5) on.push([pos[i * 3]!, pos[i * 3 + 1]!])
    return on
  }

  it('a 3×5 font fits a 5-drone-tall panel exactly', () => {
    const doc = newShow(60)
    doc.scenes.push(newLedSign(doc, 'HI', { font: 5, speed: 0 }))
    const bmp = textBitmap('HI', 5)
    let on = 0
    for (let k = 0; k < bmp.on.length; k++) on += bmp.on[k]!
    expect(lit(doc).length).toBe(on)
    expect(validate(doc, compile(doc)).issues).toEqual([])
  })

  it('an 8 × 10 panel shows 5×7 letters crisply, centred vertically', () => {
    const doc = newShow(80)
    const sc = newLedSign(doc, 'I', { speed: 0 })
    sc.layers = [{ ...sc.layers[0]!, weight: 1, shape: { kind: 'grid', size: 7 * 3, aspect: 0.8, scatter: 0, fill: 'filled' } }]
    doc.scenes.push(sc)
    const on = lit(doc)
    const rows = new Set(on.map(([, y]) => Math.round(y * 10)))
    expect(rows.size).toBe(7) // the 7 font rows, not stretched over 10
    expect(on.length).toBe(11) // the I glyph has 11 dots
  })

  it('panel width can be set; the rest of the fleet parks', () => {
    const doc = newShow(200)
    const sc = newLedSign(doc, 'GO', { columns: 12 })
    const counts = sc.layers.map((l) => l.weight)
    expect(counts[0]).toBe(84)
    expect(sc.layers[1]!.role).toBe('park')
  })
})
