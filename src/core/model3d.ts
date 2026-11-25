// 3D models made of solid parts. Drones are spread evenly over the outer
// surface of the union: dense candidate points are sampled on every part's
// surface (area-weighted), points buried inside another part are discarded,
// then farthest-point sampling + Lloyd relaxation pick exactly n of them.
// Pure and deterministic (seeded by the model itself).

import type { ModelPart, Vec3 } from './types'
import { hashString, rng, rotationMatrix } from './math'
import { hexToRgb } from './color'
import { gather, spreadPick } from './sample'

export const MAX_PARTS = 80

type V = [number, number, number]
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V) => Math.sqrt(dot(a, a))
const scl = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k]
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

function mul(m: number[], p: V): V {
  return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2], m[3]! * p[0] + m[4]! * p[1] + m[5]! * p[2], m[6]! * p[0] + m[7]! * p[1] + m[8]! * p[2]]
}
function mulT(m: number[], p: V): V {
  return [m[0]! * p[0] + m[3]! * p[1] + m[6]! * p[2], m[1]! * p[0] + m[4]! * p[1] + m[7]! * p[2], m[2]! * p[0] + m[5]! * p[1] + m[8]! * p[2]]
}

/** Two unit vectors perpendicular to d (and to each other). */
function basis(d: V): [V, V] {
  const a: V = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  const u = cross(d, a)
  const ul = len(u) || 1
  const u1 = scl(u, 1 / ul)
  return [u1, cross(d, u1)]
}

function unitDir(r: () => number): V {
  const z = r() * 2 - 1
  const t = r() * Math.PI * 2
  const s = Math.sqrt(1 - z * z)
  return [s * Math.cos(t), s * Math.sin(t), z]
}

interface Solid {
  area: number
  inside(p: V, eps: number): boolean
  sample(r: () => number): V
}

function segmentSolid(from: V, to: V, radiusAt: (t: number) => number, caps: 'flat' | 'round', rMax: number): Solid {
  const axis = sub(to, from)
  const L = Math.max(1e-9, len(axis))
  const d = scl(axis, 1 / L)
  const [u, w] = basis(d)
  const r0 = radiusAt(0), r1 = radiusAt(1)
  const slant = Math.hypot(L, r0 - r1)
  const lateral = Math.PI * (r0 + r1) * slant
  const capA = caps === 'flat' ? Math.PI * r0 * r0 : 2 * Math.PI * r0 * r0
  const capB = caps === 'flat' ? Math.PI * r1 * r1 : 2 * Math.PI * r1 * r1
  const ring = (t: number, rad: number, ang: number): V => add(add(from, scl(d, t * L)), add(scl(u, rad * Math.cos(ang)), scl(w, rad * Math.sin(ang))))
  return {
    area: lateral + capA + capB,
    inside(p, eps) {
      const q = sub(p, from)
      const t = dot(q, d) / L
      if (caps === 'round') {
        // Capsule: distance to the segment.
        const tc = Math.max(0, Math.min(1, t))
        return len(sub(q, scl(d, tc * L))) < radiusAt(tc) - eps
      }
      if (t <= eps / L || t >= 1 - eps / L) return false
      const radial = len(sub(q, scl(d, t * L)))
      return radial < radiusAt(t) - eps
    },
    sample(r) {
      const pick = r() * (lateral + capA + capB)
      const ang = r() * Math.PI * 2
      if (pick < lateral) {
        // Area-uniform along a cone: weight t by the local radius.
        let t = r()
        for (let k = 0; k < 8 && rMax > 0 && r() > radiusAt(t) / rMax; k++) t = r()
        return ring(t, radiusAt(t), ang)
      }
      const atStart = pick < lateral + capA
      const rad = atStart ? r0 : r1
      if (caps === 'flat') return ring(atStart ? 0 : 1, rad * Math.sqrt(r()), ang)
      // Hemispherical end cap.
      const dir = unitDir(r)
      const outward = atStart ? scl(d, -1) : d
      const flip = dot(dir, outward) < 0 ? scl(dir, -1) : dir
      return add(atStart ? from : to, scl(flip, rad))
    },
  }
}

