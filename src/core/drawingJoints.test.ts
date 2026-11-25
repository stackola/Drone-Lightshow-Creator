import { describe, expect, it } from 'vitest'
import { fitScene, newScene, newShow } from './defaults'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { settleParts } from './fixes'
import { hasMovingParts } from './joints'
import { NO_PART, generateShape } from './shapes'
import { encodeMask } from './sample'
import { safeSpacing } from './site'
import { comfortableSpacing } from './separation'
import { parseProjectFile, toProjectFile } from './serialize'
import type { DrawingPart, DrawnLine, ModelJoint, Scene, ShapeSpec, ShowDoc } from './types'

// A bird drawn from the front (picture coordinates: fractions from the top-left): a round body,
// and a wing on each side as a long loop from the shoulder out to the tip and back.
const circle = (cx: number, cy: number, r: number): number[] => Array.from({ length: 24 }, (_, i) => [cx + r * Math.cos((i / 24) * Math.PI * 2), cy + r * Math.sin((i / 24) * Math.PI * 2)]).flat()
// The wings start a little clear of the body, at the shoulder, as a drone artist would draw them.
const BODY: DrawnLine = { p: circle(0.5, 0.55, 0.07), closed: true }
const LEFT: DrawnLine = { p: [0.4, 0.53, 0.25, 0.4, 0.06, 0.35, 0.14, 0.47, 0.4, 0.57], part: 0 }
const RIGHT: DrawnLine = { p: [0.6, 0.53, 0.75, 0.4, 0.94, 0.35, 0.86, 0.47, 0.6, 0.57], part: 1 }
const PARTS: DrawingPart[] = [{ name: 'Left wing', joint: 'lw' }, { name: 'Right wing', joint: 'rw' }]
// Both wings rise together: mirrored axes, the same phase. Pivots at the shoulders.
const JOINTS: ModelJoint[] = [
  { id: 'lw', name: 'Left wing', pivot: [0.4, 0.55, 0], kind: 'swing', axis: [0, 0, -1], amount: 14, period: 12, phase: 0 },
  { id: 'rw', name: 'Right wing', pivot: [0.6, 0.55, 0], kind: 'swing', axis: [0, 0, 1], amount: 14, period: 12, phase: 0 },
]
const empty = encodeMask(100, 100, () => false)
const drawing = (extra: Partial<Extract<ShapeSpec, { kind: 'image' }>> = {}): Extract<ShapeSpec, { kind: 'image' }> =>
  ({ kind: 'image', size: 60, name: 'Bird', mask: empty, colors: null, cw: 0, ch: 0, lines: [BODY, LEFT, RIGHT], parts: PARTS, joints: JOINTS, ...extra })

function show(shape: ShapeSpec, hold = 40): ShowDoc {
  // 120 drones on lines 3 m apart: a bird about 200 m wide, within the flight area.
  const doc = newShow(120)
  const base = newScene(doc, 'circle')
  const s: Scene = { ...base, name: 'Bird', hold, position: [0, 60, 0], layers: [{ ...base.layers[0]!, shape }] }
  doc.scenes.push(fitScene(s, doc.droneCount, comfortableSpacing(safeSpacing(doc.limits)), 'grow'), { ...newScene(doc, 'circle'), position: [0, 60, 0] })
  doc.scenes[0] = settleParts(doc.scenes[0]!, doc, { prefer: 'calm' })
  return doc
}

