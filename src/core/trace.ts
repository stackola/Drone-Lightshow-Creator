// Picture → drone formation: trace a bright drawing on a dark background
// (a generated "light drawing", or any logo or line art) into the strokes and
// filled areas of an image shape (see shapes.ts drawingShape): every stroke
// becomes one evenly spaced line of drones along its centre, every wide area
// is filled evenly, and each drone takes the picture's colour there.
//
//   1. brightness (max channel), slightly blurred so a neon tube's two edges
//      and its glow merge into one stroke;
//   2. ink = brightness above a threshold (Otsu's, unless given);
//   3. distance transform: where the ink is wider than `fillWidth` it is a
//      filled area, elsewhere it is a stroke;
//   4. strokes are thinned to one-pixel skeletons (Zhang–Suen) and traced
//      into polylines between ends and junctions (and around loops); short
//      spurs are pruned and lines simplified;
//   5. colours: each pixel takes the brightest colour near it, at full
//      brightness, so drones on a thin line get the line's colour.
//
// Pure (no DOM): the browser decodes the picture, this does the rest.

import type { DrawnLine, Mask } from './types'
import { bytesToBase64, encodeMask } from './sample'

export interface TraceOptions {
  /** Brightness 0–1 above which a pixel is part of the drawing; null = automatic. */
  threshold: number | null
  /** Ink wider than this (fraction of the picture's size) is a filled area rather than a stroke. */
  fillWidth: number
  /** Strokes shorter than this (fraction of the picture's size) are dropped. */
  minLength: number
  /** Blur radius in working pixels (merges double lines and glow into one stroke). */
  blur: number
}

export const DEFAULT_TRACE: TraceOptions = { threshold: null, fillWidth: 0.08, minLength: 0.015, blur: 1.5 }

/** Detail 0 (bold, simple) … 1 (every line) as trace options. */
export function traceDetail(detail: number): Pick<TraceOptions, 'minLength' | 'blur'> {
  const d = Math.max(0, Math.min(1, detail))
  return { minLength: 0.05 - 0.045 * d, blur: 3 - 2 * d }
}

export interface Traced {
  lines: DrawnLine[]
  /** Filled areas. */
  mask: Mask
  /** RGB raster (base64) the drones take their colours from. */
  colors: string
  cw: number
  ch: number
  stats: { strokes: number; length: number; fillArea: number; threshold: number }
}

const WORK = 768

/** Box-downscale RGBA to at most `max` on the long side. */
function downscale(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, max: number): { px: Float32Array; w: number; h: number } {
  const k = Math.max(1, Math.ceil(Math.max(w, h) / max))
  const W = Math.floor(w / k), H = Math.floor(h / k)
  const px = new Float32Array(W * H * 3)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, n = 0
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k; dx++) {
          const o = ((y * k + dy) * w + (x * k + dx)) * 4
          const a = rgba[o + 3]! / 255
          r += rgba[o]! * a; g += rgba[o + 1]! * a; b += rgba[o + 2]! * a; n++
        }
      const o = (y * W + x) * 3
      px[o] = r / n / 255; px[o + 1] = g / n / 255; px[o + 2] = b / n / 255
    }
  return { px, w: W, h: H }
}

function blurred(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0.25) return src
  // Three box passes ≈ a Gaussian.
  const rad = Math.max(1, Math.round(r))
  const a = src.slice(), b = new Float32Array(src.length)
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let s = 0
      for (let x = -rad; x <= rad; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]!
      for (let x = 0; x < w; x++) {
        b[y * w + x] = s / (2 * rad + 1)
        s += a[y * w + Math.min(w - 1, x + rad + 1)]! - a[y * w + Math.max(0, x - rad)]!
      }
    }
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let y = -rad; y <= rad; y++) s += b[Math.min(h - 1, Math.max(0, y)) * w + x]!
      for (let y = 0; y < h; y++) {
        a[y * w + x] = s / (2 * rad + 1)
        s += b[Math.min(h - 1, y + rad + 1) * w + x]! - b[Math.max(0, y - rad) * w + x]!
      }
    }
  }
  return a
}