/** A straight line of drones from a to b (a part too thin for drones on both sides). */
function lineSolid(a: V, b: V, width: number, inside: Solid['inside']): Solid {
  const L = len(sub(b, a))
  return { area: Math.max(1e-9, L * width), inside, sample: (r) => add(a, scl(sub(b, a), r())) }
}

/** A filled flat ellipse (or rectangle) of drones: centre c, half-axes u and w (vectors). */
function sheetSolid(c: V, u: V, w: V, round: boolean, inside: Solid['inside']): Solid {
  const area = (round ? Math.PI : 4) * len(u) * len(w)
  return {
    area, inside,
    sample(r) {
      if (!round) return add(c, add(scl(u, r() * 2 - 1), scl(w, r() * 2 - 1)))
      const rad = Math.sqrt(r()), ang = r() * Math.PI * 2
      return add(c, add(scl(u, rad * Math.cos(ang)), scl(w, rad * Math.sin(ang))))
    },
  }
}

/**
 * A part's surface for drones. Parts thinner than `thin` (about the drones'
 * spacing, in model units) can't carry drones on both sides — front and back
 * would be closer than the drones may fly, and the whole model would have to
 * grow to make room. They become one sheet of drones (a wing, a fin, a leaf)
 * or one line (a leg, an antenna, a stem), the way drone-show models are built.
 */
function solidFor(part: ModelPart, thin = 0): Solid | null {
  const s = solidShape(part)
  if (!s || thin <= 0) return s
  switch (part.type) {
    case 'sphere':
      if (2 * part.radius >= thin) return s
      return { area: Math.PI * part.radius * part.radius, inside: s.inside, sample: () => [...part.center] as V }
    case 'ellipsoid':
    case 'box': {
      const half: V = part.type === 'box' ? [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2] : [...part.radii] as V
      const order = [0, 1, 2].sort((x, y) => half[y]! - half[x]!)
      const [big, mid, small] = order as [number, number, number]
      if (2 * half[small]! >= thin) return s
      const m = rotationMatrix(part.rotation)
      const axis = (k: number): V => { const e: V = [0, 0, 0]; e[k] = half[k]!; return mul(m, e) }
      const c = part.center as V
      if (2 * half[mid]! < thin) { const d = axis(big); return lineSolid(sub(c, d), add(c, d), thin, s.inside) }
      return sheetSolid(c, axis(big), axis(mid), part.type === 'ellipsoid', s.inside)
    }
    case 'cylinder':
    case 'cone':
    case 'capsule': {
      const from = part.from as V, to = part.to as V
      const R = part.type === 'cone' ? Math.max(part.radius, part.radiusTop) : part.radius
      const L = len(sub(to, from))
      if (2 * R < thin) return lineSolid(from, to, thin, s.inside)
      if (L < thin && part.type !== 'capsule') {
        const d = scl(sub(to, from), 1 / Math.max(1e-9, L)), [u, w] = basis(d)
        return sheetSolid(scl(add(from, to), 0.5), scl(u, R), scl(w, R), true, s.inside)
      }
      return s
    }
    case 'torus': {
      if (2 * part.tube >= thin) return s
      const m = rotationMatrix(part.rotation), c = part.center as V, R = part.radius
      return { area: 2 * Math.PI * R * thin, inside: s.inside, sample: (r) => { const a = r() * Math.PI * 2; return add(c, mul(m, [R * Math.cos(a), 0, R * Math.sin(a)])) } }
    }
    case 'plate': {
      if (part.depth >= thin) return s
      const poly = part.points, m = rotationMatrix(part.rotation), c = part.center as V
      const area = Math.abs(polygonArea(poly))
      return { area, inside: s.inside, sample: (r) => { const q = pointInPolygon2(poly, r); return add(c, mul(m, [q[0], q[1], 0])) } }
    }
    case 'tube': {
      if (2 * part.radius >= thin) return s
      const path = part.path as V[]
      const lens = path.slice(1).map((p, i) => len(sub(p, path[i]!)))
      const total = lens.reduce((x, y) => x + y, 0)
      return { area: Math.max(1e-9, total * thin), inside: s.inside, sample: (r) => alongPath(path, lens, total, r()) }
    }
    case 'lathe': {
      const prof = part.profile
      const maxR = Math.max(0, ...prof.map((p) => p[0]))
      if (2 * maxR >= thin) return s
      const ys = prof.map((p) => p[1])
      const m = rotationMatrix(part.rotation), c = part.center as V
      const a = add(c, mul(m, [0, Math.min(...ys), 0])), b = add(c, mul(m, [0, Math.max(...ys), 0]))
      return lineSolid(a, b, thin, s.inside)
    }
  }
}

