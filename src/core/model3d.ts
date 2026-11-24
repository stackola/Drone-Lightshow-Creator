// 3D models made of solid parts. Drones are spread evenly over the outer
// surface of the union: dense candidate points are sampled on every part's
// surface (area-weighted), points buried inside another part are discarded,
// then farthest-point sampling + Lloyd relaxation pick exactly n of them.
// Pure and deterministic (seeded by the model itself).

import type { ModelPart, Vec3 } from './types'
import { hashString, rng, rotationMatrix } from './math'
import { hexToRgb } from './color'
import { gather, spreadPick } from './sample'

export const MAX_PARTS = 48

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

function solidFor(part: ModelPart): Solid | null {
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
  }
}

export interface ModelSample {
  /** Packed xyz, normalised so the largest extent is 1, centred on the bounding box. */
  points: Float32Array
  colors: Float32Array
  /** Parts that contributed no surface (invalid or completely buried). */
  hiddenParts: number[]
}

/** Spread `n` drones over the outer surface of the model. */
export function sampleModel(parts: ModelPart[], n: number): ModelSample | null {
  const list = parts.slice(0, MAX_PARTS)
  const solids = list.map(solidFor)
  const valid = solids.flatMap((s, i) => (s && Number.isFinite(s.area) && s.area > 0 ? [{ s, i }] : []))
  if (!valid.length || n <= 0) return null
  const r = rng(hashString(JSON.stringify(list)))
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
  const kept: { p: V; part: number }[] = []
  const seen = new Set<number>()
  for (const c of raw) {
    let buried = false
    for (const { s, i } of valid) {
      if (i !== c.part && s.inside(c.p, eps)) { buried = true; break }
    }
    if (!buried) { kept.push(c); seen.add(c.part) }
  }
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
  for (let k = 0; k < n; k++) {
    const c = hexToRgb(list[kept[picks[k]!]!.part]!.color)
    colors[k * 3] = c[0]; colors[k * 3 + 1] = c[1]; colors[k * 3 + 2] = c[2]
  }
  return { points: gather(cand, picks), colors, hiddenParts: list.flatMap((_, i) => (seen.has(i) ? [] : [i])) }
}

/** Overall model bounds in model units (for UI and AI summaries). */
export function modelExtent(parts: ModelPart[]): Vec3 {
  const s = sampleModel(parts, 64)
  if (!s) return [0, 0, 0]
  const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < s.points.length; i += 3) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k]!, s.points[i + k]!); b[k] = Math.max(b[k]!, s.points[i + k]!) }
  return [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!]
}