/** Otsu's threshold of values in 0..1. */
function otsu(v: Float32Array): number {
  const bins = 256, hist = new Float64Array(bins)
  for (let i = 0; i < v.length; i++) hist[Math.min(bins - 1, Math.floor(v[i]! * bins))]!++
  let sum = 0
  for (let i = 0; i < bins; i++) sum += i * hist[i]!
  let sumB = 0, wB = 0, best = 0, at = 0
  for (let i = 0; i < bins; i++) {
    wB += hist[i]!
    if (!wB) continue
    const wF = v.length - wB
    if (!wF) break
    sumB += i * hist[i]!
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) ** 2
    if (between > best) { best = between; at = i }
  }
  return (at + 0.5) / bins
}

/** Euclidean-ish (chamfer 3-4) distance to the nearest non-ink pixel, in pixels. */
function distance(ink: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < d.length; i++) d[i] = ink[i] ? INF : 0
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]!)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!d[i]) continue
      d[i] = Math.min(d[i]!, at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (!d[i]) continue
      d[i] = Math.min(d[i]!, at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  for (let i = 0; i < d.length; i++) d[i] = d[i]! / 3
  return d
}

/** Zhang–Suen thinning, in place. */
function thin(img: Uint8Array, w: number, h: number): void {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : img[y * w + x]!)
  const del: number[] = []
  for (let changed = true, iter = 0; changed && iter < 200; iter++) {
    changed = false
    for (let step = 0; step < 2; step++) {
      del.length = 0
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!img[y * w + x]) continue
          const p2 = at(x, y - 1), p3 = at(x + 1, y - 1), p4 = at(x + 1, y), p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1), p7 = at(x - 1, y + 1), p8 = at(x - 1, y), p9 = at(x - 1, y - 1)
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (B < 2 || B > 6) continue
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          let A = 0
          for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++
          if (A !== 1) continue
          if (step === 0 ? p2 * p4 * p6 || p4 * p6 * p8 : p2 * p4 * p8 || p2 * p6 * p8) continue
          del.push(y * w + x)
        }
      for (const i of del) img[i] = 0
      if (del.length) changed = true
    }
  }
}

const N8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const

/** Trace a one-pixel skeleton into polylines (pixel coordinates). */
function traceSkeleton(sk: Uint8Array, w: number, h: number): { pts: [number, number][]; closed: boolean }[] {
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && sk[y * w + x] === 1
  const deg = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      let n = 0
      for (const [dx, dy] of N8) if (on(x + dx, y + dy)) n++
      deg[y * w + x] = n
    }
  const edgeKey = (a: number, b: number) => (a < b ? a * w * h + b : b * w * h + a)
  const used = new Set<number>()
  const out: { pts: [number, number][]; closed: boolean }[] = []
  const walk = (sx: number, sy: number, nx: number, ny: number): { pts: [number, number][]; closed: boolean } => {
    const pts: [number, number][] = [[sx, sy]]
    let px = sx, py = sy, x = nx, y = ny
    used.add(edgeKey(py * w + px, y * w + x))
    for (let guard = 0; guard < w * h; guard++) {
      pts.push([x, y])
      const i = y * w + x
      if (deg[i] !== 2 || (x === sx && y === sy)) break
      let moved = false
      for (const [dx, dy] of N8) {
        const qx = x + dx, qy = y + dy
        if (!on(qx, qy) || (qx === px && qy === py)) continue
        const k = edgeKey(i, qy * w + qx)
        if (used.has(k)) continue
        used.add(k)
        px = x; py = y; x = qx; y = qy
        moved = true
        break
      }
      if (!moved) break
    }
    const [lx, ly] = pts[pts.length - 1]!
    return { pts, closed: lx === sx && ly === sy && pts.length > 3 }
  }
  // From every end and junction along each of its edges.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!sk[i] || deg[i] === 2) continue
      for (const [dx, dy] of N8) {
        if (!on(x + dx, y + dy) || used.has(edgeKey(i, (y + dy) * w + x + dx))) continue
        out.push(walk(x, y, x + dx, y + dy))
      }
    }
  // What's left are loops.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!sk[i] || deg[i] !== 2) continue
      for (const [dx, dy] of N8) {
        if (!on(x + dx, y + dy) || used.has(edgeKey(i, (y + dy) * w + x + dx))) continue
        out.push(walk(x, y, x + dx, y + dy))
        break
      }
    }
  return out
}