/** Signed area of a polygon ([x, y] points). */
function polygonArea(poly: [number, number][]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) { const p = poly[i]!, q = poly[(i + 1) % poly.length]!; a += p[0] * q[1] - q[0] * p[1] }
  return a / 2
}

function insidePolygon(poly: [number, number][], x: number, y: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Distance from (x, y) to the polygon's outline. */
function edgeDistance(poly: [number, number][], x: number, y: number): number {
  let best = Infinity
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i]!, [bx, by] = poly[(i + 1) % poly.length]!
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy))
  }
  return best
}

/** A uniformly random point inside a polygon (rejection sampling in its bounding box). */
function pointInPolygon2(poly: [number, number][], r: () => number): [number, number] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
  for (const [x, y] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
  for (let k = 0; k < 64; k++) {
    const x = x0 + r() * (x1 - x0), y = y0 + r() * (y1 - y0)
    if (insidePolygon(poly, x, y)) return [x, y]
  }
  return poly[Math.floor(r() * poly.length)]!
}

/** A point a fraction u of the way along a polyline. */
function alongPath(path: V[], lens: number[], total: number, u: number): V {
  let d = u * total
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i]! || i === lens.length - 1) return add(path[i]!, scl(sub(path[i + 1]!, path[i]!), Math.min(1, d / (lens[i]! || 1))))
    d -= lens[i]!
  }
  return path[0]!
}

/** Distance from p to the segment ab. */
function segDist(p: V, a: V, b: V): number {
  const ab = sub(b, a), L2 = dot(ab, ab) || 1e-12
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2))
  return len(sub(p, add(a, scl(ab, t))))
}

