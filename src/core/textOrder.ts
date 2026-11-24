// Pen order for text formations.
//
// Text is rasterised to a mask, so the strokes are not known. We recover them:
//   1. split the mask into glyphs (lines by empty rows, letters by empty columns);
//   2. thin each glyph to a one-pixel skeleton (Zhang–Suen);
//   3. trace the skeleton like a pen: start at the top-left stroke end, follow
//      the line, preferring to keep going straight at junctions;
//   4. give every mask pixel the pen position of its nearest skeleton pixel.
// A drone's order is then (glyph + fraction of that glyph's pen path) / glyphs,
// so "write on" effects draw letters one after another in a natural stroke
// order, and typewriter/flip effects can reveal whole letters.

import type { Mask } from './types'
import { decodeMask } from './sample'

export interface GlyphMap {
  /** Glyph index per pixel (−1 = empty). */
  glyph: Int32Array
  /** Pen fraction 0..1 within its glyph per pixel (NaN = empty). */
  pen: Float32Array
  glyphs: number
  w: number
  h: number
}

/** Glyph segmentation: lines separated by empty rows, letters by empty columns within a line. */
function segment(px: Uint8Array, w: number, h: number): { glyph: Int32Array; count: number } {
  const glyph = new Int32Array(w * h).fill(-1)
  let count = 0
  let y = 0
  while (y < h) {
    // Find the next band of non-empty rows.
    while (y < h && !rowHas(px, w, y)) y++
    if (y >= h) break
    const y0 = y
    while (y < h && rowHas(px, w, y)) y++
    const y1 = y
    let x = 0
    while (x < w) {
      while (x < w && !colHas(px, w, x, y0, y1)) x++
      if (x >= w) break
      const g = count++
      while (x < w && colHas(px, w, x, y0, y1)) {
        for (let yy = y0; yy < y1; yy++) if (px[yy * w + x]) glyph[yy * w + x] = g
        x++
      }
    }
  }
  return { glyph, count }
}

function rowHas(px: Uint8Array, w: number, y: number): boolean {
  for (let x = 0; x < w; x++) if (px[y * w + x]) return true
  return false
}

function colHas(px: Uint8Array, w: number, x: number, y0: number, y1: number): boolean {
  for (let y = y0; y < y1; y++) if (px[y * w + x]) return true
  return false
}

/** Zhang–Suen thinning on a copy padded by one pixel; returns the skeleton at the original size. */
export function thin(px: Uint8Array, w: number, h: number): Uint8Array {
  const W = w + 2, H = h + 2
  const img = new Uint8Array(W * H)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[(y + 1) * W + x + 1] = px[y * w + x]!
  const del: number[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const i = y * W + x
          if (!img[i]) continue
          const p2 = img[i - W]!, p3 = img[i - W + 1]!, p4 = img[i + 1]!, p5 = img[i + W + 1]!
          const p6 = img[i + W]!, p7 = img[i + W - 1]!, p8 = img[i - 1]!, p9 = img[i - W - 1]!
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let a = 0
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) a++
          if (a !== 1) continue
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue
          del.push(i)
        }
      }
      for (const i of del) img[i] = 0
      if (del.length) changed = true
    }
  }
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = img[(y + 1) * W + x + 1]!
  return out
}

const NB: [number, number][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]

