// Shape generators. Each returns exactly `n` points in local metres, centred
// on the origin, in the XY "picture plane" (facing the audience) unless the
// shape is 3D. Every generator is linear in `size`.

import type { Fill, ModelJoint, ModelPart, ShapeKind, ShapeSpec } from './types'
import { sampleModel, solidsKey } from './model3d'
import { hash01 } from './math'
import { glyphMap, textPointOrder, type GlyphMap } from './textOrder'
import {
  base64ToBytes, gather, maskCandidates, polygonCandidates, readingOrder, sampleCurve,
  samplePolygonOutline, spreadPick,
} from './sample'

export interface ShapePoints {
  /** Packed xyz, n points. */
  points: Float32Array
  /** Optional packed rgb 0..1 (image shapes). */
  colors: Float32Array | null
  /** Optional order 0..1 per point (default: index order). Text: pen order, glyph by glyph. */
  order?: Float32Array
  /** Number of letters (text shapes), for letter-by-letter effects. */
  glyphs?: number
  /** 3D models: the part each point lies on, and model units → unit shape (before × size). */
  parts?: Uint16Array
  frame?: { center: [number, number, number]; extent: number }
}

export interface ParamDef {
  key: string
  label: string
  min: number
  max: number
  step: number
  unit?: string
  integer?: boolean
}

export interface ShapeDef {
  kind: ShapeKind
  label: string
  group: '2D' | '3D' | 'Content'
  /** Extra numeric params (size is always present). */
  params: ParamDef[]
  hasFill: boolean
  /** Default spec at size 1 (fitted to spacing on creation). */
  create(): ShapeSpec
}

const TAU = Math.PI * 2
const GOLDEN = Math.PI * (3 - Math.sqrt(5))

export const SHAPES: ShapeDef[] = [
  { kind: 'circle', label: 'Circle', group: '2D', hasFill: true, params: [], create: () => ({ kind: 'circle', size: 1, fill: 'filled' }) },
  { kind: 'heart', label: 'Heart', group: '2D', hasFill: true, params: [], create: () => ({ kind: 'heart', size: 1, fill: 'filled' }) },
  {
    kind: 'star', label: 'Star', group: '2D', hasFill: true,
    params: [
      { key: 'points', label: 'Points', min: 3, max: 12, step: 1, integer: true },
      { key: 'inner', label: 'Inner radius', min: 0.2, max: 0.9, step: 0.05 },
    ],
    create: () => ({ kind: 'star', size: 1, points: 5, inner: 0.45, fill: 'filled' }),
  },
  {
    kind: 'polygon', label: 'Polygon', group: '2D', hasFill: true,
    params: [{ key: 'sides', label: 'Sides', min: 3, max: 12, step: 1, integer: true }],
    create: () => ({ kind: 'polygon', size: 1, sides: 6, fill: 'filled' }),
  },
  {
    kind: 'grid', label: 'Grid', group: '2D', hasFill: true,
    params: [
      { key: 'aspect', label: 'Aspect (w/h)', min: 0.25, max: 4, step: 0.05 },
      { key: 'scatter', label: 'Scatter', min: 0, max: 0.45, step: 0.05 },
    ],
    create: () => ({ kind: 'grid', size: 1, aspect: 1.6, scatter: 0, fill: 'filled' }),
  },
  {
    kind: 'spiral', label: 'Spiral', group: '2D', hasFill: false,
    params: [{ key: 'turns', label: 'Turns', min: 1, max: 8, step: 0.25 }],
    create: () => ({ kind: 'spiral', size: 1, turns: 3 }),
  },
  {
    kind: 'wave', label: 'Wave', group: '2D', hasFill: false,
    params: [
      { key: 'cycles', label: 'Cycles', min: 0.5, max: 6, step: 0.25 },
      { key: 'amplitude', label: 'Amplitude', min: 0, max: 0.5, step: 0.01 },
    ],
    create: () => ({ kind: 'wave', size: 1, cycles: 2, amplitude: 0.15 }),
  },
  { kind: 'sphere', label: 'Sphere', group: '3D', hasFill: false, params: [], create: () => ({ kind: 'sphere', size: 1 }) },
  {
    kind: 'torus', label: 'Torus', group: '3D', hasFill: false,
    params: [{ key: 'thickness', label: 'Thickness', min: 0.1, max: 0.8, step: 0.05 }],
    create: () => ({ kind: 'torus', size: 1, thickness: 0.35 }),
  },
  { kind: 'cube', label: 'Cube', group: '3D', hasFill: false, params: [], create: () => ({ kind: 'cube', size: 1 }) },
  {
    kind: 'helix', label: 'Double helix', group: '3D', hasFill: false,
    params: [
      { key: 'turns', label: 'Turns', min: 0.5, max: 6, step: 0.25 },
      { key: 'radius', label: 'Radius', min: 0.05, max: 0.5, step: 0.01 },
    ],
    create: () => ({ kind: 'helix', size: 1, turns: 2, radius: 0.18 }),
  },
  {
    kind: 'cone', label: 'Cone / tree', group: '3D', hasFill: false,
    params: [{ key: 'radius', label: 'Base radius', min: 0.1, max: 0.8, step: 0.01 }],
    create: () => ({ kind: 'cone', size: 1, radius: 0.35 }),
  },
  {
    kind: 'text', label: 'Text', group: 'Content', hasFill: false, params: [],
    create: () => ({ kind: 'text', size: 1, text: 'HELLO', font: 'sans', mask: { w: 0, h: 0, bits: '' } }),
  },
  {
    kind: 'model', label: '3D model', group: 'Content', hasFill: false, params: [],
    create: () => ({ kind: 'model', size: 1, name: 'Rocket', parts: SAMPLE_MODEL.map((p) => ({ ...p })) }),
  },
  {
    kind: 'image', label: 'Image / logo', group: 'Content', hasFill: false, params: [],
    create: () => ({ kind: 'image', size: 1, name: '', mask: { w: 0, h: 0, bits: '' }, colors: null, cw: 0, ch: 0 }),
  },
]

