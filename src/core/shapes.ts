// Shape generators. Each returns exactly `n` points in local metres, centred
// on the origin, in the XY "picture plane" (facing the audience) unless the
// shape is 3D. Every generator is linear in `size`.

import type { Fill, Mask, ModelJoint, ModelPart, ShapeKind, ShapeSpec } from './types'
import { sampleModel, solidsKey } from './model3d'
import { hash01 } from './math'
import { glyphMap, textPointOrder, type GlyphMap } from './textOrder'
import {
  base64ToBytes, decodeMask, encodeMask, gather, maskCandidates, polygonCandidates, readingOrder, sampleCurve,
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
  // A traced picture's source doesn't change where drones sit (its traced lines do).
  const { size: _size, picture: _picture, ...rest } = spec as ShapeSpec & { size: number; picture?: unknown }
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

/** Hexagonal packing: each drone of a filled area covers about this × spacing² of it. */
const HEX = Math.sqrt(3) / 2

/**
 * A drawing's strokes as drones: each line gets drones evenly along its
 * length (`spacing` apart), skipping any that would land on a drone already
 * placed (where strokes cross or meet). Returns points and their pen order.
 */
function lineDrones(lines: [number, number][][], closed: boolean[], spacing: number): { pts: number[]; order: number[] } {
  const pts: number[] = [], order: number[] = []
  const cell = spacing
  const grid = new Map<number, number[]>()
  const key = (x: number, y: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663)
  const near = (x: number, y: number) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const k of grid.get((Math.floor(x / cell + a) * 73856093) ^ (Math.floor(y / cell + b) * 19349663)) ?? []) {
        if (Math.hypot(pts[k * 3]! - x, pts[k * 3 + 1]! - y) < spacing * 0.6) return true
      }
    }
    return false
  }
  let pen = 0
  lines.forEach((line, li) => {
    const lens = line.slice(1).map((q, i) => Math.hypot(q[0] - line[i]![0], q[1] - line[i]![1]))
    const total = lens.reduce((a, b) => a + b, 0)
    // A stroke much shorter than the spacing would be a stray dot or two: leave it out.
    if (!(total > 0) || total < spacing * 0.75) return
    const steps = Math.max(1, Math.round(total / spacing))
    const count = closed[li] ? steps : steps + 1
    let seg = 0, acc = 0
    for (let k = 0; k < count; k++) {
      const target = (total * k) / steps
      while (seg < lens.length - 1 && acc + lens[seg]! < target) { acc += lens[seg]!; seg++ }
      const t = lens[seg]! > 0 ? Math.min(1, (target - acc) / lens[seg]!) : 0
      const a = line[seg]!, b = line[seg + 1]!
      const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t
      if (near(x, y)) continue
      const idx = pts.length / 3
      pts.push(x, y, 0)
      order.push(pen + target)
      const kk = key(x, y)
      const l = grid.get(kk)
      if (l) l.push(idx)
      else grid.set(kk, [idx])
    }
    pen += total
  })
  return { pts, order: order.map((o) => o / Math.max(1e-9, pen)) }
}

function imageShape(spec: Extract<ShapeSpec, { kind: 'image' }>, n: number): ShapePoints {
  const { mask } = spec
  if (!mask.w || !mask.h) return plain(sunflower(n))
  const [w, h] = maskSize(mask.w, mask.h)
  if (spec.lines?.length || (spec.style && spec.style !== 'lines')) return drawingShape(spec, n, w, h)
  const cand = maskCandidates(mask, w, h, Math.max(n * 30, 3000))
  if (cand.length === 0) return plain(sunflower(n))
  const pts = readingOrder(gather(cand, spreadPick(cand, n)), 0.02)
  return { points: pts, colors: rasterColors(spec, pts, n, w, h) }
}

/**
 * Strokes and fills: find the spacing at which the strokes (one drone per
 * spacing of length) plus the filled area (hexagonally packed) take exactly
 * n drones, place the strokes' drones, then fill the area around them.
 */