describe('moving parts in drawings', () => {
  it('each drone knows its part: the tagged strokes move, the body is still', () => {
    const g = generateShape(drawing(), 160)
    expect(g.parts).toBeDefined()
    expect(g.frame?.scale).toEqual([1, -1, 1])
    let left = 0, right = 0, still = 0
    for (let k = 0; k < 160; k++) {
      const x = g.points[k * 3]! / 60
      if (g.parts![k] === 0) { left++; expect(x).toBeLessThan(-0.08) }
      else if (g.parts![k] === 1) { right++; expect(x).toBeGreaterThan(0.08) }
      else { still++; expect(g.parts![k]).toBe(NO_PART) }
    }
    expect(left).toBeGreaterThan(20)
    expect(Math.abs(left - right)).toBeLessThanOrEqual(2)
    expect(still).toBeGreaterThan(20)
    // Without parts nothing is tagged (and nothing else about the drawing changes).
    const plain = generateShape(drawing({ parts: undefined, joints: undefined }), 160)
    expect(plain.parts).toBeUndefined()
    expect(Array.from(plain.points)).toEqual(Array.from(g.points))
  })

  it('a drawn bird flaps: wings rise together, the body stays, and it lands back at rest — safely', () => {
    const doc = show(drawing())
    expect(hasMovingParts(doc.scenes[0]!)).toBe(true)
    expect(validate(doc, compile(doc)).issues.map((i) => `${i.title}: ${i.detail}`)).toEqual([])
    const c = compile(doc)
    const cs = c.scenes[0]!
    expect(cs.anim).not.toBeNull()
    expect(cs.anim!.chains.length).toBe(2)
    const t = c.sceneTimes[0]!
    const n = doc.droneCount
    const period = (doc.scenes[0]!.layers[0]!.shape as { joints: ModelJoint[] }).joints[0]!.period
    const rest = new Float32Array(n * 3), up = new Float32Array(n * 3), end = new Float32Array(n * 3)
    evaluate(c, t.holdStart, rest, null)
    // sin peaks a quarter beat in; mid-hold the swing is at full strength.
    const mid = t.holdStart + (t.holdEnd - t.holdStart) / 2
    const peak = mid - ((((mid - t.holdStart) / period) % 1) - 0.25) * period
    evaluate(c, peak, up, null)
    evaluate(c, t.holdEnd - 1e-6, end, null)
    let leftUp = 0, rightUp = 0, bodyMoved = 0
    for (let i = 0; i < n; i++) {
      const k = cs.slot[i]!
      const dy = up[i * 3 + 1]! - rest[i * 3 + 1]!
      if (cs.anim!.chainOf[k]! < 0) bodyMoved = Math.max(bodyMoved, Math.hypot(dy, up[i * 3]! - rest[i * 3]!))
      else if (rest[i * 3]! < cs.center[0]) leftUp = Math.max(leftUp, dy)
      else rightUp = Math.max(rightUp, dy)
      // Back at rest when the hold ends, ready for the next flight.
      expect(Math.hypot(end[i * 3]! - rest[i * 3]!, end[i * 3 + 1]! - rest[i * 3 + 1]!)).toBeLessThan(1e-3)
    }
    expect(bodyMoved).toBe(0)
    // Calmed to what the drones can climb and descend (3 and 2 m/s): a 250 m line drawing's wing
    // tips are 87 m from the shoulders, so a few degrees — but the tips still rise metres.
    expect((doc.scenes[0]!.layers[0]!.shape as { joints: ModelJoint[] }).joints[0]!.amount).toBeGreaterThan(2)
    expect(leftUp).toBeGreaterThan(2)
    expect(rightUp).toBeGreaterThan(2)
    // Drawings move in their own plane here: no drone leaves it.
    for (let i = 0; i < n; i++) expect(Math.abs(up[i * 3 + 2]! - rest[i * 3 + 2]!)).toBeLessThan(1e-3)
  })

  it('a traced picture moves by outline: drones inside a part’s region follow its joint', () => {
    // No tagged strokes: the left half of the picture is the moving part.
    const lines = [BODY, { p: LEFT.p }, { p: RIGHT.p }]
    const parts: DrawingPart[] = [{ name: 'Left wing', joint: 'lw', region: [[0, 0.2], [0.415, 0.2], [0.415, 0.8], [0, 0.8]] }]
    const g = generateShape(drawing({ lines, parts, joints: [JOINTS[0]!] }), 160)
    for (let k = 0; k < 160; k++) {
      const x = g.points[k * 3]! / 60
      if (x < -0.09) expect(g.parts![k]).toBe(0)
      if (x > -0.07) expect(g.parts![k]).toBe(NO_PART)
    }
  })

  it('fill drones go with their nearest stroke, so a filled wing flaps whole', () => {
    const g = generateShape(drawing({ style: 'filled' }), 200)
    let left = 0, right = 0
    for (let k = 0; k < 200; k++) {
      const x = g.points[k * 3]! / 60
      if (x < -0.2) { expect(g.parts![k]).toBe(0); left++ }
      if (x > 0.2) { expect(g.parts![k]).toBe(1); right++ }
    }
    expect(left).toBeGreaterThan(10)
    expect(right).toBeGreaterThan(10)
  })

  it('flapping too hard is caught and calmed until it is safe', () => {
    const wild = JOINTS.map((j) => ({ ...j, amount: 70, period: 1.5 }))
    const doc = show(drawing({ joints: wild }))
    expect(validate(doc, compile(doc)).issues).toEqual([])
    const j = (doc.scenes[0]!.layers[0]!.shape as { joints: ModelJoint[] }).joints[0]!
    expect(j.amount < 70 || j.period > 1.5).toBe(true)
  })

  it('round-trips through project files', () => {
    const doc = show(drawing())
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    const s = back.scenes[0]!.layers[0]!.shape as Extract<ShapeSpec, { kind: 'image' }>
    expect(s.parts).toEqual(PARTS)
    expect(s.joints?.map((j) => j.id)).toEqual(['lw', 'rw'])
    expect(s.lines?.map((l) => l.part)).toEqual([undefined, 0, 1])
    expect(s.joints![0]!.pivot).toEqual([0.4, 0.55, 0])
  })
})
