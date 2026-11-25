import { describe, expect, it } from 'vitest'
import { fitScene, newScene, newShow } from './defaults'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { autoFix, settleParts } from './fixes'
import { articulate, jointValue, partsSeparation, type CJoint } from './joints'
import { SAMPLE_BIRD } from './shapes'
import { safeSpacing } from './site'
import { comfortableSpacing } from './separation'
import { parseProjectFile, toProjectFile } from './serialize'
import type { ModelJoint, Scene, ShowDoc } from './types'

function birdShow(joints: ModelJoint[] = SAMPLE_BIRD.joints, hold = 48): ShowDoc {
  const doc = newShow(200)
  const base = newScene(doc, 'circle')
  const bird: Scene = {
    ...base, name: 'Bird', hold, position: [0, 60, 0],
    layers: [{ ...base.layers[0]!, shape: { kind: 'model', size: 24, name: 'Bird', parts: SAMPLE_BIRD.parts, joints } }],
  }
  doc.scenes.push(fitScene(bird, doc.droneCount, comfortableSpacing(safeSpacing(doc.limits)), 'grow'), { ...newScene(doc, 'circle'), position: [0, 60, 0] })
  return doc
}

/** The preset bird, calmed to what 200 drones can fly. */
function settledBird(): ShowDoc {
  const doc = birdShow()
  doc.scenes[0] = settleParts(doc.scenes[0]!, doc, { prefer: 'calm' })
  return doc
}

const issues = (doc: ShowDoc) => validate(doc, compile(doc)).issues.map((i) => `${i.title}: ${i.detail}`)