/**
 * Level of detail: keep strokes in order of importance (longest first) and
 * leave out any that runs mostly within `reach` spacings of strokes already
 * kept — with this few drones it would only blur into them. Returns the kept
 * strokes' indices, in their original order.
 */
function strokesForSpacing(lines: [number, number][][], lens: number[], s: number, reach = 1.4, closed: boolean[] = [], colors: ([number, number, number] | null)[] = []): number[] {
  // Closed shapes (heads, eyes, gems, petals) are features: they go first, then the longest lines.
  const weight = (i: number) => lens[i]! * (closed[i] ? 3 : 1)
  const order = lines.map((_, i) => i).sort((a, b) => weight(b) - weight(a))
  const cell = s * reach
  const grid = new Map<number, [number, number, number][]>() // x, y, owner
  const key = (x: number, y: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663)
  const samples = (line: [number, number][]) => {
    const out: [number, number][] = []
    for (let i = 1; i < line.length; i++) {
      const [ax, ay] = line[i - 1]!, [bx, by] = line[i]!
      const L = Math.hypot(bx - ax, by - ay), k = Math.max(1, Math.ceil(L / (s / 2)))
      for (let j = i === 1 ? 0 : 1; j <= k; j++) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k])
    }
    return out
  }
  // A line in a clearly different colour still reads beside another: it only half counts as crowding.
  const differs = (i: number, j: number) => {
    const a = colors[i], b = colors[j]
    return !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.35
  }
  const near = (x: number, y: number, i: number): number => {
    let best = 0
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const [qx, qy, j] of grid.get((Math.floor(x / cell + a) * 73856093) ^ (Math.floor(y / cell + b) * 19349663)) ?? []) {
        if (Math.hypot(qx - x, qy - y) >= cell) continue
        best = Math.max(best, differs(i, j) ? 0.5 : 1)
        if (best === 1) return 1
      }
    }
    return best
  }
  const kept: number[] = []
  for (const i of order) {
    const pts = samples(lines[i]!)
    let close = 0
    for (const [x, y] of pts) close += near(x, y, i)
    if (pts.length && close / pts.length > (closed[i] ? 0.6 : 0.4)) continue
    kept.push(i)
    for (const p of pts) { const k = key(p[0], p[1]); const l = grid.get(k); const e: [number, number, number] = [p[0], p[1], i]; if (l) l.push(e); else grid.set(k, [e]) }
  }
  return kept.sort((a, b) => a - b)
}

type Picture = Extract<ShapeSpec, { kind: 'image' }>

/**
 * A drawing as drones, in its style:
 * - lines (default): every stroke one evenly spaced line of drones (fills only where the picture has solid areas);
 * - filled: drones spread evenly over the whole silhouette (what the lines enclose), in the lines' colours;
 * - adaptive: lines while the figure they make fits a typical show sky (about 100 m tall
 *   and 200 m wide at 3 m between drones); with more drones than the lines can hold within it, a
 *   clean filled silhouette instead, so the figure stays compact.
 */
function drawingShape(spec: Picture, n: number, w: number, h: number): ShapePoints {
  const style = spec.style ?? 'lines'
  if (style === 'lines') return layoutDrawing(spec, n, w, h).shape
  const sil = silhouetteOf(spec, w, h)
  if (style === 'filled' || !spec.lines?.length) {
    let cand = maskCandidates(sil.inside, w, h, Math.max(n * 30, 3000))
    if (cand.length / 3 < n) cand = maskCandidates(spec.mask, w, h, Math.max(n * 30, 3000))
    if (cand.length / 3 < n) return layoutDrawing({ ...spec, style: 'lines' }, n, w, h).shape
    const points = readingOrder(gather(cand, spreadPick(cand, n)), 0.02)
    return { points, colors: insideColors(spec, sil, points, 0, n, w, h, 1) }
  }
  // Lines while the figure they make stays within a typical show sky (about 100 m tall and 200 m wide
  // at 3 m between drones); beyond that, fill the inside so it stays compact.
  const linesOnly = layoutDrawing(spec, n, w, h)
  if (linesOnly.spacing >= Math.max((3 * h) / 100, (3 * w) / 200)) return linesOnly.shape
  // More drones than the lines can hold within the sky: a clean filled silhouette instead.
  return drawingShape({ ...spec, style: 'filled' }, n, w, h)
}

