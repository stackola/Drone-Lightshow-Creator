import { describe, expect, it } from 'vitest'
import { newLayer, newShape, newShow, newScene, fitScene } from './defaults'
import { compile } from './compile'
import { evaluate } from './evaluate'
import { validate } from './validate'
import { comfortableSpacing } from './separation'
import { findScene, groupSizes, mapScene, sceneDroneCount } from './groups'
import type { Group, Scene, ShowDoc } from './types'

const solid = (color: string) => ({ kind: 'solid' as const, color, brightness: 1 })

/** A scene of two circles side by side; each becomes a group. */
function twoCircles(doc: ShowDoc, gap = 30): Scene {
  const left = { ...newLayer({ ...newShape('circle'), size: 8 }, solid('#ff3366')), offset: [-gap, 0, 0] as [number, number, number] }
  const right = { ...newLayer({ ...newShape('circle'), size: 8 }, solid('#33ccff')), offset: [gap, 0, 0] as [number, number, number] }
  return fitScene({ ...newScene(doc, 'circle'), name: 'Pair', layers: [left, right] }, doc.droneCount, comfortableSpacing(doc.limits.minSpacing), 'grow')
}

function step(doc: ShowDoc, n: number, kind: 'heart' | 'star' | 'circle', x: number, hold: number, opts: Partial<Scene> = {}): Scene {
  const sub = { ...doc, droneCount: n }
  const s = fitScene({ ...newScene(sub, kind), position: [x, 40, 0] }, n, comfortableSpacing(doc.limits.minSpacing), 'exact')
  return { ...s, hold, ...opts }
}

function show(opts: { crossing?: boolean; delay?: number } = {}): ShowDoc {
  const doc = newShow(60)
  const pair = twoCircles(doc)
  pair.position = [0, 40, 0]
  pair.hold = 4
  const [a, b] = groupSizes({ ...pair, groups: [{ id: 'g', name: '', layers: [pair.layers[0]!.id], delay: 0, steps: [] }, { id: 'h', name: '', layers: [pair.layers[1]!.id], delay: 0, steps: [] }] }, 60)
  const left: Group = { id: 'gl', name: 'Left', layers: [pair.layers[0]!.id], delay: 0, steps: [step(doc, a!, 'heart', opts.crossing ? 30 : -35, 3)] }
  const right: Group = {
    id: 'gr', name: 'Right', layers: [pair.layers[1]!.id], delay: opts.delay ?? 0,
    steps: [step(doc, b!, 'star', opts.crossing ? -30 : 35, 2), step(doc, b!, 'circle', opts.crossing ? -30 : 40, 5, { spin: 20 })],
  }
  pair.groups = [left, right]
  const merge = { ...newScene(doc, 'circle'), name: 'Together', position: [0, 40, 0] as [number, number, number], hold: 4 }
  doc.scenes = [pair, merge]
  return doc
}