/** A small rocket — the default 3D model before AI generates one. */
export const SAMPLE_MODEL: ModelPart[] = [
  { type: 'cylinder', from: [0, -0.5, 0], to: [0, 0.6, 0], radius: 0.22, color: '#e8eef8' },
  { type: 'cone', from: [0, 0.6, 0], to: [0, 1.15, 0], radius: 0.22, radiusTop: 0, color: '#ff4d4d' },
  { type: 'box', center: [0.3, -0.35, 0], size: [0.28, 0.4, 0.06], rotation: [0, 0, -20], color: '#ff4d4d' },
  { type: 'box', center: [-0.3, -0.35, 0], size: [0.28, 0.4, 0.06], rotation: [0, 0, 20], color: '#ff4d4d' },
  { type: 'sphere', center: [0, 0.25, 0.2], radius: 0.09, color: '#38bdf8' },
  { type: 'cone', from: [0, -0.5, 0], to: [0, -0.95, 0], radius: 0.18, radiusTop: 0.02, color: '#ffb02e' },
]

/**
 * A bird seen from the front, wings spread: each wing hinges at the shoulder
 * and its outer half at the wrist, lagging a little behind. The swing is
 * the most a big flock could fly; settleParts() calms it to what a given
 * fleet can (wingtips of a 100 m bird travel metres per beat).
 */
export const SAMPLE_BIRD: { parts: ModelPart[]; joints: ModelJoint[] } = {
  parts: [
    { type: 'ellipsoid', center: [0, 0, 0], radii: [0.13, 0.32, 0.12], rotation: [0, 0, 0], color: '#ffb347' },
    { type: 'sphere', center: [0, 0.42, 0.02], radius: 0.11, color: '#ffd27a' },
    { type: 'cone', from: [0, 0.41, 0.1], to: [0, 0.38, 0.24], radius: 0.04, radiusTop: 0, color: '#ff5e3a' },
    { type: 'box', center: [0, -0.5, 0], size: [0.32, 0.36, 0.05], rotation: [0, 0, 0], color: '#ff5e3a' },
    { type: 'ellipsoid', center: [0.4, 0.08, 0], radii: [0.3, 0.11, 0.04], rotation: [0, 0, 8], color: '#ff8c2e', joint: 'wing-r' },
    { type: 'ellipsoid', center: [0.82, 0.14, 0], radii: [0.26, 0.08, 0.03], rotation: [0, 0, 4], color: '#ff5e3a', joint: 'tip-r' },
    { type: 'ellipsoid', center: [-0.4, 0.08, 0], radii: [0.3, 0.11, 0.04], rotation: [0, 0, -8], color: '#ff8c2e', joint: 'wing-l' },
    { type: 'ellipsoid', center: [-0.82, 0.14, 0], radii: [0.26, 0.08, 0.03], rotation: [0, 0, -4], color: '#ff5e3a', joint: 'tip-l' },
  ],
  joints: [
    { id: 'wing-r', name: 'Right wing', kind: 'swing', pivot: [0.12, 0.08, 0], axis: [0, 0, 1], amount: 14, period: 12, phase: 0 },
    { id: 'tip-r', name: 'Right wingtip', kind: 'swing', pivot: [0.6, 0.12, 0], axis: [0, 0, 1], amount: 10, period: 12, phase: -0.08, parent: 'wing-r' },
    { id: 'wing-l', name: 'Left wing', kind: 'swing', pivot: [-0.12, 0.08, 0], axis: [0, 0, -1], amount: 14, period: 12, phase: 0 },
    { id: 'tip-l', name: 'Left wingtip', kind: 'swing', pivot: [-0.6, 0.12, 0], axis: [0, 0, -1], amount: 10, period: 12, phase: -0.08, parent: 'wing-l' },
  ],
}

