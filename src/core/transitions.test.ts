import { describe, expect, it } from 'vitest'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { fitScene, newScene, newShow } from './defaults'
import { normalizeDoc } from './serialize'
import { minPairDistance } from './math'
import { wrapPos } from './transitions'
import type { ShowDoc, TransitionStyle } from './types'

function show(style: TransitionStyle | undefined, n = 80): ShowDoc {
  const doc = newShow(n)
  const a = newScene(doc, 'circle'), b = newScene(doc, 'heart'), c = newScene(doc, 'star')
  b.position = [10, 60, 0]
  for (const s of [a, b, c]) s.hold = 4
  if (style) { b.flight.style = style; c.flight.style = style }
  doc.scenes.push(a, b, c)
  return doc
}

const STYLES: TransitionStyle[] = [
  { kind: 'cascade', amount: 0.6, order: 'left' },
  { kind: 'cascade', amount: 0.6, order: 'center' },
  { kind: 'swirl', amount: 0.6, turns: 0.5 },
  { kind: 'burst', amount: 0.5 },
  { kind: 'ant', amount: 0.6, lanes: 0 },
  { kind: 'rain', amount: 0.6 },
]

describe('spectacle transitions', () => {
  it('every style plans a show that passes every check', () => {
    for (const st of STYLES) {
      const doc = show(st)
      const c = compile(doc)
      const v = validate(doc, c)
      expect(v.issues, `${st.kind}`).toEqual([])
      // The style is actually flown (possibly softened), not silently replaced, on these roomy formations.
      expect(c.sceneTimes[1]!.transition.used, `${st.kind}`).toBe(st.kind)
    }
  })

  it('flights stay continuous and arrive exactly on the formation', () => {
    for (const st of STYLES) {
      const doc = show(st)
      const c = compile(doc)
      const L = doc.limits
      const vmax = Math.hypot(L.maxSpeedH, Math.max(L.maxSpeedUp, L.maxSpeedDown))
      const a = new Float32Array(c.n * 3), b = new Float32Array(c.n * 3)
      const ts = c.sceneTimes[1]!
      const dt = 0.05
      evaluate(c, ts.flightStart, a, null)
      for (let t = ts.flightStart + dt; t <= ts.holdStart + 0.2; t += dt) {
        evaluate(c, t, b, null)
        for (let i = 0; i < c.n; i++) {
          const d = Math.hypot(b[i * 3]! - a[i * 3]!, b[i * 3 + 1]! - a[i * 3 + 1]!, b[i * 3 + 2]! - a[i * 3 + 2]!)
          expect(d, `${st.kind} drone ${i} at ${t.toFixed(2)}`).toBeLessThanOrEqual(vmax * dt * 1.02 + 1e-3)
        }
        a.set(b)
      }
      // Just before and just after the hold starts.
      evaluate(c, ts.holdStart - 1e-6, a, null)
      evaluate(c, ts.holdStart + 1e-6, b, null)
      for (let k = 0; k < a.length; k++) expect(Math.abs(a[k]! - b[k]!), st.kind).toBeLessThan(1e-2)
    }
  })

  it('swirl only turns the flying formation, so every distance equals the plain flight’s', () => {
    const doc = show({ kind: 'swirl', amount: 0.6, turns: 1 })
    const c = compile(doc)
    const seg = c.segments.find((s) => s.kind === 'flight' && s.into === 1)!
    if (seg.kind !== 'flight' || seg.style?.kind !== 'wrap') throw new Error('expected a wrapped flight')
    const base = new Float32Array(c.n * 3), swirl = new Float32Array(c.n * 3)
    const T = seg.t1 - seg.t0
    for (const f of [0.2, 0.5, 0.8]) {
      const t = seg.t0 + f * T
      wrapPos(seg.legs, { ...seg.style.wrap, turns: 0 }, seg.t0, T, t, base)
      wrapPos(seg.legs, seg.style.wrap, seg.t0, T, t, swirl)
      expect(minPairDistance(swirl)).toBeCloseTo(minPairDistance(base), 3)
    }
  })

  it('a transition that cannot be flown safely is softened or replaced, and the show stays valid', () => {
    const doc = newShow(150)
    doc.limits.maxAltitude = 300
    const a = fitScene(newScene(doc, 'grid'), 150, doc.limits.minSpacing, 'exact')
    const b = fitScene(newScene(doc, 'sphere'), 150, doc.limits.minSpacing, 'exact')
    b.flight.style = { kind: 'cascade', amount: 1, order: 'center' }
    doc.scenes.push(a, b)
    const c = compile(doc)
    const tr = c.sceneTimes[1]!.transition
    expect(tr.strength < 1 || tr.used === 'direct').toBe(true)
    expect(tr.note).toBeTruthy()
    expect(validate(doc, c).issues.filter((i) => i.kind === 'near-miss')).toEqual([])
  })

  it('the return flight can use a transition too', () => {
    const doc = show(undefined)
    doc.site.returnFlight.style = { kind: 'cascade', amount: 0.6, order: 'top' }
    const c = compile(doc)
    expect(c.returnFlight.transition.used).toBe('cascade')
    expect(validate(doc, c).issues).toEqual([])
    // Landing home keeps each drone's pad: styles that reorder drones fall back.
    doc.site.landing = 'home'
    doc.site.returnFlight.style = { kind: 'ant', amount: 0.6 }
    expect(compile(doc).returnFlight.transition.used).toBe('direct')
  })

  it('round-trips through the file format', () => {
    const doc = show({ kind: 'swirl', amount: 0.6, turns: -0.75 })
    doc.scenes[0]!.flight.style = { kind: 'cascade', amount: 0.4, order: 'edge' }
    const back = normalizeDoc(JSON.parse(JSON.stringify(doc)))
    expect(back.scenes[1]!.flight.style).toEqual({ kind: 'swirl', amount: 0.6, turns: -0.75 })
    expect(back.scenes[0]!.flight.style).toEqual({ kind: 'cascade', amount: 0.4, order: 'edge' })
    expect(normalizeDoc(JSON.parse(JSON.stringify(show(undefined)))).scenes[1]!.flight.style).toBeUndefined()
  })
})