function solidShape(part: ModelPart): Solid | null {
  switch (part.type) {
    case 'sphere': {
      const c = part.center as V, R = part.radius
      if (!(R > 0)) return null
      return { area: 4 * Math.PI * R * R, inside: (p, e) => len(sub(p, c)) < R - e, sample: (r) => add(c, scl(unitDir(r), R)) }
    }
    case 'ellipsoid': {
      const c = part.center as V, [a, b, cc] = part.radii
      if (!(a > 0 && b > 0 && cc > 0)) return null
      const m = rotationMatrix(part.rotation)
      const P = 1.6075
      const area = 4 * Math.PI * Math.pow((Math.pow(a * b, P) + Math.pow(a * cc, P) + Math.pow(b * cc, P)) / 3, 1 / P)
      return {
        area,
        inside(p, e) {
          const q = mulT(m, sub(p, c))
          const k = Math.min(a, b, cc)
          const s = (q[0] / a) ** 2 + (q[1] / b) ** 2 + (q[2] / cc) ** 2
          return s < (1 - e / k) ** 2
        },
        sample(r) {
          const dir = unitDir(r)
          return add(c, mul(m, [dir[0] * a, dir[1] * b, dir[2] * cc]))
        },
      }
    }
    case 'box': {
      const c = part.center as V, [sx, sy, sz] = part.size
      if (!(sx > 0 && sy > 0 && sz > 0)) return null
      const m = rotationMatrix(part.rotation)
      const faces = [sy * sz, sy * sz, sx * sz, sx * sz, sx * sy, sx * sy]
      const total = faces.reduce((x, y) => x + y, 0)
      return {
        area: 2 * (sx * sy + sy * sz + sx * sz),
        inside(p, e) {
          const q = mulT(m, sub(p, c))
          return Math.abs(q[0]) < sx / 2 - e && Math.abs(q[1]) < sy / 2 - e && Math.abs(q[2]) < sz / 2 - e
        },
        sample(r) {
          let pick = r() * total, f = 0
          while (f < 5 && pick > faces[f]!) { pick -= faces[f]!; f++ }
          const a = r() - 0.5, b = r() - 0.5
          const q: V =
            f < 2 ? [(f === 0 ? 0.5 : -0.5) * sx, a * sy, b * sz]
            : f < 4 ? [a * sx, (f === 2 ? 0.5 : -0.5) * sy, b * sz]
            : [a * sx, b * sy, (f === 4 ? 0.5 : -0.5) * sz]
          return add(c, mul(m, q))
        },
      }
    }
    case 'cylinder':
      if (!(part.radius > 0)) return null
      return segmentSolid(part.from as V, part.to as V, () => part.radius, 'flat', part.radius)
    case 'cone': {
      const r0 = Math.max(0, part.radius), r1 = Math.max(0, part.radiusTop)
      if (!(r0 > 0 || r1 > 0)) return null
      return segmentSolid(part.from as V, part.to as V, (t) => r0 + (r1 - r0) * t, 'flat', Math.max(r0, r1))
    }
    case 'capsule':
      if (!(part.radius > 0)) return null
      return segmentSolid(part.from as V, part.to as V, () => part.radius, 'round', part.radius)
    case 'torus': {
      const c = part.center as V, R = part.radius, t = part.tube
      if (!(R > 0 && t > 0)) return null
      const m = rotationMatrix(part.rotation)
      return {
        area: 4 * Math.PI * Math.PI * R * t,
        inside(p, e) {
          const q = mulT(m, sub(p, c))
          return (Math.hypot(q[0], q[2]) - R) ** 2 + q[1] ** 2 < (t - e) ** 2 && t > e
        },
        sample(r) {
          let u = 0, v = 0
          for (let k = 0; k < 12; k++) {
            u = r() * Math.PI * 2
            v = r() * Math.PI * 2
            if (r() < (R + t * Math.cos(v)) / (R + t)) break
          }
          const q: V = [(R + t * Math.cos(v)) * Math.cos(u), t * Math.sin(v), (R + t * Math.cos(v)) * Math.sin(u)]
          return add(c, mul(m, q))
        },
      }
    }
    case 'plate': {
      const poly = part.points, d = part.depth
      if (poly.length < 3 || !(d > 0)) return null
      const capArea = Math.abs(polygonArea(poly))
      if (!(capArea > 0)) return null
      const m = rotationMatrix(part.rotation), c = part.center as V
      const edges = poly.map((p, i) => { const q = poly[(i + 1) % poly.length]!; return Math.hypot(q[0] - p[0], q[1] - p[1]) })
      const perim = edges.reduce((x, y) => x + y, 0)
      const side = perim * d
      return {
        area: 2 * capArea + side,
        inside(p, e) {
          const q = mulT(m, sub(p, c))
          return Math.abs(q[2]) < d / 2 - e && insidePolygon(poly, q[0], q[1]) && edgeDistance(poly, q[0], q[1]) > e
        },
        sample(r) {
          const pick = r() * (2 * capArea + side)
          if (pick < 2 * capArea) {
            const [x, y] = pointInPolygon2(poly, r)
            return add(c, mul(m, [x, y, (pick < capArea ? 0.5 : -0.5) * d]))
          }
          let e = r() * perim, i = 0
          while (i < edges.length - 1 && e > edges[i]!) { e -= edges[i]!; i++ }
          const a = poly[i]!, b = poly[(i + 1) % poly.length]!, t = e / (edges[i]! || 1)
          return add(c, mul(m, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (r() - 0.5) * d]))
        },
      }
    }
    case 'tube': {
      const path = part.path as V[], R = part.radius
      if (path.length < 2 || !(R > 0)) return null
      const lens = path.slice(1).map((p, i) => len(sub(p, path[i]!)))
      const total = lens.reduce((x, y) => x + y, 0)
      if (!(total > 0)) return null
      const segs = path.slice(1).map((b, i) => segmentSolid(path[i]!, b, () => R, 'round', R))
      const dist = (p: V) => Math.min(...path.slice(1).map((b, i) => segDist(p, path[i]!, b)))
      return {
        area: 2 * Math.PI * R * total + 4 * Math.PI * R * R,
        inside: (p, e) => dist(p) < R - e,
        sample(r) {
          // A point on one segment's capsule that isn't buried inside the tube's other segments.
          for (let k = 0; k < 16; k++) {
            let d = r() * total, i = 0
            while (i < lens.length - 1 && d > lens[i]!) { d -= lens[i]!; i++ }
            const p = segs[i]!.sample(r)
            if (dist(p) > R * (1 - 1e-3)) return p
          }
          return segs[0]!.sample(r)
        },
      }
    }
    case 'lathe': {
      const prof = part.profile.filter((p) => p[0] >= 0)
      if (prof.length < 2) return null
      const m = rotationMatrix(part.rotation), c = part.center as V
      // Bands between consecutive profile points, plus flat caps where the ends are open.
      const bands = prof.slice(1).map((b, i) => { const a = prof[i]!; return { a, b, area: Math.PI * (a[0] + b[0]) * Math.hypot(b[0] - a[0], b[1] - a[1]) } })
      const first = prof[0]!, last = prof[prof.length - 1]!
      const capA = Math.PI * first[0] ** 2, capB = Math.PI * last[0] ** 2
      const area = bands.reduce((x, y) => x + y.area, 0) + capA + capB
      if (!(area > 0)) return null
      const radiusAt = (y: number): number => {
        let best = -1
        for (const { a, b } of bands) {
          const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1])
          if (y < lo || y > hi) continue
          const t = hi > lo ? (y - a[1]) / (b[1] - a[1]) : 0.5
          best = Math.max(best, a[0] + (b[0] - a[0]) * t)
        }
        return best
      }
      const rMax = Math.max(...prof.map((p) => p[0]))
      return {
        area,
        inside(p, e) {
          const q = mulT(m, sub(p, c))
          return Math.hypot(q[0], q[2]) < radiusAt(q[1]) - e
        },
        sample(r) {
          let pick = r() * area
          const ang = r() * Math.PI * 2
          const ring = (rad: number, y: number): V => add(c, mul(m, [rad * Math.cos(ang), y, rad * Math.sin(ang)]))
          if (pick < capA) return ring(first[0] * Math.sqrt(r()), first[1])
          pick -= capA
          if (pick < capB) return ring(last[0] * Math.sqrt(r()), last[1])
          pick -= capB
          let i = 0
          while (i < bands.length - 1 && pick > bands[i]!.area) { pick -= bands[i]!.area; i++ }
          const { a, b } = bands[i]!
          // Area-uniform along the band: favour the wider end.
          let t = r()
          for (let k = 0; k < 8 && rMax > 0 && r() > (a[0] + (b[0] - a[0]) * t) / rMax; k++) t = r()
          return ring(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
        },
      }
    }
  }
}