describe('moving parts', () => {
  it('ease in from rest and back to rest: swing is smooth at both ends of the hold', () => {
    const j: CJoint = { kind: 'swing', pivot: [0, 0, 0], axis: [0, 0, 1], amount: 0.3, period: 6, phase: 0.25, parent: -1, label: 'x' }
    expect(jointValue(j, 20, 0)).toBe(0)
    expect(jointValue(j, 20, 20)).toBeCloseTo(0, 12)
    // Zero velocity and acceleration at the start: displacement grows like t³.
    expect(Math.abs(jointValue(j, 20, 0.01))).toBeLessThan(1e-5)
    // Full swing mid-hold.
    let peak = 0
    for (let t = 4; t < 16; t += 0.01) peak = Math.max(peak, Math.abs(jointValue(j, 20, t)))
    expect(peak).toBeCloseTo(0.3, 3)
  })

  it('a bird flaps its wings: the wings move, the body stays, and it lands back at rest', () => {
    const doc = settledBird()
    const m = doc.scenes[0]!.layers[0]!.shape
    // Calmed (not slowed) to fit 200 drones: still a visible flap at the same beat.
    expect(m.kind === 'model' && m.joints![0]!.period).toBe(12)
    expect(m.kind === 'model' && m.joints![0]!.amount).toBeLessThan(14)
    const c = compile(doc)
    const cs = c.scenes[0]!
    expect(cs.anim).not.toBeNull()
    expect(cs.anim!.chains.length).toBe(4) // inner and outer half of each wing
    const t = c.sceneTimes[0]!
    const n = doc.droneCount
    const rest = new Float32Array(n * 3), mid = new Float32Array(n * 3), end = new Float32Array(n * 3)
    evaluate(c, t.holdStart, rest, null)
    evaluate(c, t.holdStart + 24 + 12 / 4, mid, null) // the wings at the top of a beat
    evaluate(c, t.holdEnd - 1e-6, end, null)
    let wingMoved = 0, bodyMoved = 0
    for (let i = 0; i < n; i++) {
      const k = cs.slot[i]!
      const d = Math.hypot(mid[i * 3]! - rest[i * 3]!, mid[i * 3 + 1]! - rest[i * 3 + 1]!, mid[i * 3 + 2]! - rest[i * 3 + 2]!)
      if (cs.anim!.chainOf[k]! >= 0) wingMoved = Math.max(wingMoved, d)
      else bodyMoved = Math.max(bodyMoved, d)
      expect(Math.abs(end[i * 3 + 1]! - rest[i * 3 + 1]!)).toBeLessThan(1e-3)
    }
    expect(wingMoved).toBeGreaterThan(2)
    expect(bodyMoved).toBe(0)
    // Both wings rise together (mirrored axes, same phase).
    let left = 0, right = 0
    for (let i = 0; i < n; i++) {
      const k = cs.slot[i]!
      if (cs.anim!.chainOf[k]! < 0) continue
      const dy = mid[i * 3 + 1]! - rest[i * 3 + 1]!
      if (rest[i * 3]! > cs.center[0] + 6) right = Math.max(right, dy)
      if (rest[i * 3]! < cs.center[0] - 6) left = Math.max(left, dy)
    }
    expect(left).toBeGreaterThan(1.5)
    expect(right).toBeGreaterThan(1.5)
    expect(Math.abs(left - right)).toBeLessThan(0.5)
    expect(issues(doc)).toEqual([])
  })

  it('flapping too fast is caught and calmed until it is safe', () => {
    const fast = SAMPLE_BIRD.joints.map((j) => ({ ...j, amount: Math.round(j.amount * 0.3), period: 4 }))
    const doc = birdShow(fast)
    const v = validate(doc, compile(doc))
    const speed = v.issues.find((i) => i.id.startsWith('spin:'))
    expect(speed?.detail).toMatch(/moving its parts/)
    // Slowing the beat keeps the flap visible (the swing stays as wide).
    expect(speed?.fix?.action.kind).toBe('slow-parts')
    const fixed = autoFix(doc)
    expect(fixed.validation.issues.map((i) => i.title)).toEqual([])
    const j = fixed.doc.scenes[0]!.layers[0]!.shape
    expect(j.kind === 'model' && j.joints![0]!.period).toBeGreaterThan(4)
    expect(j.kind === 'model' && j.joints![0]!.amount).toBe(fast[0]!.amount)
  })

  it('parts that swing into each other are caught (proven between samples) and fixed', () => {
    // Wings folding 80° down cross the tail.
    const folding = SAMPLE_BIRD.joints.map((j) => ({ ...j, amount: j.parent ? 0 : 80, period: 60, phase: 0.5 }))
    const doc = birdShow(folding, 40)
    const c = compile(doc)
    const cs = c.scenes[0]!
    const sep = partsSeparation(cs.anim!, cs.points, cs.hold, doc.limits.minSpacing)!
    expect(sep.d).toBeLessThan(doc.limits.minSpacing)
    // The reported pair really is that close at that time.
    const p = articulate(cs.anim!, cs.points, cs.hold, sep.t, new Float32Array(cs.points.length))
    expect(Math.hypot(p[sep.i * 3]! - p[sep.j * 3]!, p[sep.i * 3 + 1]! - p[sep.j * 3 + 1]!, p[sep.i * 3 + 2]! - p[sep.j * 3 + 2]!)).toBeCloseTo(sep.d, 4)
    const v = validate(doc, c)
    expect(v.issues.some((i) => i.id === `parts:${cs.id}`)).toBe(true)
    expect(autoFix(doc).validation.issues.map((i) => i.title)).toEqual([])
  })

  it('a turning part leaves the formation turned, and the next flight starts there', () => {
    const doc = newShow(120)
    const ring = newScene(doc, 'circle')
    const s: Scene = {
      ...ring, hold: 16, position: [0, 60, 0],
      layers: [
        { ...ring.layers[0]!, id: 'ring', shape: { kind: 'circle', size: 70, fill: 'outline' }, weight: 2 },
        { ...ring.layers[0]!, id: 'star', shape: { kind: 'star', size: 40, points: 5, inner: 0.45, fill: 'outline' }, weight: 1, joint: { kind: 'turn', anchor: [0, 0, 0], axis: [0, 0, 1], amount: 4, period: 6, phase: 0 } },
      ],
    }
    doc.scenes.push(s, { ...newScene(doc, 'heart'), position: [0, 50, 0] })
    const c = compile(doc)
    const cs = c.scenes[0]!
    expect(cs.anim!.chainOf.filter((x) => x >= 0).length).toBe(40)
    const t = c.sceneTimes[0]!
    const a = new Float32Array(360), b = new Float32Array(360)
    evaluate(c, t.holdEnd - 1e-5, a, null)
    evaluate(c, t.holdEnd + 1e-5, b, null)
    for (let i = 0; i < 360; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.01)
    let turned = 0
    for (let k = 0; k < 120; k++) turned = Math.max(turned, Math.abs(cs.endPoints[k * 3]! - cs.points[k * 3]!))
    expect(turned).toBeGreaterThan(1)
    expect(issues(doc)).toEqual([])
  })

  it('round-trips through project files', () => {
    const doc = settledBird()
    doc.scenes[1]!.layers[0]!.joint = { kind: 'swing', anchor: [0, 1, 0], axis: [0, 0, 1], amount: 12, period: 8, phase: 0.5 }
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    expect(back.scenes[0]!.layers[0]!.shape).toEqual(doc.scenes[0]!.layers[0]!.shape)
    expect(back.scenes[1]!.layers[0]!.joint).toEqual(doc.scenes[1]!.layers[0]!.joint)
  })
})