export const SHAPE_BY_KIND = Object.fromEntries(SHAPES.map((s) => [s.kind, s])) as Record<ShapeKind, ShapeDef>

/** Human label for what `size` means for a shape. */
export function sizeLabel(kind: ShapeKind): string {
  switch (kind) {
    case 'grid': case 'wave': case 'image': return 'Width'
    case 'text': case 'helix': case 'cone': return 'Height'
    case 'model': return 'Size'
    case 'cube': return 'Edge'
    default: return 'Diameter'
  }
}

// --- Outline polygons (unit size) ------------------------------------------

function regularPolygon(sides: number): [number, number][] {
  const r = 0.5
  return Array.from({ length: sides }, (_, i) => {
    const a = Math.PI / 2 + (i / sides) * TAU
    return [r * Math.cos(a), r * Math.sin(a)] as [number, number]
  })
}

function starPolygon(points: number, inner: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? 0.5 : 0.5 * inner
    const a = Math.PI / 2 + (i / (points * 2)) * TAU
    out.push([r * Math.cos(a), r * Math.sin(a)])
  }
  return out
}

function heartPolygon(): [number, number][] {
  const raw: [number, number][] = []
  const M = 720
  for (let i = 0; i < M; i++) {
    const t = (i / M) * TAU
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    raw.push([x, y])
  }
  // Normalise so width = 1, centred on the bounding box.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const [x, y] of raw) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  const s = 1 / (maxX - minX)
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  return raw.map(([x, y]) => [(x - cx) * s, (y - cy) * s])
}

function polyShape(poly: [number, number][], fill: Fill, n: number): Float32Array {
  if (fill === 'outline') return samplePolygonOutline(n, poly)
  const cand = polygonCandidates(poly, Math.max(n * 30, 2000))
  return readingOrder(gather(cand, spreadPick(cand, n)), 0.02)
}

function scale(pts: Float32Array, s: number): Float32Array {
  for (let i = 0; i < pts.length; i++) pts[i]! *= s
  return pts
}

// --- Generators --------------------------------------------------------------

/** Generate at unit size, then scale. Results are cached by (spec minus size, n). */
const cache = new Map<string, ShapePoints>()
const CACHE_MAX = 256

export function generateShape(spec: ShapeSpec, n: number): ShapePoints {
  const key = cacheKey(spec, n)
  let unit = cache.get(key)
  if (!unit) {
    unit = generateUnit(spec, n)
    cache.set(key, unit)
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  }
  return { points: scale(unit.points.slice(), spec.size), colors: unit.colors ? unit.colors.slice() : null, order: unit.order, glyphs: unit.glyphs, parts: unit.parts, frame: unit.frame }
}

function cacheKey(spec: ShapeSpec, n: number): string {
  // Joints only animate the drones; they don't change where drones sit.
  if (spec.kind === 'model') return `${n}|model|${spec.relief ? 'relief|' : ''}${solidsKey(spec.parts)}`
  const { size: _size, ...rest } = spec as ShapeSpec & { size: number }
  return `${n}|${JSON.stringify(rest)}`
}