type Path = { pts: [number, number][]; closed: boolean }

/** Degree of a skeleton pixel (8-neighbours on). */
function degreeAt(sk: Uint8Array, w: number, h: number, x: number, y: number): number {
  let n = 0
  for (const [dx, dy] of N8) { const qx = x + dx, qy = y + dy; if (qx >= 0 && qy >= 0 && qx < w && qy < h && sk[qy * w + qx]) n++ }
  return n
}

/**
 * Drop short spurs: paths with a free end (an end pixel with one neighbour)
 * shorter than minLen — the hairs thinning leaves on corners and blobs.
 * Paths between junctions are kept: they connect the drawing.
 */
function pruneSpurs(paths: Path[], sk: Uint8Array, w: number, h: number, minLen: number): Path[] {
  return paths.filter((p) => {
    if (p.closed) return true
    const [ax, ay] = p.pts[0]!, [bx, by] = p.pts[p.pts.length - 1]!
    const freeA = degreeAt(sk, w, h, ax, ay) <= 1, freeB = degreeAt(sk, w, h, bx, by) <= 1
    const L = pathLength(p.pts)
    if (freeA && freeB) return L >= minLen // an isolated scrap
    if (freeA || freeB) return L >= minLen * 0.6 // a spur
    return true
  })
}

/** Unit direction leaving a path's end (looking a few pixels in). */
function endDir(p: [number, number][], atStart: boolean): [number, number] {
  const k = Math.min(p.length - 1, 6)
  const a = atStart ? p[0]! : p[p.length - 1]!
  const b = atStart ? p[k]! : p[p.length - 1 - k]!
  const dx = a[0] - b[0], dy = a[1] - b[1], L = Math.hypot(dx, dy) || 1
  return [dx / L, dy / L]
}

/**
 * Join paths that meet at a junction into longer strokes, pairing the ends
 * that continue each other most straightly (a pen line that crosses or
 * touches another keeps going). Ends within 3 px share a junction.
 */