/** Trace skeleton pixels of one glyph in pen order; returns pixel indices in visiting order. */
function trace(skel: Uint8Array, glyph: Int32Array, g: number, pixels: number[], w: number, h: number): number[] {
  const inG = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && skel[y * w + x] === 1 && glyph[y * w + x] === g
  const degree = (i: number) => {
    const x = i % w, y = (i / w) | 0
    let d = 0
    for (const [dx, dy] of NB) if (inG(x + dx, y + dy)) d++
    return d
  }
  const seen = new Set<number>()
  const order: number[] = []
  while (seen.size < pixels.length) {
    // Start a stroke at the top-left-most free end (or any pixel of a closed loop).
    let start = -1, best = Infinity
    for (const i of pixels) {
      if (seen.has(i)) continue
      const score = (i % w) + ((i / w) | 0) * 1.2 + (degree(i) === 1 ? 0 : 1e6)
      if (score < best) { best = score; start = i }
    }
    if (start < 0) break
    // Depth-first, preferring to continue in the current direction.
    const stack: { i: number; dx: number; dy: number }[] = [{ i: start, dx: 0, dy: 1 }]
    while (stack.length) {
      const { i, dx, dy } = stack.pop()!
      if (seen.has(i)) continue
      seen.add(i)
      order.push(i)
      const x = i % w, y = (i / w) | 0
      const next = NB.filter(([ax, ay]) => inG(x + ax, y + ay) && !seen.has((y + ay) * w + x + ax))
        // Push the best-aligned neighbour last so it is visited first.
        .sort((p, q) => (p[0] * dx + p[1] * dy) / Math.hypot(...p) - (q[0] * dx + q[1] * dy) / Math.hypot(...q))
      for (const [ax, ay] of next) stack.push({ i: (y + ay) * w + x + ax, dx: ax, dy: ay })
    }
  }
  return order
}

/** Glyphs and pen order for every pixel of a text mask. */
export function glyphMap(mask: Mask): GlyphMap {
  const { w, h } = mask
  const px = decodeMask(mask)
  const { glyph, count } = segment(px, w, h)
  const skel = thin(px, w, h)
  const pen = new Float32Array(w * h).fill(NaN)
  // Pen position along each glyph's skeleton.
  const byGlyph: number[][] = Array.from({ length: count }, () => [])
  for (let i = 0; i < w * h; i++) if (skel[i] && glyph[i]! >= 0) byGlyph[glyph[i]!]!.push(i)
  const queue: number[] = []
  for (let g = 0; g < count; g++) {
    const pixels = byGlyph[g]!
    if (!pixels.length) continue
    const order = trace(skel, glyph, g, pixels, w, h)
    order.forEach((i, k) => { pen[i] = order.length > 1 ? k / (order.length - 1) : 0; queue.push(i) })
  }
  // Every other pixel takes the pen position of its nearest skeleton pixel (multi-source BFS within its glyph).
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!
    const x = i % w, y = (i / w) | 0
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const j = ny * w + nx
      if (!px[j] || !Number.isNaN(pen[j]!) || glyph[j] !== glyph[i]) continue
      pen[j] = pen[i]!
      queue.push(j)
    }
  }
  // Glyphs too thin to have a skeleton: left to right.
  for (let i = 0; i < w * h; i++) {
    if (px[i] && Number.isNaN(pen[i]!)) pen[i] = (i % w) / Math.max(1, w - 1)
  }
  return { glyph, pen, glyphs: count, w, h }
}

/**
 * Order value for text points (in the shape's coordinates: mask width scaled
 * to `width`, height 1, centred): (glyph + pen fraction) / glyphs.
 */
export function textPointOrder(map: GlyphMap, width: number, pts: Float32Array): Float32Array {
  const n = pts.length / 3
  const out = new Float32Array(n)
  const G = Math.max(1, map.glyphs)
  for (let k = 0; k < n; k++) {
    const px = Math.min(map.w - 1, Math.max(0, Math.floor(((pts[k * 3]! + width / 2) / width) * map.w)))
    const py = Math.min(map.h - 1, Math.max(0, Math.floor((0.5 - pts[k * 3 + 1]!) * map.h)))
    let i = py * map.w + px
    if (map.glyph[i]! < 0) i = nearestOn(map, px, py)
    const g = i >= 0 ? map.glyph[i]! : 0
    const f = i >= 0 && Number.isFinite(map.pen[i]!) ? map.pen[i]! : 0.5
    out[k] = (Math.max(0, g) + Math.min(0.999, Math.max(0, f))) / G
  }
  return out
}

function nearestOn(map: GlyphMap, x: number, y: number): number {
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue
      if (map.glyph[ny * map.w + nx]! >= 0) return ny * map.w + nx
    }
  }
  return -1
}