function generateUnit(spec: ShapeSpec, n: number): ShapePoints {
  if (n <= 0) return { points: new Float32Array(0), colors: null }
  switch (spec.kind) {
    case 'circle':
      if (spec.fill === 'outline') return plain(sampleCurve(n, true, (t) => [0.5 * Math.cos(Math.PI / 2 + t * TAU), 0.5 * Math.sin(Math.PI / 2 + t * TAU), 0]))
      return plain(sunflower(n))
    case 'heart':
      return plain(polyShape(heartPolygon(), spec.fill, n))
    case 'star':
      return plain(polyShape(starPolygon(Math.round(spec.points), spec.inner), spec.fill, n))
    case 'polygon':
      return plain(polyShape(regularPolygon(Math.round(spec.sides)), spec.fill, n))
    case 'grid':
      if (spec.fill === 'outline') {
        // A rectangular frame, width 1 and height 1/aspect.
        const h = 0.5 / Math.max(0.05, spec.aspect)
        return plain(samplePolygonOutline(n, [[-0.5, -h], [0.5, -h], [0.5, h], [-0.5, h]]))
      }
      return plain(grid(n, spec.aspect, spec.scatter ?? 0))
    case 'spiral':
      return plain(sampleCurve(n, false, (t) => {
        const r = 0.5 * (0.08 + 0.92 * t)
        const a = t * spec.turns * TAU
        return [r * Math.cos(a), r * Math.sin(a), 0]
      }))
    case 'wave':
      return plain(sampleCurve(n, false, (t) => [t - 0.5, spec.amplitude * Math.sin(t * spec.cycles * TAU), 0]))
    case 'sphere':
      return plain(fibonacciSphere(n))
    case 'torus':
      return plain(torus(n, spec.thickness))
    case 'cube':
      return plain(cube(n))
    case 'helix':
      return plain(helix(n, spec.turns, spec.radius))
    case 'cone':
      return plain(cone(n, spec.radius))
    case 'text':
      return textShape(spec.mask, n)
    case 'image':
      return imageShape(spec, n)
    case 'model': {
      const m = sampleModel(spec.parts, n, { relief: spec.relief })
      return m ? { points: m.points, colors: m.colors, parts: m.parts, frame: m.frame } : plain(fibonacciSphere(n))
    }
  }
}

function plain(points: Float32Array): ShapePoints {
  return { points, colors: null }
}

/** Vogel sunflower — near-optimal even spacing in a disc of diameter 1. */
function sunflower(n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const r = 0.5 * Math.sqrt((k + 0.5) / n)
    const a = k * GOLDEN
    out[k * 3] = r * Math.cos(a)
    out[k * 3 + 1] = r * Math.sin(a)
  }
  return out
}

/** Rows × cols lattice with width 1; the last row is centred. */
/** Rows a filled grid of n drones has (as laid out by grid()). */
export function gridRows(n: number, aspect: number): number {
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)))
  return Math.ceil(n / cols)
}

/** A grid; `scatter` (0–0.45) jitters each point within its cell for a natural, starry look. */
function grid(n: number, aspect: number, scatter = 0): Float32Array {
  const cols = Math.max(1, Math.round(Math.sqrt(n * aspect)))
  const rows = Math.ceil(n / cols)
  const step = cols > 1 ? 1 / (cols - 1) : 1
  const j = Math.max(0, Math.min(0.45, scatter)) * step
  const out = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols)
    const inRow = r === rows - 1 ? n - r * cols : cols
    const c = k - r * cols
    out[k * 3] = (c - (inRow - 1) / 2) * step + (j ? (hash01(k, 101) - 0.5) * j : 0)
    out[k * 3 + 1] = ((rows - 1) / 2 - r) * step + (j ? (hash01(k, 202) - 0.5) * j : 0)
  }
  return out
}

function fibonacciSphere(n: number): Float32Array {
  const out = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const y = n === 1 ? 0 : 1 - (2 * (k + 0.5)) / n
    const r = Math.sqrt(1 - y * y)
    const a = k * GOLDEN
    out[k * 3] = 0.5 * r * Math.cos(a)
    out[k * 3 + 1] = 0.5 * y
    out[k * 3 + 2] = 0.5 * r * Math.sin(a)
  }
  return out
}

/** Pick `n` evenly spread points from dense, area-uniform surface samples. */
function surface(n: number, sampler: (u: number, v: number) => [number, number, number], areaWeight: (u: number, v: number) => number, density = 40): Float32Array {
  // Area-weighted rejection on a deterministic low-discrepancy sequence.
  const target = Math.max(n * density, 3000)
  const pts: number[] = []
  let i = 0
  while (pts.length / 3 < target && i < target * 20) {
    i++
    // R3 low-discrepancy sequence (plastic-number based).
    const u = (0.5 + i * 0.8191725133961645) % 1
    const v = (0.5 + i * 0.6710436067037893) % 1
    const w = (0.5 + i * 0.5497004779019703) % 1
    if (w > areaWeight(u, v)) continue
    pts.push(...sampler(u, v))
  }
  const cand = Float32Array.from(pts)
  return gather(cand, spreadPick(cand, n, 4))
}

function torus(n: number, thickness: number): Float32Array {
  // Outer diameter 1: R + r = 0.5, r = thickness * 0.5
  const r = 0.5 * thickness * 0.5
  const R = 0.5 - r
  return surface(
    n,
    (u, v) => {
      const a = u * TAU, b = v * TAU
      return [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)]
    },
    (_u, v) => (R + r * Math.cos(v * TAU)) / (R + r),
  )
}

