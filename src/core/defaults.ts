import { safeSpacing } from './site'
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
  maxJerk: 6,
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
  // New formations are valid from the start: safe spacing, inside the airspace.
  return fitToAirspace(fitScene(scene, doc.droneCount, comfortableSpacing(safeSpacing(doc.limits)), 'exact'), doc)
}

/**
 * An LED sign: a grid exactly as tall as the font (7 drones for 5×7 letters,
 * 5 for the compact 3×5 font), one drone per dot, showing scrolling
 * dot-matrix text. Width: `columns`, or as wide as the fleet allows. Drones
 * not in the panel are parked behind it. The hold lets the text pass once.
 * A 5-tall panel needs only 4 columns per letter in view (about 20 drones).
 */
export function newLedSign(doc: ShowDoc, text = 'WELCOME', opts: { color?: string; speed?: number; position?: Vec3; font?: 5 | 7; columns?: number } = {}): Scene {
  const n = doc.droneCount
  const font = opts.font ?? 7
  const rows = Math.min(font, Math.max(1, n))
  const cols = Math.max(1, Math.min(opts.columns ? Math.round(opts.columns) : Infinity, Math.floor(n / rows)))
  const panel = rows * cols
  const spacing = comfortableSpacing(safeSpacing(doc.limits))
  const speed = opts.speed ?? 6
  const effect: Effect = { kind: 'matrix', text: text.toUpperCase(), a: opts.color ?? '#ffb020', b: '#1c1406', speed, font, brightness: 1 }
  const grid: ShapeSpec = { kind: 'grid', size: Math.max(1, (cols - 1) * spacing), aspect: cols / rows, scatter: 0, fill: 'filled' }
  const layers = [{ ...newLayer(grid, effect), weight: panel }]
  if (n > panel) {
    const spare = newLayer(newShape('grid'), defaultEffect('off'))
    layers.push({ ...spare, role: 'park', weight: n - panel, offset: [0, 0, -25] })
  }
  const textCols = [...text].length * (font === 5 ? 4 : 6)
  const scene: Scene = {
    id: newId('scene'),
    name: `LED: ${text}`.slice(0, 60),
    hold: speed > 0 ? Math.ceil((textCols + cols + 2) / speed) + 1 : 6,
    flight: { duration: null, dim: false },
    position: opts.position ?? [...DEFAULT_CENTER],
    rotation: [0, 0, 0],
    spin: 0,
    layers,
  }
  return placeInAirspace(fitScene(scene, n, spacing, 'grow'), doc)
}

/**
 * Give a fraction of the drones to a dark "parking" grid 25 m behind the main
 * shape — for formations that look best with fewer drones (digits, short text).
 */
export function withSpareDrones(scene: Scene, doc: ShowDoc, fraction: number): Scene {
  const f = Math.max(0, Math.min(0.85, fraction))
  const main = scene.layers[0]!
  if (f < 0.01) return scene
  const spare = newLayer(newShape('grid'), defaultEffect('off'))
  spare.role = 'park'
  spare.offset = [0, 0, -25]
  const layers = [{ ...main, weight: 1 - f }, { ...spare, weight: f }]
  const fitted = fitScene({ ...scene, layers }, doc.droneCount, comfortableSpacing(safeSpacing(doc.limits)), 'exact')
  return placeAboveFloor(fitted, doc)
}

function extent(scene: Scene, doc: ShowDoc): { minY: number; maxY: number; reach: number } {
  const pts = sceneGeometry(scene, doc.droneCount).points
  let minY = Infinity, maxY = -Infinity, reach = 0
  for (let i = 0; i < pts.length; i += 3) {
    minY = Math.min(minY, pts[i + 1]!)
    maxY = Math.max(maxY, pts[i + 1]!)
    // Spin can sweep any point around the vertical axis, so count the swept circle.
    const r = Math.hypot(pts[i]! - scene.position[0], pts[i + 2]! - scene.position[2])
    reach = Math.max(reach, Math.hypot(scene.position[0], scene.position[2]) + r)
  }
  return { minY, maxY, reach }
}

/**
 * Make a formation fit the airspace: switch an outline to a filled shape, then
 * park more and more drones dark until it is short and narrow enough; finally
 * place it between the floor and the ceiling.
 */
/** Whether a formation (all its layers, including its spin sweep) is short and narrow enough for the airspace. */
export function fitsAirspace(s: Scene, doc: ShowDoc): boolean {
  const L = doc.limits
  const e = extent(s, doc)
  return e.maxY - e.minY <= L.maxAltitude - L.minAltitude - 6 && e.reach <= L.maxRadius - 2
}

export function fitToAirspace(scene: Scene, doc: ShowDoc): Scene {
  const L = doc.limits
  const fits = (s: Scene) => fitsAirspace(s, doc)
  const target = comfortableSpacing(safeSpacing(L))
  let s = scene
  const main = s.layers[0]!
  if (!fits(s) && 'fill' in main.shape && main.shape.fill === 'outline') {
    s = fitScene({ ...s, layers: [{ ...main, shape: { ...main.shape, fill: 'filled' } as ShapeSpec }, ...s.layers.slice(1)] }, doc.droneCount, target, 'exact')
  }
  // Spare drones the designer gave a role (halo, starfield, …) are kept; only otherwise park more drones.
  const hasRoles = s.layers.some((l) => l.role && l.role !== 'park')
  if (!fits(s) && s.layers.length <= 2 && !hasRoles) {
    const single = { ...s, layers: [s.layers[0]!] }
    const current = s.layers.length === 2 ? s.layers[1]!.weight / (s.layers[0]!.weight + s.layers[1]!.weight) : 0
    for (const f of [0.2, 0.35, 0.5, 0.6, 0.7, 0.8]) {
      if (f <= current) continue
      s = withSpareDrones(single, doc, f)
      if (fits(s)) break
    }
  }
  return placeInAirspace(s, doc)
}

/** Raise above the floor (with margin), then lower below the ceiling if needed. */
export function placeInAirspace(scene: Scene, doc: ShowDoc): Scene {
  let s = placeAboveFloor(scene, doc)
  const e = extent(s, doc)
  const over = e.maxY - (doc.limits.maxAltitude - 2)
  if (over > 0) {
    const room = e.minY - doc.limits.minAltitude
    const dy = Math.min(Math.ceil(over), Math.max(0, Math.floor(room)))
    s = { ...s, position: [s.position[0], s.position[1] - dy, s.position[2]] }
  }
  return s
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