export interface ModelSample {
  /** Packed xyz, normalised so the largest extent is 1, centred on the bounding box. */
  points: Float32Array
  colors: Float32Array
  /** Index of the part each point lies on. */
  parts: Uint16Array
  /** Model units → normalised points: p_norm = (p − center) / extent. */
  frame: { center: Vec3; extent: number }
  /** Parts that contributed no surface (invalid or completely buried). */
  hiddenParts: number[]
}

/** The parts' solid geometry only (which joint a part moves with doesn't change where drones sit). */
export function solidsKey(parts: ModelPart[]): string {
  return JSON.stringify(parts.slice(0, MAX_PARTS).map(({ joint: _j, ...solid }) => solid)) // eslint-disable-line @typescript-eslint/no-unused-vars
}

/** Spread `n` drones over the outer surface of the model. */
export function sampleModel(parts: ModelPart[], n: number, opts: { relief?: boolean } = {}): ModelSample | null {
  const list = parts.slice(0, MAX_PARTS)
  if (n <= 0) return null
  // In relief about half the surface carries drones, so they sit closer: thin is judged at that spacing.
  const thin = thinThreshold(list, n) * (opts.relief ? Math.SQRT1_2 : 1)
  const solids = list.map((p) => solidFor(p, thin))
  const valid = solids.flatMap((s, i) => (s && Number.isFinite(s.area) && s.area > 0 ? [{ s, i }] : []))
  if (!valid.length) return null
  const r = rng(hashString(solidsKey(list)))
  const totalArea = valid.reduce((a, v) => a + v.s.area, 0)
  // Model scale, for a relative "inside" tolerance.
  const budget = Math.min(60000, Math.max(8000, n * 40))
  const raw: { p: V; part: number }[] = []
  for (const { s, i } of valid) {
    const m = Math.max(40, Math.ceil((budget * s.area) / totalArea))
    for (let k = 0; k < m; k++) raw.push({ p: s.sample(r), part: i })
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const { p } of raw) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0])
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1])
    minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2])
  }
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-9)
  const eps = extent * 2e-3
  // Keep only points on the outer surface of the union.
  let kept: { p: V; part: number }[] = []
  for (const c of raw) {
    let buried = false
    for (const { s, i } of valid) {
      if (i !== c.part && s.inside(c.p, eps)) { buried = true; break }
    }
    if (!buried) kept.push(c)
  }
  // Relief: only the surface the audience sees — in each small column (x, y), the front-most layer.
  if (opts.relief && kept.length) {
    const cell = (thin > 0 ? thin : extent / 40) * 0.75
    const tol = thin > 0 ? thin : extent / 40
    const key = (p: V) => (Math.floor(p[0] / cell) * 73856093) ^ (Math.floor(p[1] / cell) * 19349663)
    const front = new Map<number, number>()
    for (const c of kept) { const k = key(c.p); front.set(k, Math.max(front.get(k) ?? -Infinity, c.p[2])) }
    kept = kept.filter((c) => c.p[2] >= front.get(key(c.p))! - tol)
  }
  const seen = new Set(kept.map((c) => c.part))
  if (kept.length < n) return null
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2
  const cand = new Float32Array(kept.length * 3)
  kept.forEach(({ p }, k) => {
    cand[k * 3] = (p[0] - cx) / extent
    cand[k * 3 + 1] = (p[1] - cy) / extent
    cand[k * 3 + 2] = (p[2] - cz) / extent
  })
  const picks = spreadPick(cand, n, 4)
  const colors = new Float32Array(n * 3)
  const partOf = new Uint16Array(n)
  for (let k = 0; k < n; k++) {
    const part = kept[picks[k]!]!.part
    partOf[k] = part
    const c = hexToRgb(list[part]!.color)
    colors[k * 3] = c[0]; colors[k * 3 + 1] = c[1]; colors[k * 3 + 2] = c[2]
  }
  return {
    points: gather(cand, picks), colors, parts: partOf, frame: { center: [cx, cy, cz], extent },
    hiddenParts: list.flatMap((_, i) => (seen.has(i) ? [] : [i])),
  }
}