describe('groups: splits and merges', () => {
  it('sizes groups by their shapes and finds steps by id', () => {
    const doc = show()
    const pair = doc.scenes[0]!
    expect(groupSizes(pair, 60)).toEqual([30, 30])
    const st = pair.groups![1]!.steps[1]!
    expect(findScene(doc, st.id)!.group!.id).toBe('gr')
    expect(sceneDroneCount(doc, st.id)).toBe(30)
    const moved = mapScene(doc, st.id, (s, n) => { expect(n).toBe(30); return { ...s, hold: 9 } })
    expect(moved.scenes[0]!.groups![1]!.steps[1]!.hold).toBe(9)
    expect(doc.scenes[0]!.groups![1]!.steps[1]!.hold).toBe(5)
  })

  it('compiles each group on its own clock, then merges', () => {
    const doc = show()
    const c = compile(doc)
    const split = c.segments.find((s) => s.kind === 'split')
    expect(split?.kind).toBe('split')
    if (split?.kind !== 'split') return
    const [L, R] = split.tracks
    expect(L!.drones.length + R!.drones.length).toBe(60)
    // Independent timing: the right group has two steps, the left one; the split lasts as long as the slower group.
    expect(R!.stepTimes.length).toBe(2)
    expect(split.t1).toBeCloseTo(Math.max(L!.end, R!.end), 6)
    // They leave the formation together (one synchronised flight), then each keeps its own pace.
    expect(L!.stepTimes[0]!.holdStart).toBeCloseTo(R!.stepTimes[0]!.holdStart, 6)
    expect(L!.end).not.toBeCloseTo(R!.end, 3)
    const st = c.sceneTimes[0]!
    expect(st.splitEnd).toBeCloseTo(split.t1, 6)
    expect(c.sceneTimes[1]!.flightStart).toBeCloseTo(split.t1, 6)

    // Positions are continuous across every boundary, and drones sit on their step formations while held.
    const a = new Float32Array(180), b = new Float32Array(180)
    for (const t of [split.t0, L!.stepTimes[0]!.flightStart, L!.stepTimes[0]!.holdStart, R!.stepTimes[1]!.holdStart, L!.end, split.t1]) {
      evaluate(c, t - 1e-4, a, null)
      evaluate(c, t + 1e-4, b, null)
      for (let i = 0; i < 180; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(0.05)
    }
    const mid = (L!.stepTimes[0]!.holdStart + L!.stepTimes[0]!.holdEnd) / 2
    evaluate(c, mid, a, null)
    const heart = L!.steps[0]!
    for (let j = 0; j < L!.drones.length; j++) {
      const i = L!.drones[j]!, k = heart.slot[j]!
      expect(Math.hypot(a[i * 3]! - heart.points[k * 3]!, a[i * 3 + 1]! - heart.points[k * 3 + 1]!)).toBeLessThan(1e-3)
    }
    // A group that finishes early waits still for the other one.
    evaluate(c, L!.end + 0.5, a, null)
    evaluate(c, Math.min(split.t1, L!.end + 2), b, null)
    for (const i of L!.drones) expect(Math.abs(a[i * 3]! - b[i * 3]!)).toBeLessThan(1e-4)
  })

  it('passes every check when groups keep apart', () => {
    const doc = show()
    const v = validate(doc, compile(doc))
    expect(v.issues.map((i) => i.title)).toEqual([])
  })

  it('catches groups that cross paths on different clocks, with a real close pass', () => {
    const doc = show({ crossing: true })
    const c = compile(doc)
    const v = validate(doc, c)
    const issue = v.issues.find((i) => i.id.startsWith('groups:'))
    expect(issue, JSON.stringify(v.issues.map((i) => i.title))).toBeTruthy()
    // The reported pair really is that close at that time.
    const p = new Float32Array(180)
    evaluate(c, issue!.time, p, null)
    const [i, j] = issue!.drones as [number, number]
    expect(Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!)).toBeLessThan(doc.limits.minSpacing)
  })

  it('never misses a close pass that fine brute-force sampling can find', () => {
    for (const delay of [0, 1.5, 3, 6]) {
      const doc = show({ crossing: true, delay })
      const c = compile(doc)
      const split = c.segments.find((s) => s.kind === 'split')!
      const v = validate(doc, c)
      const flagged = v.issues.some((i) => i.id.startsWith('groups:'))
      // Brute force: 5 ms steps, cross-group pairs only.
      if (split.kind !== 'split') continue
      const groupOf = new Int32Array(60).fill(-1)
      split.tracks.forEach((tr, k) => { for (const i of tr.drones) groupOf[i] = k })
      const p = new Float32Array(180)
      let min = Infinity
      for (let t = split.t0; t <= split.t1; t += 0.005) {
        evaluate(c, t, p, null)
        for (let i = 0; i < 60; i++) for (let j = i + 1; j < 60; j++) {
          if (groupOf[i] === groupOf[j]) continue
          min = Math.min(min, Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!))
        }
      }
      if (min < doc.limits.minSpacing - 0.01) expect(flagged, `delay ${delay}: brute force min ${min}`).toBe(true)
    }
  })

  it('keeps drones of shapes in no group holding the formation', () => {
    const doc = show()
    const pair = doc.scenes[0]!
    pair.groups = [pair.groups![0]!] // only the left circle splits off
    const c = compile(doc)
    const split = c.segments.find((s) => s.kind === 'split')!
    if (split.kind !== 'split') return
    const rest = split.tracks.find((t) => t.id === '')!
    expect(rest.drones.length).toBe(30)
    const a = new Float32Array(180), b = new Float32Array(180)
    evaluate(c, split.t0 + 0.1, a, null)
    evaluate(c, split.t1 - 0.1, b, null)
    for (const i of rest.drones) expect(Math.abs(a[i * 3]! - b[i * 3]!)).toBeLessThan(1e-4)
    expect(validate(doc, c).issues).toEqual([])
  })
})