interface Silhouette {
  /** Everything the drawing encloses (lines, their insides and the picture's fills). */
  inside: Mask
  /** Its area in shape units. */
  area: number
  /** Points along the lines with their colours, for colouring the inside. */
  samples: { x: Float32Array; y: Float32Array; c: Float32Array }
}

const silhouettes = new WeakMap<object, Silhouette>()

/**
 * The drawing's silhouette: its lines (thickened a little to close small
 * gaps) and the picture's fills, plus everything they enclose — what is
 * not reachable from the border.
 */
function silhouetteOf(spec: Picture, w: number, h: number): Silhouette {
  const cacheKey = spec.lines ?? spec.mask
  const hit = silhouettes.get(cacheKey)
  if (hit) return hit
  const gw = 256, gh = Math.max(1, Math.round((256 * h) / w))
  const ink = new Uint8Array(gw * gh)
  const mpx = decodeMask(spec.mask)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const mx = Math.min(spec.mask.w - 1, Math.floor(((x + 0.5) / gw) * spec.mask.w)), my = Math.min(spec.mask.h - 1, Math.floor(((y + 0.5) / gh) * spec.mask.h))
      if (mpx[my * spec.mask.w + mx]) ink[y * gw + x] = 1
    }
  // Lines, drawn 3 px wide (closes small gaps before the flood fill).
  const sx: number[] = [], sy: number[] = []
  for (const l of spec.lines ?? []) {
    for (let i = 0; i + 3 < l.p.length; i += 2) {
      const ax = l.p[i]! * gw, ay = l.p[i + 1]! * gh, bx = l.p[i + 2]! * gw, by = l.p[i + 3]! * gh
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2))
      for (let k = 0; k <= steps; k++) {
        const x = ax + ((bx - ax) * k) / steps, y = ay + ((by - ay) * k) / steps
        sx.push(x); sy.push(y)
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const px = Math.floor(x) + dx, py = Math.floor(y) + dy
          if (px >= 0 && py >= 0 && px < gw && py < gh) ink[py * gw + px] = 1
        }
      }
    }
  }
  // Outside: flood from the border through everything that isn't ink.
  const outside = new Uint8Array(gw * gh)
  const stack: number[] = []
  const push = (i: number) => { if (!ink[i] && !outside[i]) { outside[i] = 1; stack.push(i) } }
  for (let x = 0; x < gw; x++) { push(x); push((gh - 1) * gw + x) }
  for (let y = 0; y < gh; y++) { push(y * gw); push(y * gw + gw - 1) }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % gw, y = (i - x) / gw
    if (x > 0) push(i - 1)
    if (x < gw - 1) push(i + 1)
    if (y > 0) push(i - gw)
    if (y < gh - 1) push(i + gw)
  }
  let count = 0
  for (let i = 0; i < gw * gh; i++) if (!outside[i]) count++
  const inside = encodeMask(gw, gh, (x, y) => !outside[y * gw + x])
  // Colours along the lines (a sample every few pixels).
  const k = Math.max(1, Math.floor(sx.length / 4000))
  const m = Math.ceil(sx.length / k)
  const pts = new Float32Array(m * 3)
  const X = new Float32Array(m), Y = new Float32Array(m)
  for (let j = 0; j < m; j++) {
    X[j] = (sx[j * k]! / gw - 0.5) * w; Y[j] = (0.5 - sy[j * k]! / gh) * h
    pts[j * 3] = X[j]!; pts[j * 3 + 1] = Y[j]!
  }
  const c = rasterColors(spec, pts, m, w, h) ?? new Float32Array(m * 3).fill(1)
  const out: Silhouette = { inside, area: (count / (gw * gh)) * w * h, samples: { x: X, y: Y, c } }
  silhouettes.set(cacheKey, out)
  return out
}

/**
 * Colours for drones from index `from` on: the picture's own colour inside its
 * solid fills, otherwise the colour of the nearest line (× brightness).
 */
