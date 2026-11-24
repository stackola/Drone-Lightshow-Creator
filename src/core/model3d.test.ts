import { describe, expect, it } from 'vitest'
import { sampleModel } from './model3d'
import { SAMPLE_MODEL } from './shapes'
import { minPairDistance } from './math'
import { newScene, newShow } from './defaults'
import { compile } from './compile'
import { validate } from './validate'
import { modelPart, parseProjectFile, toProjectFile } from './serialize'
import type { ModelPart, ShapeSpec } from './types'

const twoSpheres: ModelPart[] = [
  { type: 'sphere', center: [-0.5, 0, 0], radius: 0.8, color: '#ff0000' },
  { type: 'sphere', center: [0.5, 0, 0], radius: 0.8, color: '#0000ff' },
]

describe('3D model sampling', () => {
  it('yields exactly n distinct points, deterministically, normalised to extent 1', () => {
    for (const n of [12, 150, 400]) {
      const a = sampleModel(SAMPLE_MODEL, n)!
      const b = sampleModel(SAMPLE_MODEL, n)!
      expect(a.points.length).toBe(n * 3)
      expect(Array.from(a.points)).toEqual(Array.from(b.points))
      expect(minPairDistance(a.points)).toBeGreaterThan(0.005)
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
      for (let i = 0; i < a.points.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, a.points[i + k]!); hi[k] = Math.max(hi[k]!, a.points[i + k]!) }
      const ext = Math.max(...hi.map((h, k) => h - lo[k]!))
      // With very few drones, relaxation pulls them in from the extremes.
      if (n >= 100) expect(ext).toBeGreaterThan(0.9)
      expect(ext).toBeLessThanOrEqual(1 + 1e-6)
      lo = hi = []
    }
  })

  it('puts drones only on the outer surface of the union, in each part’s colour', () => {
    const s = sampleModel(twoSpheres, 300)!
    // Raw bounding box is x ∈ [-1.3, 1.3] (extent 2.6), centred at the origin.
    const reds = new Set<string>()
    for (let k = 0; k < 300; k++) {
      const p = [s.points[k * 3]! * 2.6, s.points[k * 3 + 1]! * 2.6, s.points[k * 3 + 2]! * 2.6]
      const d1 = Math.hypot(p[0]! + 0.5, p[1]!, p[2]!), d2 = Math.hypot(p[0]! - 0.5, p[1]!, p[2]!)
      expect(Math.min(Math.abs(d1 - 0.8), Math.abs(d2 - 0.8))).toBeLessThan(0.03) // on a surface
      expect(d1).toBeGreaterThan(0.8 - 0.03) // never buried inside the other sphere
      expect(d2).toBeGreaterThan(0.8 - 0.03)
      reds.add(`${s.colors[k * 3]},${s.colors[k * 3 + 2]}`)
    }
    expect(reds).toEqual(new Set(['1,0', '0,1']))
  })

  it('reports parts that are completely hidden inside others', () => {
    const s = sampleModel([{ type: 'sphere', center: [0, 0, 0], radius: 1, color: '#fff' }, { type: 'sphere', center: [0, 0, 0], radius: 0.3, color: '#f00' }], 80)!
    expect(s.hiddenParts).toEqual([1])
  })

  it('handles every part type', () => {
    const parts: ModelPart[] = [
      { type: 'ellipsoid', center: [0, 0, 0], radii: [0.6, 0.3, 0.2], rotation: [0, 0, 30], color: '#fff' },
      { type: 'box', center: [0, 1, 0], size: [0.4, 0.4, 0.4], rotation: [45, 0, 0], color: '#fff' },
      { type: 'cylinder', from: [1, 0, 0], to: [1, 1, 0], radius: 0.1, color: '#fff' },
      { type: 'cone', from: [-1, 0, 0], to: [-1, 1, 0], radius: 0.3, radiusTop: 0, color: '#fff' },
      { type: 'capsule', from: [0, -1, 0], to: [1, -1, 0.5], radius: 0.1, color: '#fff' },
      { type: 'torus', center: [0, 0, 1], radius: 0.5, tube: 0.1, rotation: [90, 0, 0], color: '#fff' },
    ]
    const s = sampleModel(parts, 200)!
    expect(s.points.every(Number.isFinite)).toBe(true)
    expect(s.hiddenParts).toEqual([])
  })

  it('returns null for an empty or invalid model', () => {
    expect(sampleModel([], 10)).toBeNull()
    expect(sampleModel([{ type: 'sphere', center: [0, 0, 0], radius: 0, color: '#fff' }], 10)).toBeNull()
  })
})

describe('3D models in a show', () => {
  it('a spinning 3D model fits safely and passes every check', () => {
    const doc = newShow(180)
    const scene = newScene(doc, 'model')
    scene.spin = 15
    doc.scenes.push(newScene(doc, 'circle'), scene)
    const v = validate(doc, compile(doc))
    expect(v.issues).toEqual([])
  })

  it('validates parts from files and round-trips models', () => {
    expect(modelPart({ type: 'teapot' })).toBeNull()
    expect(modelPart({ type: 'sphere', radius: -2 })).toMatchObject({ radius: 1e-4 })
    expect(modelPart({ type: 'cone', from: [0, 0, 0], to: [0, 1, 0], radius: 'x', color: 'nope' })).toMatchObject({ radius: 0.3, radiusTop: 0, color: '#ffffff' })
    const doc = newShow(50)
    doc.scenes.push(newScene(doc, 'model'))
    const back = parseProjectFile(JSON.stringify(toProjectFile(doc))).doc
    expect(back).toEqual(doc)
    expect((back.scenes[0]!.layers[0]!.shape as Extract<ShapeSpec, { kind: 'model' }>).parts).toHaveLength(6)
  })
})