function chainStrokes(paths: Path[], minLen: number): Path[] {
  void minLen
  const open = paths.filter((p) => !p.closed && p.pts.length >= 2)
  const done = paths.filter((p) => p.closed)
  type End = { path: number; start: boolean; x: number; y: number; dir: [number, number] }
  const ends: End[] = []
  open.forEach((p, i) => {
    ends.push({ path: i, start: true, x: p.pts[0]![0], y: p.pts[0]![1], dir: endDir(p.pts, true) })
    ends.push({ path: i, start: false, x: p.pts[p.pts.length - 1]![0], y: p.pts[p.pts.length - 1]![1], dir: endDir(p.pts, false) })
  })
  // Candidate pairs: ends close together, pointing at each other (out of one, into the other).
  const cell = 4
  const grid = new Map<number, number[]>()
  const key = (x: number, y: number) => Math.floor(x / cell) * 100003 + Math.floor(y / cell)
  ends.forEach((e, i) => { const k = key(e.x, e.y); const l = grid.get(k); if (l) l.push(i); else grid.set(k, [i]) })
  const pairs: { a: number; b: number; cost: number }[] = []
  ends.forEach((e, i) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      for (const j of grid.get(Math.floor(e.x / cell + dx) * 100003 + Math.floor(e.y / cell + dy)) ?? []) {
        if (j <= i || ends[j]!.path === e.path) continue
        const f = ends[j]!
        if (Math.hypot(e.x - f.x, e.y - f.y) > 4) continue
        // Straight continuation: the two "leaving" directions point opposite ways.
        const straight = -(e.dir[0] * f.dir[0] + e.dir[1] * f.dir[1])
        if (straight < 0.34) continue // more than 70° off
        pairs.push({ a: i, b: j, cost: 1 - straight })
      }
    }
  })
  pairs.sort((p, q) => p.cost - q.cost)
  const mate = new Int32Array(ends.length).fill(-1)
  for (const p of pairs) if (mate[p.a]! < 0 && mate[p.b]! < 0) { mate[p.a] = p.b; mate[p.b] = p.a }
  // Follow the chains.
  const used = new Uint8Array(open.length)
  const walkFrom = (path: number, fromStart: boolean): Path => {
    const pts: [number, number][] = []
    let cur = path, forward = fromStart, closed = false
    for (let guard = 0; guard <= open.length; guard++) {
      used[cur] = 1
      const seg = open[cur]!.pts
      const ordered = forward ? seg : [...seg].reverse()
      pts.push(...(pts.length ? ordered.slice(1) : ordered))
      // The end we leave from, and its mate.
      const leave = cur * 2 + (forward ? 1 : 0)
      const m = mate[leave]!
      if (m < 0) break
      const next = ends[m]!
      if (used[next.path]) { closed = next.path === path; break }
      cur = next.path
      forward = next.start
    }
    return { pts, closed }
  }
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue
    // Start from a chain end if this path is in the middle of one.
    let start = i, fromStart = true
    for (let guard = 0, cur = i, atStart = true; guard <= open.length; guard++) {
      const m: number = mate[cur * 2 + (atStart ? 0 : 1)]!
      if (m < 0) { start = cur; fromStart = atStart; break }
      const next: End = ends[m]!
      if (next.path === i) break // a loop: start anywhere
      cur = next.path
      atStart = !next.start
      start = cur
      fromStart = atStart
    }
    done.push(walkFrom(start, fromStart))
  }
  return done
}

function pathLength(p: [number, number][]): number {
  let L = 0
  for (let i = 1; i < p.length; i++) L += Math.hypot(p[i]![0] - p[i - 1]![0], p[i]![1] - p[i - 1]![1])
  return L
}

/** Douglas–Peucker (handles closed loops whose ends meet). */
function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = pts[a]!, [bx, by] = pts[b]!
    const L = Math.hypot(bx - ax, by - ay)
    let far = -1, fd = tol
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i]!
      const d = L > 1e-9 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay)
      if (d > fd) { fd = d; far = i }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  return pts.filter((_, i) => keep[i])
}

/**
 * Smooth a pixel polyline (3-tap average, ends kept) so skeleton stair-steps
 * don't make drones zig-zag.
 */
function smooth(p: [number, number][], closed: boolean, passes = 2): [number, number][] {
  let a = p
  for (let k = 0; k < passes; k++) {
    a = a.map((q, i) => {
      if (!closed && (i === 0 || i === a.length - 1)) return q
      const prev = a[(i - 1 + a.length) % a.length]!, next = a[(i + 1) % a.length]!
      return [(prev[0] + 2 * q[0] + next[0]) / 4, (prev[1] + 2 * q[1] + next[1]) / 4] as [number, number]
    })
  }
  return a
}