function insideColors(spec: Picture, sil: Silhouette, pts: Float32Array, from: number, n: number, w: number, h: number, brightness: number): Float32Array | null {
  const raster = rasterColors(spec, pts, n, w, h)
  const out = raster ? raster.slice() : new Float32Array(n * 3).fill(1)
  const { x: X, y: Y, c } = sil.samples
  if (!X.length) return out
  const mpx = decodeMask(spec.mask)
  const cell = 0.02 * Math.max(w, h)
  const grid = new Map<number, number[]>()
  const key = (a: number, b: number) => a * 100003 + b
  for (let j = 0; j < X.length; j++) { const kk = key(Math.floor(X[j]! / cell), Math.floor(Y[j]! / cell)); const l = grid.get(kk); if (l) l.push(j); else grid.set(kk, [j]) }
  for (let i = from; i < n; i++) {
    const x = pts[i * 3]!, y = pts[i * 3 + 1]!
    // In the picture's own solid fills, keep its colour.
    const mx = Math.min(spec.mask.w - 1, Math.max(0, Math.floor((x / w + 0.5) * spec.mask.w))), my = Math.min(spec.mask.h - 1, Math.max(0, Math.floor((0.5 - y / h) * spec.mask.h)))
    if (mpx[my * spec.mask.w + mx]) continue
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell)
    let best = -1, bd = Infinity
    for (let r = 0; r < 40 && best < 0; r++) {
      for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue
        for (const j of grid.get(key(cx + a, cy + b)) ?? []) { const d = (X[j]! - x) ** 2 + (Y[j]! - y) ** 2; if (d < bd) { bd = d; best = j } }
      }
    }
    if (best < 0) continue
    for (let a = 0; a < 3; a++) out[i * 3 + a] = c[best * 3 + a]! * brightness
  }
  return out
}

