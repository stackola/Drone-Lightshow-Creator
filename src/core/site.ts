// The real site: position accuracy, keep-out zones and the permitted flight area.

import type { Limits, Site, Zone } from './types'
import { latLonToShow, showToLatLon, type GeoOrigin } from './geo'

export const NO_ACCURACY = { h: 0, v: 0 }

/** Accuracy presets for the editor. */
export const ACCURACY_PRESETS: { label: string; h: number; v: number; hint: string }[] = [
  { label: 'Exact', h: 0, v: 0, hint: 'Checks assume drones fly exactly on their planned paths' },
  { label: 'RTK', h: 0.1, v: 0.15, hint: 'RTK GNSS, typical for show drones (±0.1 m across, ±0.15 m up/down)' },
  { label: 'RTK+', h: 0.3, v: 0.5, hint: 'RTK with a safety margin, or in a gusty wind (±0.3 m / ±0.5 m)' },
  { label: 'GPS', h: 1.5, v: 3, hint: 'Plain GPS without RTK (±1.5 m / ±3 m) — needs very wide spacing' },
]

export function accuracyOf(L: Limits): { h: number; v: number } {
  return L.accuracy ?? NO_ACCURACY
}

/** The spacing plans must keep: the minimum plus room for both drones to be off their planned positions. */
export function safeSpacing(L: Limits): number {
  const a = accuracyOf(L)
  return L.minSpacing + 2 * Math.max(a.h, a.v)
}

/**
 * Limits as the planner and the checks use them: every clearance widened by
 * the position accuracy, so plans stay safe wherever within its accuracy
 * each drone really is.
 */
export function planningLimits(L: Limits): Limits {
  const a = accuracyOf(L)
  if (!a.h && !a.v) return L
  return {
    ...L,
    minSpacing: safeSpacing(L),
    minAltitude: L.minAltitude + a.v,
    maxAltitude: L.maxAltitude - a.v,
    maxRadius: Math.max(1, L.maxRadius - a.h),
  }
}

// --- Polygons -----------------------------------------------------------------------

export type Poly = [number, number][]

function pointInPolygon(x: number, z: number, p: Poly): boolean {
  let inside = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i]!, [xj, zj] = p[j]!
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function distToSegment(x: number, z: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const L2 = dx * dx + dz * dz
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)) : 0
  return Math.hypot(x - (a[0] + t * dx), z - (a[1] + t * dz))
}

/** Signed horizontal distance to a polygon's edge: negative inside, positive outside. */
export function signedDistance(x: number, z: number, p: Poly): number {
  if (p.length < 3) return Infinity
  let d = Infinity
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) d = Math.min(d, distToSegment(x, z, p[j]!, p[i]!))
  return pointInPolygon(x, z, p) ? -d : d
}

export function polygonArea(p: Poly): number {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j]![0] * p[i]![1] - p[i]![0] * p[j]![1]
  return Math.abs(a) / 2
}

export function centroid2(p: Poly): [number, number] {
  let x = 0, z = 0
  for (const q of p) { x += q[0]; z += q[1] }
  return [x / Math.max(1, p.length), z / Math.max(1, p.length)]
}

/**
 * Distance from a point to a zone (a prism from the ground to `top`), minus
 * what must be kept: the zone's buffer and the position accuracy. Negative
 * means too close (or inside). 1-Lipschitz in the position.
 */
export function zoneClearanceFn(zone: Zone, acc: { h: number; v: number }): (x: number, y: number, z: number) => number {
  const keep = zone.buffer + Math.max(acc.h, acc.v)
  const top = zone.top ?? Infinity
  const p = zone.points
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of p) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z) }
  return (x, y, z) => {
    // Far from the zone's box: the box distance is a lower bound that's enough.
    const bx = Math.max(minX - x, 0, x - maxX), bz = Math.max(minZ - z, 0, z - maxZ), by = Math.max(0, y - top)
    const box = Math.hypot(bx, bz, by)
    if (box > keep + 60) return box - keep
    const dh = signedDistance(x, z, p)
    let d: number
    if (dh > 0) d = y <= top ? dh : Math.hypot(dh, y - top)
    else d = y > top ? y - top : -Math.min(-dh, top - y)
    return d - keep
  }
}

/** Clearance inside the permitted flight area (negative = outside, or within accuracy of its edge). */
export function areaClearanceFn(area: Poly, acc: { h: number; v: number }): (x: number, y: number, z: number) => number {
  return (x, _y, z) => -signedDistance(x, z, area) - acc.h
}

/** Default buffers for new zones by kind (m). */
export const ZONE_KINDS: { kind: Zone['kind']; label: string; buffer: number; top: number | null; hint: string }[] = [
  { kind: 'audience', label: 'Audience', buffer: 30, top: null, hint: 'Spectator area: nothing flies over it, with a wide buffer' },
  { kind: 'building', label: 'Obstacle', buffer: 10, top: 25, hint: 'Buildings, trees, masts, cranes: keep clear up to their height plus a buffer' },
  { kind: 'no-fly', label: 'No-fly', buffer: 5, top: null, hint: 'Roads, neighbours, restricted airspace: keep out entirely' },
]

/**
 * Change where the show is (or which way it faces) while keeping the site's
 * zones and flight area where they are in the real world.
 */
export function reanchorSite(site: Site, next: GeoOrigin): Site {
  const prev = site.geo
  if (!prev) return { ...site, geo: next }
  const move = ([x, z]: [number, number]): [number, number] => {
    // show (previous anchor) → latitude/longitude → show (new anchor)
    const [lat, lon] = showToLatLon(x, z, prev)
    const r = latLonToShow(lat, lon, next)
    return [Math.round(r[0] * 100) / 100, Math.round(r[1] * 100) / 100]
  }
  return {
    ...site,
    geo: next,
    ...(site.zones ? { zones: site.zones.map((zn) => ({ ...zn, points: zn.points.map(move) })) } : {}),
    ...(site.area ? { area: site.area.map(move) } : {}),
  }
}