/**
 * The thickness (model units) below which a part gets one sheet or line of
 * drones: 80% of the spacing n drones would have spread evenly over the
 * model's surface. Estimated from the parts' areas and overall size, twice
 * (sheets have half the area of the solids they replace).
 */
function thinThreshold(list: ModelPart[], n: number): number {
  const base = list.map((p) => solidShape(p))
  const r = rng(hashString(`extent:${solidsKey(list)}`))
  const lo: V = [Infinity, Infinity, Infinity], hi: V = [-Infinity, -Infinity, -Infinity]
  for (const s of base) {
    if (!s) continue
    for (let k = 0; k < 48; k++) {
      const p = s.sample(r)
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a]!, p[a]!); hi[a] = Math.max(hi[a]!, p[a]!) }
    }
  }
  if (!Number.isFinite(lo[0])) return 0
  let thin = 0
  for (let pass = 0; pass < 2; pass++) {
    const area = list.reduce((a, p) => { const s = solidFor(p, thin); return a + (s && Number.isFinite(s.area) ? s.area : 0) }, 0)
    if (!(area > 0)) return 0
    // Hexagonal packing: each drone covers (√3/2)·s² of surface.
    thin = 0.8 * Math.sqrt((2 * area) / (Math.sqrt(3) * n))
  }
  return thin
}

/** Overall model bounds in model units (for UI and AI summaries). */
export function modelExtent(parts: ModelPart[]): Vec3 {
  const s = sampleModel(parts, 64)
  if (!s) return [0, 0, 0]
  const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < s.points.length; i += 3) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k]!, s.points[i + k]!); b[k] = Math.max(b[k]!, s.points[i + k]!) }
  return [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
}
