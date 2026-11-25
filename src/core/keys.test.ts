import { describe, expect, it } from 'vitest'
import { newScene, newShow } from './defaults'
import { compile, findCompiledScene } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { autoFix } from './fixes'
import { ease, keyPose, normalizeKeys } from './keys'
import { parseProjectFile, toProjectFile } from './serialize'
import type { HoldKey, ShowDoc } from './types'

function show(keys: HoldKey[], opts: { hold?: number; spin?: number } = {}): ShowDoc {
  const doc = newShow(60)
  doc.scenes.push({ ...newScene(doc, 'heart'), position: [0, 50, 0], hold: opts.hold ?? 12, spin: opts.spin ?? 0, keys }, { ...newScene(doc, 'circle'), position: [0, 50, 0] })
  return doc
}
const k = (t: number, move: [number, number, number] = [0, 0, 0], rotate: [number, number, number] = [0, 0, 0], scale = 1): HoldKey => ({ t, move, rotate, scale })

describe('keyframes while held', () => {
  it('ease in and out of every key (minimum jerk), starting from rest', () => {
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(0.5)).toBeCloseTo(0.5)
    const keys = normalizeKeys([k(8, [0, 0, 0], [0, 90, 0]), k(4, [20, 0, 0])], 12)
    expect(keys.map((x) => x.t)).toEqual([4, 8])
    expect(keyPose(keys, 0).move).toEqual([0, 0, 0])
    expect(keyPose(keys, 4).move[0]).toBeCloseTo(20)
    expect(keyPose(keys, 6).move[0]).toBeCloseTo(10)
    expect(keyPose(keys, 6).rotate[1]).toBeCloseTo(45)
    expect(keyPose(keys, 11).rotate[1]).toBe(90) // holds the last key
  })

  it('move the whole formation; the next flight starts where the keys left it', () => {
    const doc = show([k(14, [25, 10, 0])], { hold: 18 })  // peak speed 1.875·d/T ≈ 3.6 m/s
    const c = compile(doc)
    const cs = c.scenes[0]!
    const t = c.sceneTimes[0]!
    const a = new Float32Array(180), b = new Float32Array(180)
    evaluate(c, t.holdStart + 0.01, a, null)
    evaluate(c, t.holdStart + 16, b, null)
    for (let i = 0; i < 60; i++) {
      expect(b[i * 3]! - a[i * 3]!).toBeCloseTo(25, 1)
      expect(b[i * 3 + 1]! - a[i * 3 + 1]!).toBeCloseTo(10, 1)
    }
    // Continuous into the next flight.
    evaluate(c, t.holdEnd - 1e-4, a, null)
    evaluate(c, t.holdEnd + 1e-4, b, null)
    for (let i = 0; i < 180; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.02)
    expect(cs.endPoints[0]! - cs.points[0]!).toBeCloseTo(25, 4)
    expect(validate(doc, c).issues.map((i) => `${i.title}: ${i.detail}`)).toEqual([])
  })

  it('turn and scale compose with spin, and spacing scales exactly', () => {
    const doc = show([k(12, [0, 0, 0], [0, 0, 20], 1.3), k(24, [0, 0, 0], [0, 0, 0], 1)], { spin: 4, hold: 26 })
    const c = compile(doc)
    expect(validate(doc, c).issues.map((i) => `${i.title}: ${i.detail}`)).toEqual([])
    // At 1.3× the formation is 1.3× larger.
    const cs = c.scenes[0]!
    const t = c.sceneTimes[0]!
    const p = new Float32Array(180)
    evaluate(c, t.holdStart + 12, p, null)
    let ext = 0, ext0 = 0
    for (let i = 0; i < 60; i++) ext = Math.max(ext, Math.hypot(p[i * 3]! - cs.center[0], p[i * 3 + 1]! - cs.center[1], p[i * 3 + 2]! - cs.center[2]))
    for (let i = 0; i < 60; i++) ext0 = Math.max(ext0, Math.hypot(cs.points[i * 3]! - cs.center[0], cs.points[i * 3 + 1]! - cs.center[1], cs.points[i * 3 + 2]! - cs.center[2]))
    expect(ext / ext0).toBeCloseTo(1.3, 2)
  })

  it('catches keys that shrink below safe spacing, move too fast or leave the airspace — and the fixes calm them', () => {
    const shrink = show([k(6, [0, 0, 0], [0, 0, 0], 0.3)])
    let v = validate(shrink, compile(shrink))
    expect(v.issues.map((i) => i.id)).toContain(`key-scale:${shrink.scenes[0]!.id}`)
    expect(autoFix(shrink).validation.issues.map((i) => `${i.title}: ${i.detail}`)).toEqual([])

    const fast = show([k(1, [60, 0, 0])])
    v = validate(fast, compile(fast))
    expect(v.issues.some((i) => i.kind === 'spin' && /keyframes/.test(i.detail))).toBe(true)
    expect(autoFix(fast).validation.issues.map((i) => `${i.title}: ${i.detail}`)).toEqual([])

    const high = show([k(8, [0, 200, 0])], { hold: 16 })
    v = validate(high, compile(high))
    expect(v.issues.some((i) => i.id.startsWith('alt-high:'))).toBe(true)
    // The ceiling check is proven: never below what the drones actually reach.
    const c = compile(high), t = c.sceneTimes[0]!
    const p = new Float32Array(180)
    let top = 0
    for (let s = t.holdStart; s <= t.holdEnd; s += 0.01) { evaluate(c, s, p, null); for (let i = 1; i < 180; i += 3) top = Math.max(top, p[i]!) }
    const reported = Number(v.issues.find((i) => i.id.startsWith('alt-high:'))!.detail.match(/at ([\d.]+) m/)![1])
    expect(reported).toBeGreaterThanOrEqual(Math.floor(top * 10) / 10)
    // The fix calms the keyframes (the formation fits as placed), and the show comes out clean.
    expect(v.issues.find((i) => i.id.startsWith('alt-high:'))!.fix?.action.kind).toBe('calm-hold')
    expect(autoFix(high).validation.issues.map((i) => i.title)).toEqual([])
  })

  it('work on group formations and save with the show', () => {
    const doc = show([k(4, [-10, 0, 0], [0, 45, 0], 1.2)])
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    expect(back.scenes[0]!.keys).toEqual(doc.scenes[0]!.keys)
    expect(findCompiledScene(compile(back), back.scenes[0]!.id)!.keys.length).toBe(1)
  })
})