/** Strokes (and the fills of `spec.mask`) for n drones; also returns the spacing and how many drones are on strokes. */
function layoutDrawing(spec: Picture, n: number, w: number, h: number, fixedSpacing?: number): { shape: ShapePoints; spacing: number; strokes: number; ok: boolean } {
  const all = (spec.lines ?? []).map((l) => { const out: [number, number][] = []; for (let i = 0; i + 1 < l.p.length; i += 2) out.push([(l.p[i]! - 0.5) * w, (0.5 - l.p[i + 1]!) * h]); return { pts: out, closed: !!l.closed } }).filter((l) => l.pts.length >= 2)
  const lens = all.map((l) => l.pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - l.pts[i]![0], q[1] - l.pts[i]![1]), 0))
  const px = decodeMask(spec.mask)
  let on = 0
  for (let i = 0; i < px.length; i++) on += px[i]!
  const area = (on / Math.max(1, spec.mask.w * spec.mask.h)) * w * h
  // Spacing such that strokes + fill hold about n drones (strokes: length/s, fill: area/(HEX·s²)).
  const fillFor = (s: number) => Math.round(area / (HEX * s * s))
  let lines = all.map((l) => l.pts), closed = all.map((l) => l.closed)
  const solve = () => {
    const count = (s: number) => lineDrones(lines, closed, s).pts.length / 3 + fillFor(s)
    let lo = 1e-4, hi = 2
    for (let it = 0; it < 30; it++) { const mid = Math.sqrt(lo * hi); if (count(mid) > n) lo = mid; else hi = mid }
    return hi
  }
  // Each line's colour (from the picture along it), so differently coloured neighbours both survive.
  const lineColors = all.map((l) => {
    const n2 = Math.min(8, l.pts.length), pts = new Float32Array(n2 * 3)
    for (let k = 0; k < n2; k++) { const q = l.pts[Math.floor((k * (l.pts.length - 1)) / Math.max(1, n2 - 1))]!; pts[k * 3] = q[0]; pts[k * 3 + 1] = q[1] }
    const c = rasterColors(spec, pts, n2, w, h)
    if (!c) return null
    const avg: [number, number, number] = [0, 0, 0]
    for (let k = 0; k < n2; k++) for (let a = 0; a < 3; a++) avg[a] = avg[a]! + c[k * 3 + a]! / n2
    return avg
  })
  let s = fixedSpacing ?? solve()
  // Fewer drones, less detail: drop strokes that would blur into stronger ones at this spacing, then re-solve.
  for (let it = 0; it < 4; it++) {
    const keep = strokesForSpacing(all.map((l) => l.pts), lens, s, 1.9 - 1.1 * Math.max(0, Math.min(1, spec.detail ?? 0.5)), all.map((l) => l.closed), lineColors)
    if (keep.length === lines.length) break
    lines = keep.map((i) => all[i]!.pts)
    closed = keep.map((i) => all[i]!.closed)
    if (fixedSpacing === undefined) s = solve()
    else break
  }
  const ld = lineDrones(lines, closed, s)
  let strokes = ld.pts.length / 3
  // Too many stroke drones for the fleet (only strokes): drop every other one from the end, evenly.
  while (strokes > n) {
    const keep = n / strokes
    const pts: number[] = [], order: number[] = []
    for (let k = 0; k < strokes; k++) if (Math.floor((k + 1) * keep) > Math.floor(k * keep)) { pts.push(ld.pts[k * 3]!, ld.pts[k * 3 + 1]!, 0); order.push(ld.order[k]!) }
    ld.pts = pts; ld.order = order; strokes = pts.length / 3
  }
  const fillN = n - strokes
  let fill: Float32Array = new Float32Array(0)
  if (fillN > 0) {
    let cand = maskCandidates(spec.mask, w, h, Math.max(fillN * 30, 3000))
    // Keep fill drones clear of the strokes' drones.
    if (strokes) {
      const keep: number[] = []
      const cell = s
      const grid = new Map<number, number[]>()
      const key = (x: number, y: number) => (Math.floor(x / cell) * 73856093) ^ (Math.floor(y / cell) * 19349663)
      for (let k = 0; k < strokes; k++) { const kk = key(ld.pts[k * 3]!, ld.pts[k * 3 + 1]!); const l = grid.get(kk); if (l) l.push(k); else grid.set(kk, [k]) }
      for (let i = 0; i < cand.length / 3; i++) {
        const x = cand[i * 3]!, y = cand[i * 3 + 1]!
        let clear = true
        for (let a = -1; a <= 1 && clear; a++) for (let b = -1; b <= 1 && clear; b++) {
          for (const k of grid.get((Math.floor(x / cell + a) * 73856093) ^ (Math.floor(y / cell + b) * 19349663)) ?? []) {
            if (Math.hypot(ld.pts[k * 3]! - x, ld.pts[k * 3 + 1]! - y) < s * 0.85) { clear = false; break }
          }
        }
        if (clear) keep.push(i)
      }
      cand = gather(cand, Int32Array.from(keep))
    }
    if (cand.length / 3 >= fillN) fill = readingOrder(gather(cand, spreadPick(cand, fillN)), 0.02)
    else {
      // No room left to fill (at this spacing): let the caller decide, or put more drones on the strokes.
      if (fixedSpacing !== undefined) return { shape: { points: new Float32Array(n * 3), colors: null }, spacing: s, strokes, ok: false }
      return layoutDrawing({ ...spec, mask: { ...spec.mask, bits: '' } }, n, w, h)
    }
  }
  const points = new Float32Array(n * 3)
  points.set(ld.pts.slice(0, strokes * 3))
  points.set(fill, strokes * 3)
  // Pen order: along the strokes first (as drawn), then the fill top to bottom.
  const order = new Float32Array(n)
  for (let k = 0; k < strokes; k++) order[k] = ld.order[k]! * (fillN ? 0.7 : 1)
  for (let k = 0; k < fillN; k++) order[strokes + k] = 0.7 + (0.3 * k) / Math.max(1, fillN - 1)
  return { shape: { points, colors: rasterColors(spec, points, n, w, h), order }, spacing: s, strokes, ok: true }
}

function rasterColors(spec: Picture, pts: Float32Array, n: number, w: number, h: number): Float32Array | null {
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
  return colors
}
