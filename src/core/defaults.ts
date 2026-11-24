import type { Effect, Layer, Limits, Mask, Scene, ShapeKind, ShapeSpec, ShowDoc, Site, TextFont, Vec3 } from './types'
import { SHAPE_BY_KIND, generateShape } from './shapes'
import { allocate, sceneGeometry } from './compile'
import { ceilTo, minPairDistance } from './math'
import { defaultEffect } from './effects'
import { PALETTE } from './color'
import { comfortableSpacing } from './validate'
import { pixelTextMask } from './pixelFont'

export const DEFAULT_LIMITS: Limits = {
  minSpacing: 2,
  maxSpeedH: 6,
  maxSpeedUp: 3,
  maxSpeedDown: 2,
  maxAccel: 3,
  minAltitude: 10,
  maxAltitude: 120,
  maxRadius: 150,
  maxFlightTime: 15 * 60,
}

export const DEFAULT_SITE: Site = {
  gridSpacing: 3,
  takeoffAltitude: 6,
  audienceDistance: 160,
  landing: 'any',
  returnFlight: { duration: null, dim: false },
}

export const DEFAULT_CENTER: Vec3 = [0, 55, 0]

let counter = 0
export function newId(prefix = 'id'): string {
  counter = (counter + 1) % 1e6
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function newShow(droneCount = 200, name = 'Untitled show'): ShowDoc {
  return {
    version: 1,
    name,
    droneCount,
    limits: { ...DEFAULT_LIMITS },
    site: { ...DEFAULT_SITE, returnFlight: { ...DEFAULT_SITE.returnFlight } },
    scenes: [],
    cues: [],
    audio: null,
  }
}

/** Rasteriser for text shapes. The UI swaps in a canvas-based one for sans/serif fonts. */
export type TextRasterizer = (text: string, font: TextFont) => Mask

let rasterizer: TextRasterizer = (text) => pixelTextMask(text)

export function setTextRasterizer(fn: TextRasterizer): void {
  rasterizer = fn
}

export function rasterizeText(text: string, font: TextFont): Mask {
  return font === 'pixel' ? pixelTextMask(text) : rasterizer(text, font)
}

export function newShape(kind: ShapeKind): ShapeSpec {
  const spec = SHAPE_BY_KIND[kind].create()
  if (spec.kind === 'text') return { ...spec, mask: rasterizeText(spec.text, spec.font) }
  return spec
}

export function newLayer(shape: ShapeSpec, effect: Effect): Layer {
  return { id: newId('layer'), shape, weight: 1, offset: [0, 0, 0], rotation: [0, 0, 0], effect }
}

/** Spacing of a shape at size 1 with `count` drones. */
export function unitSpacing(shape: ShapeSpec, count: number): number {
  if (count < 2) return Infinity
  return minPairDistance(generateShape({ ...shape, size: 1 } as ShapeSpec, count).points)
}

/** Size that gives exactly `target` spacing (rounded up to 10 cm). */
export function fittedSize(shape: ShapeSpec, count: number, target: number): number {
  const u = unitSpacing(shape, count)
  if (!Number.isFinite(u) || u <= 0) return shape.size
  return ceilTo(target / u, 0.1)
}

/**
 * Resize a scene's layers so every drone is at least `target` apart.
 * 'exact' sets each layer to its fitted size; 'grow' only ever enlarges.
 * If layers overlap each other, sizes and offsets are scaled together.
 */
export function fitScene(scene: Scene, n: number, target: number, mode: 'exact' | 'grow'): Scene {
  const counts = allocate(n, scene.layers.map((l) => l.weight))
  let layers = scene.layers.map((l, i) => {
    const size = fittedSize(l.shape, counts[i]!, target)
    const next = mode === 'grow' ? Math.max(size, l.shape.size) : size
    return { ...l, shape: { ...l.shape, size: next } as ShapeSpec }
  })
  let out: Scene = { ...scene, layers }
  if (n > 1) {
    const d = minPairDistance(sceneGeometry(out, n).points)
    if (d + 1e-6 < target && d > 0) {
      const k = (target / d) * 1.001
      layers = layers.map((l) => ({
        ...l,
        shape: { ...l.shape, size: ceilTo(l.shape.size * k, 0.1) } as ShapeSpec,
        offset: l.offset.map((v) => v * k) as Vec3,
      }))
      out = { ...out, layers }
    }
  }
  return out
}

export function newScene(doc: ShowDoc, kind: ShapeKind, opts: { name?: string; position?: Vec3; color?: string; shape?: ShapeSpec; effect?: Effect } = {}): Scene {
  const color = opts.color ?? PALETTE[doc.scenes.length % PALETTE.length]!
  const shape = opts.shape ?? newShape(kind)
  const label = SHAPE_BY_KIND[shape.kind].label
  const effect = opts.effect ?? (shape.kind === 'image' && shape.colors ? defaultEffect('image') : defaultEffect('solid', color))
  const scene: Scene = {
    id: newId('scene'),
    name: opts.name ?? (shape.kind === 'text' ? shape.text.replace(/\n/g, ' ') || 'Text' : label),
    hold: 6,
    flight: { duration: null, dim: false },
    position: opts.position ?? [...DEFAULT_CENTER],
    rotation: [0, 0, 0],
    spin: 0,
    layers: [newLayer(shape, effect)],
  }
  return placeAboveFloor(fitScene(scene, doc.droneCount, comfortableSpacing(doc.limits.minSpacing), 'exact'), doc)
}

/** Raise a scene so its lowest drone clears the minimum altitude with a margin. */
export function placeAboveFloor(scene: Scene, doc: ShowDoc, margin = 5): Scene {
  const pts = sceneGeometry(scene, doc.droneCount).points
  let minY = Infinity
  for (let i = 1; i < pts.length; i += 3) minY = Math.min(minY, pts[i]!)
  const floor = doc.limits.minAltitude + margin
  if (!(minY < floor)) return scene
  const dy = Math.ceil(floor - minY)
  return { ...scene, position: [scene.position[0], scene.position[1] + dy, scene.position[2]] }
}
