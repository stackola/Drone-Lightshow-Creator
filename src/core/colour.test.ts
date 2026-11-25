import { describe, expect, it } from 'vitest'
import { blankLook, effectColor, type BeatPhase } from './effects'
import { parseProjectFile, toProjectFile } from './serialize'
import { newScene, newShow } from './defaults'
import { effectFromInput } from '@/ai/convert'
import type { Effect } from './types'
import type { RGB } from './color'

const noBeat: BeatPhase = () => null
const at = (e: Effect, u: number, v: number, tau = 0, image: RGB | null = null, rand = 0.3): RGB => effectColor(e, { ...blankLook(), u, v, rand, image }, tau, tau, noBeat, [0, 0, 0])

describe('palette', () => {
  const sunset: Effect = { kind: 'palette', colors: ['#ff0000', '#00ff00', '#0000ff'], mode: 'linear', angle: 0, speed: 0, brightness: 1 }
  it('spreads its colours across the shape in order', () => {
    expect(at(sunset, -1, 0)).toEqual([1, 0, 0])
    expect(at(sunset, 0, 0)).toEqual([0, 1, 0])
    expect(at(sunset, 1, 0)).toEqual([0, 0, 1])
  })
  it('radial runs from the centre to the edge', () => {
    const r: Effect = { ...sunset, mode: 'radial' }
    expect(at(r, 0, 0)).toEqual([1, 0, 0])
    expect(at(r, 0.6, 0.8)).toEqual([0, 0, 1])
  })
  it('flows: the colours cycle through the shape over time', () => {
    const flow: Effect = { ...sunset, speed: 0.25 }
    const a = at(flow, 0, 0, 0), b = at(flow, 0, 0, 1)
    expect(a).not.toEqual(b)
    expect(at(flow, 0, 0, 4)).toEqual(a.map((x) => expect.closeTo(x, 6)))
  })
})

describe('shape colours brought to life', () => {
  const gold: RGB = [1, 0.8, 0.2]
  it('shimmer only dims and brightens the shape’s own colour', () => {
    const e: Effect = { kind: 'image', brightness: 1, anim: 'shimmer', speed: 1 }
    for (const tau of [0, 0.7, 1.9, 3.3]) {
      const c = at(e, 0.2, 0.1, tau, gold)
      expect(c[0]! / c[1]!).toBeCloseTo(1 / 0.8, 5)
      expect(c[0]).toBeGreaterThanOrEqual(0.69)
    }
  })
  it('a glint sweeps a band of white across', () => {
    const e: Effect = { kind: 'image', brightness: 1, anim: 'glint', speed: 1 }
    let whitest = 0
    for (let tau = 0; tau < 6; tau += 0.05) whitest = Math.max(whitest, at(e, 0, 0, tau, gold)[2]!)
    expect(whitest).toBeGreaterThan(0.8)
    expect(at({ kind: 'image', brightness: 1 }, 0, 0, 1, gold)).toEqual(gold)
  })
})

describe('colour effects in files and from the AI', () => {
  it('round-trip', () => {
    const doc = newShow(40)
    const sc = newScene(doc, 'heart')
    doc.scenes.push({ ...sc, layers: [{ ...sc.layers[0]!, effect: { kind: 'palette', colors: ['#2b1055', '#d53369', '#ffb347'], mode: 'radial', angle: 0, speed: 0.1, brightness: 0.9 } }] })
    doc.scenes.push({ ...sc, id: 'b', layers: [{ ...sc.layers[0]!, effect: { kind: 'image', brightness: 1, anim: 'sparkle', speed: 2 } }] })
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc, null))).doc
    expect(back.scenes[0]!.layers[0]!.effect).toEqual(doc.scenes[0]!.layers[0]!.effect)
    expect(back.scenes[1]!.layers[0]!.effect).toEqual(doc.scenes[1]!.layers[0]!.effect)
  })
  it('the AI asks for a palette or living shape colours', () => {
    expect(effectFromInput({ effect: 'palette', colors: ['#2b1055', '#d53369', '#ffb347'], palette_mode: 'radial', speed: 0.1 })).toEqual({ kind: 'palette', colors: ['#2b1055', '#d53369', '#ffb347'], mode: 'radial', angle: 90, speed: 0.1, brightness: 1 })
    expect(effectFromInput({ effect: 'image', animate: 'glint' })).toEqual({ kind: 'image', brightness: 1, anim: 'glint', speed: 1 })
  })
})
