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

describe('richer parts and relief', () => {
  const nn = (p: Float32Array) => {
    const n = p.length / 3
    let min = Infinity
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) min = Math.min(min, Math.hypot(p[i * 3]! - p[j * 3]!, p[i * 3 + 1]! - p[j * 3 + 1]!, p[i * 3 + 2]! - p[j * 3 + 2]!))
    return min
  }
  it('plate, tube and lathe become drones on their surfaces', () => {
    const star: [number, number][] = Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 0.2 : 0.5, a = Math.PI / 2 + (i * Math.PI) / 5; return [r * Math.cos(a), r * Math.sin(a)] })
    const plate = sampleModel([{ type: 'plate', center: [0, 0, 0], points: star, depth: 0.3, rotation: [0, 0, 0], color: '#ffcc00' }], 150)!
    expect(plate.points.length).toBe(450)
    const tube = sampleModel([{ type: 'tube', path: [[-1, 0, 0], [0, 0.6, 0], [1, 0, 0]], radius: 0.15, color: '#00ccff' }], 120)!
    expect(tube.hiddenParts).toEqual([])
    const vase = sampleModel([{ type: 'lathe', center: [0, 0, 0], profile: [[0.3, -1], [0.5, -0.4], [0.2, 0.4], [0.35, 1]], rotation: [0, 0, 0], color: '#ff66aa' }], 200)!
    // Rotationally symmetric: drones all round, at the profile's radius for their height.
    let left = 0, right = 0
    for (let i = 0; i < 200; i++) { if (vase.points[i * 3]! < -0.05) left++; if (vase.points[i * 3]! > 0.05) right++ }
    expect(Math.abs(left - right)).toBeLessThan(40)
  })

  it('a thin plate or a thin tube is one sheet or one line of drones, so it stays compact', () => {
    const wing = sampleModel([{ type: 'plate', center: [0, 0, 0], points: [[-1, 0], [1, 0], [0.6, 0.5], [-0.6, 0.5]], depth: 0.01, rotation: [0, 0, 0], color: '#fff' }], 80)!
    for (let i = 0; i < 80; i++) expect(Math.abs(wing.points[i * 3 + 2]!)).toBeLessThan(1e-6)
    const whisker = sampleModel([{ type: 'tube', path: [[0, 0, 0], [1, 0.2, 0], [2, 0, 0]], radius: 0.005, color: '#fff' }], 30)!
    expect(nn(whisker.points)).toBeGreaterThan(0.025)
  })

  it('relief puts the drones on the side the audience sees, closer together there', () => {
    const ball = [{ type: 'sphere' as const, center: [0, 0, 0] as [number, number, number], radius: 1, color: '#fff' }]
    const all = sampleModel(ball, 200)!, front = sampleModel(ball, 200, { relief: true })!
    const behind = (p: Float32Array) => { let k = 0; for (let i = 0; i < 200; i++) if (p[i * 3 + 2]! < -0.1) k++; return k }
    expect(behind(all.points)).toBeGreaterThan(60)
    expect(behind(front.points)).toBe(0)
    expect(nn(front.points)).toBeLessThan(nn(all.points))
  })
})

describe('new 3D model formations', () => {
  it('light up in the model’s own colours, not a solid colour', () => {
    const doc = newShow(120)
    const s = newScene(doc, 'model', { shape: { kind: 'model', size: 1, name: 'Rocket', parts: SAMPLE_MODEL } })
    expect(s.layers[0]!.effect.kind).toBe('image')
  })
})
