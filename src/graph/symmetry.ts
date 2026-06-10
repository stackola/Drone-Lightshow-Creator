// ============================================================================
// Bundle 3: Live Symmetry — pair-matching + mirrored writes
// ============================================================================
// `symmetry: SymmetryConfig` lives on FormationNodeData. When set, every point
// edit propagates to the paired point automatically. Points within `epsilon`
// of the mirror plane stay locked to it (the mirror axis component is zeroed).
// ============================================================================

import type { Vec3, SymmetryConfig } from './types'

type Axis = 'x' | 'y' | 'z'

export function reflectAxis(p: Vec3, plane: Vec3, axis: Axis): Vec3 {
  if (axis === 'x') return { x: 2 * plane.x - p.x, y: p.y, z: p.z }
  if (axis === 'y') return { x: p.x, y: 2 * plane.y - p.y, z: p.z }
  return { x: p.x, y: p.y, z: 2 * plane.z - p.z }
}

function distSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return dx * dx + dy * dy + dz * dz
}

function clampToPlane(p: Vec3, plane: Vec3, axis: Axis): Vec3 {
  if (axis === 'x') return { x: plane.x, y: p.y, z: p.z }
  if (axis === 'y') return { x: p.x, y: plane.y, z: p.z }
  return { x: p.x, y: p.y, z: plane.z }
}

function axisVal(p: Vec3, axis: Axis): number {
  return axis === 'x' ? p.x : axis === 'y' ? p.y : p.z
}

/**
 * Compute the pair index map for a point cloud given an axis-aligned mirror plane.
 * Points within `epsilon` of the plane become solos (locked to the plane). Others
 * are nearest-neighbour matched across the plane.
 */
export function buildSymmetryPairs(
  points: Vec3[],
  axis: Axis,
  plane: Vec3,
  epsilon = 0.05,
): number[][] {
  const pairs: number[][] = []
  const matched = new Set<number>()
  const planeAxis = axisVal(plane, axis)

  // First pass — solos on the plane.
  for (let i = 0; i < points.length; i++) {
    if (Math.abs(axisVal(points[i]!, axis) - planeAxis) < epsilon) {
      pairs.push([i])
      matched.add(i)
    }
  }

  // Second pass — nearest neighbours across the plane.
  for (let i = 0; i < points.length; i++) {
    if (matched.has(i)) continue
    const mirrored = reflectAxis(points[i]!, plane, axis)
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < points.length; j++) {
      if (j === i || matched.has(j)) continue
      // Must be on the opposite side of the plane.
      const sideI = axisVal(points[i]!, axis) - planeAxis
      const sideJ = axisVal(points[j]!, axis) - planeAxis
      if (sideI * sideJ >= 0) continue
      const d = distSq(points[j]!, mirrored)
      if (d < bestD) {
        bestD = d
        best = j
      }
    }
    if (best >= 0) {
      pairs.push([i, best])
      matched.add(i)
      matched.add(best)
    } else {
      // Orphan — keep as solo and snap to plane on edit.
      pairs.push([i])
      matched.add(i)
    }
  }

  return pairs
}

/**
 * Apply a set of new positions, propagating mirrored writes to paired points.
 * editedSet: Map<index, newPosition> — caller's authoritative writes.
 * `points` is the current full point array (pre-edit). Returns the updated array.
 */
export function applySymmetricEdit(
  points: Vec3[],
  symmetry: SymmetryConfig,
  edited: Map<number, Vec3>,
): Vec3[] {
  const out = points.map((p) => ({ ...p }))
  for (const pair of symmetry.pairs) {
    if (pair.length === 1) {
      const i = pair[0]!
      const newPos = edited.get(i)
      if (newPos) {
        out[i] = clampToPlane(newPos, symmetry.plane, symmetry.axis)
      }
    } else if (pair.length === 2) {
      const [a, b] = pair as [number, number]
      const aNew = edited.get(a)
      const bNew = edited.get(b)
      if (aNew && bNew) {
        out[a] = aNew
        out[b] = bNew
      } else if (aNew) {
        out[a] = aNew
        out[b] = reflectAxis(aNew, symmetry.plane, symmetry.axis)
      } else if (bNew) {
        out[b] = bNew
        out[a] = reflectAxis(bNew, symmetry.plane, symmetry.axis)
      }
    }
  }
  // Apply any edits to indices not covered by pairs (e.g. just added points).
  const covered = new Set<number>()
  for (const pair of symmetry.pairs) for (const i of pair) covered.add(i)
  edited.forEach((pos, idx) => {
    if (!covered.has(idx)) out[idx] = pos
  })
  return out
}

/** Add a point + its mirrored partner, returning new points + extended pairs. */
export function addSymmetricPoint(
  points: Vec3[],
  symmetry: SymmetryConfig,
  newPos: Vec3,
): { points: Vec3[]; pairs: number[][] } {
  const out = points.map((p) => ({ ...p }))
  const planeAxis = axisVal(symmetry.plane, symmetry.axis)
  const onPlane = Math.abs(axisVal(newPos, symmetry.axis) - planeAxis) < symmetry.epsilon
  if (onPlane) {
    const placed = clampToPlane(newPos, symmetry.plane, symmetry.axis)
    out.push(placed)
    return { points: out, pairs: [...symmetry.pairs, [out.length - 1]] }
  }
  out.push(newPos)
  out.push(reflectAxis(newPos, symmetry.plane, symmetry.axis))
  return { points: out, pairs: [...symmetry.pairs, [out.length - 2, out.length - 1]] }
}