/** Trace a picture (RGBA, any size) into strokes, filled areas and colours. */
export function traceImage(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, opts: Partial<TraceOptions> = {}): Traced {
  const o = { ...DEFAULT_TRACE, ...opts }
  const { px, w, h } = downscale(rgba, width, height, WORK)
  const size = Math.max(w, h)
  const n = w * h
  const value = new Float32Array(n)
  for (let i = 0; i < n; i++) value[i] = Math.max(px[i * 3]!, px[i * 3 + 1]!, px[i * 3 + 2]!)
  const soft = blurred(value, w, h, o.blur)
  const thr = o.threshold ?? Math.max(0.12, Math.min(0.6, otsu(soft)))
  // Hysteresis: faint pixels count when they connect to bright ones, so faint stretches of a line don't break it.
  const ink = new Uint8Array(n)
  const stack: number[] = []
  for (let i = 0; i < n; i++) if (soft[i]! > thr) { ink[i] = 1; stack.push(i) }
  const weak = thr * 0.5
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w, y = (i - x) / w
    for (const [dx, dy] of N8) {
      const qx = x + dx, qy = y + dy
      if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue
      const j = qy * w + qx
      if (!ink[j] && soft[j]! > weak) { ink[j] = 1; stack.push(j) }
    }
  }
  // Wide ink is a filled area: its core (deeper than half the fill width) grown back to its edges.
  const dist = distance(ink, w, h)
  const half = (o.fillWidth * size) / 2
  const fill = new Uint8Array(n)
  const core: number[] = []
  for (let i = 0; i < n; i++) if (dist[i]! >= half) core.push(i)
  if (core.length) {
    // Mark ink pixels within dist(core pixel) of a core pixel: a disc per core pixel, bounded by the ink.
    for (const i of core) {
      const cx = i % w, cy = (i - cx) / w, r = Math.ceil(dist[i]!)
      for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++)
        for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++)
          if (ink[y * w + x] && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) fill[y * w + x] = 1
    }
  }
  // Strokes: the rest of the ink, thinned to centre lines.
  const sk = new Uint8Array(n)
  for (let i = 0; i < n; i++) sk[i] = ink[i] && !fill[i] ? 1 : 0
  thin(sk, w, h)
  const minLen = o.minLength * size
  const strokes = chainStrokes(pruneSpurs(traceSkeleton(sk, w, h), sk, w, h, minLen), minLen)
  const lines: DrawnLine[] = []
  let total = 0
  for (const t of strokes) {
    const L = pathLength(t.pts)
    if (L < minLen && !(t.closed && L >= minLen * 0.6)) continue
    const pts = simplify(smooth(t.pts, t.closed), 0.6)
    total += L
    lines.push({ p: pts.flatMap(([x, y]) => [Math.round(((x + 0.5) / w) * 1e4) / 1e4, Math.round(((y + 0.5) / h) * 1e4) / 1e4]), ...(t.closed ? { closed: true } : {}) })
  }
  let fillArea = 0
  for (let i = 0; i < n; i++) fillArea += fill[i]!
  const mask = encodeMask(w, h, (x, y) => fill[y * w + x] === 1)
  // Colours at half resolution: the brightest colour within a few pixels, at full brightness.
  const CW = Math.max(1, Math.floor(w / 2)), CH = Math.max(1, Math.floor(h / 2))
  const rgb = new Uint8Array(CW * CH * 3)
  const R = 3
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      // The line's colour: among bright pixels nearby, the most colourful (a neon line's
      // core is near-white; its colour is in the glow around it), at full brightness.
      let best = -1, bi = -1, bright = 0, brightI = 0
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const sx = x * 2 + dx, sy = y * 2 + dy
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue
          const i = sy * w + sx
          const v = value[i]!
          if (v > bright) { bright = v; brightI = i }
          if (v < 0.18) continue
          const r = px[i * 3]!, g = px[i * 3 + 1]!, b = px[i * 3 + 2]!
          const chroma = (v - Math.min(r, g, b)) / v
          const score = chroma * Math.sqrt(v)
          if (score > best) { best = score; bi = i }
        }
      const o2 = (y * CW + x) * 3
      if (bright < 0.08) { rgb[o2] = rgb[o2 + 1] = rgb[o2 + 2] = 235; continue }
      // Grey or white lines stay white.
      const src = bi >= 0 && best > 0.12 ? bi : brightI
      const m = Math.max(1e-6, value[src]!)
      for (let c = 0; c < 3; c++) rgb[o2 + c] = Math.round(Math.min(1, px[src * 3 + c]! / m) * 255)
    }
  return { lines, mask, colors: bytesToBase64(rgb), cw: CW, ch: CH, stats: { strokes: lines.length, length: total / size, fillArea: fillArea / n, threshold: thr } }
}