function cube(n: number): Float32Array {
  return surface(
    n,
    (u, v) => {
      const face = Math.min(5, Math.floor(u * 6))
      const a = (u * 6 - face) - 0.5, b = v - 0.5
      switch (face) {
        case 0: return [0.5, a, b]
        case 1: return [-0.5, a, b]
        case 2: return [a, 0.5, b]
        case 3: return [a, -0.5, b]
        case 4: return [a, b, 0.5]
        default: return [a, b, -0.5]
      }
    },
    () => 1,
  )
}

function helix(n: number, turns: number, radius: number): Float32Array {
  const half = Math.ceil(n / 2)
  const a = sampleCurve(half, false, (t) => [radius * Math.cos(t * turns * TAU), t - 0.5, radius * Math.sin(t * turns * TAU)])
  const b = sampleCurve(n - half, false, (t) => [radius * Math.cos(t * turns * TAU + Math.PI), t - 0.5, radius * Math.sin(t * turns * TAU + Math.PI)])
  const out = new Float32Array(n * 3)
  out.set(a, 0)
  out.set(b, half * 3)
  return out
}

function cone(n: number, radius: number): Float32Array {
  // Lateral surface of a cone, apex up, height 1.
  return surface(
    n,
    (u, v) => {
      const h = v // 0 at base, 1 at apex
      const r = radius * (1 - h)
      return [r * Math.cos(u * TAU), h - 0.5, r * Math.sin(u * TAU)]
    },
    (_u, v) => 1 - v,
  )
}

// --- Content shapes ------------------------------------------------------------

function maskSize(w: number, h: number): [number, number] {
  return [1, h / Math.max(1, w)]
}

const glyphCache = new Map<string, GlyphMap>()

function textShape(mask: { w: number; h: number; bits: string }, n: number): ShapePoints {
  if (!mask.w || !mask.h) return plain(sunflower(n))
  // size = cap height: scale so mask height = 1
  const width = mask.w / mask.h
  const cand = maskCandidates(mask, width, 1, Math.max(n * 30, 3000))
  if (cand.length === 0) return plain(sunflower(n))
  const pts = readingOrder(gather(cand, spreadPick(cand, n)), 0.05)
  // Pen order: letters left to right, each in a natural stroke order.
  const key = `${mask.w}x${mask.h}:${mask.bits}`
  let map = glyphCache.get(key)
  if (!map) {
    map = glyphMap(mask)
    if (glyphCache.size > 32) glyphCache.clear()
    glyphCache.set(key, map)
  }
  const ord = textPointOrder(map, width, pts)
  const idx = Array.from({ length: n }, (_, k) => k).sort((a, b) => ord[a]! - ord[b]!)
  const points = new Float32Array(n * 3), order = new Float32Array(n)
  idx.forEach((src, k) => {
    points[k * 3] = pts[src * 3]!; points[k * 3 + 1] = pts[src * 3 + 1]!; points[k * 3 + 2] = pts[src * 3 + 2]!
    order[k] = ord[src]!
  })
  return { points, colors: null, order, glyphs: map.glyphs }
}

function imageShape(spec: Extract<ShapeSpec, { kind: 'image' }>, n: number): ShapePoints {
  const { mask } = spec
  if (!mask.w || !mask.h) return plain(sunflower(n))
  const [w, h] = maskSize(mask.w, mask.h)
  const cand = maskCandidates(mask, w, h, Math.max(n * 30, 3000))
  if (cand.length === 0) return plain(sunflower(n))
  const pts = readingOrder(gather(cand, spreadPick(cand, n)), 0.02)
  let colors: Float32Array | null = null
  if (spec.colors && spec.cw && spec.ch) {
    const rgb = base64ToBytes(spec.colors)
    colors = new Float32Array(n * 3)
    for (let k = 0; k < n; k++) {
      // Map back to colour-raster pixel.
      const u = (pts[k * 3]! + w / 2) / w
      const v = (h / 2 - pts[k * 3 + 1]!) / h
      const px = Math.min(spec.cw - 1, Math.max(0, Math.floor(u * spec.cw)))
      const py = Math.min(spec.ch - 1, Math.max(0, Math.floor(v * spec.ch)))
      const o = (py * spec.cw + px) * 3
      colors[k * 3] = rgb[o]! / 255
      colors[k * 3 + 1] = rgb[o + 1]! / 255
      colors[k * 3 + 2] = rgb[o + 2]! / 255
    }
  }
  return { points: pts, colors }
}
