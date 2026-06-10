// ============================================================================
// S13-05/06/07/08: Formation Manipulation Tools
// ============================================================================
// Utilities that transform existing formation point clouds.
// ============================================================================

import type { Vec3 } from './types'

/**
 * S13-05: Apply variable density to formation points.
 * Points closer to center are denser, edges are sparser (or vice versa).
 */
export function applyDensityFalloff(
  points: Vec3[],
  targetCount: number,
  falloff: 'none' | 'center-dense' | 'edge-dense',
): Vec3[] {
  if (falloff === 'none' || points.length <= targetCount) return points.slice(0, targetCount)

  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  const cz = points.reduce((s, p) => s + p.z, 0) / points.length

  // Score each point by distance from centroid
  const scored = points.map((p) => {
    const d = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2 + (p.z - cz) ** 2)
    return { point: p, dist: d }
  })

  const maxD = Math.max(...scored.map((s) => s.dist)) || 1

  // Weight: center-dense = higher weight for low distance, edge-dense = opposite
  const weighted = scored.map((s) => ({
    ...s,
    weight: falloff === 'center-dense' ? 1 - s.dist / maxD : s.dist / maxD,
  }))

  // Sort by weight descending and take top N
  weighted.sort((a, b) => b.weight - a.weight)
  return weighted.slice(0, targetCount).map((w) => w.point)
}

/**
 * S13-06: Apply random jitter/noise to formation points.
 */
export function applyJitter(points: Vec3[], amplitude: number, seed: number = 42): Vec3[] {
  return points.map((p, i) => ({
    x: p.x + seededRandom(seed + i * 3) * amplitude,
    y: p.y + seededRandom(seed + i * 3 + 1) * amplitude,
    z: p.z + seededRandom(seed + i * 3 + 2) * amplitude,
  }))
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return (x - Math.floor(x)) * 2 - 1 // Returns -1 to 1
}

/**
 * S13-07: Mirror formation points across an axis.
 */
export function mirrorFormation(points: Vec3[], axis: 'x' | 'y' | 'z'): Vec3[] {
  const mirrored = points.map((p) => ({
    x: axis === 'x' ? -p.x : p.x,
    y: axis === 'y' ? -p.y : p.y,
    z: axis === 'z' ? -p.z : p.z,
  }))
  // Return original + mirrored, removing near-duplicates on the axis plane
  const combined = [...points]
  for (const m of mirrored) {
    const isDuplicate = points.some(
      (p) => Math.abs(p.x - m.x) < 0.01 && Math.abs(p.y - m.y) < 0.01 && Math.abs(p.z - m.z) < 0.01,
    )
    if (!isDuplicate) combined.push(m)
  }
  return combined
}

/**
 * S13-08: Scale formation to fit exactly N drones with proper min spacing.
 */
export function scaleToFit(points: Vec3[], targetCount: number, minSpacing: number): Vec3[] {
  if (points.length === 0) return []

  // If we have more points than needed, subsample
  let working = points
  if (working.length > targetCount) {
    // Uniform subsample
    const step = working.length / targetCount
    working = Array.from({ length: targetCount }, (_, i) => working[Math.floor(i * step)]!)
  }

  // Compute current min distance between any two points
  let minDist = Infinity
  for (let i = 0; i < working.length; i++) {
    for (let j = i + 1; j < Math.min(working.length, i + 20); j++) {
      const d = Math.sqrt(
        (working[i]!.x - working[j]!.x) ** 2 +
        (working[i]!.y - working[j]!.y) ** 2 +
        (working[i]!.z - working[j]!.z) ** 2,
      )
      if (d > 0 && d < minDist) minDist = d
    }
  }

  // Scale so min distance matches minSpacing
  if (minDist > 0 && minDist < Infinity) {
    const scaleFactor = minSpacing / minDist
    const cx = working.reduce((s, p) => s + p.x, 0) / working.length
    const cy = working.reduce((s, p) => s + p.y, 0) / working.length
    const cz = working.reduce((s, p) => s + p.z, 0) / working.length
    working = working.map((p) => ({
      x: cx + (p.x - cx) * scaleFactor,
      y: cy + (p.y - cy) * scaleFactor,
      z: cz + (p.z - cz) * scaleFactor,
    }))
  }

  return working
}
