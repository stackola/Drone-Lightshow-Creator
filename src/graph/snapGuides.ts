// ============================================================================
// Smart guides — Figma-style alignment snapping for dragging a formation.
// Pure + unit-testable. Given the dragged center and its peers, snaps each
// world axis independently to a nearby peer center and emits guide segments to
// draw. Axis-independent so you can align X while Y/Z stay free.
// ============================================================================

import type { Vec3 } from './types'

export interface Positioned {
  id: string
  position: Vec3
}

export interface SnapGuide {
  axis: 'x' | 'y' | 'z'
  /** The peer that was aligned to (for keys / debugging). */
  peerId: string
  from: Vec3
  to: Vec3
}

export interface SnapResult {
  position: Vec3
  guides: SnapGuide[]
}

const AXES = ['x', 'y', 'z'] as const

/**
 * Snap `pos` toward peer centers per axis when within `threshold` world units.
 * Returns the snapped position + a guide segment per snapped axis (peer → snapped).
 */
export function computeSnapGuides(pos: Vec3, peers: Positioned[], threshold = 0.6): SnapResult {
  const out: Vec3 = { x: pos.x, y: pos.y, z: pos.z }
  const guides: SnapGuide[] = []

  for (const axis of AXES) {
    let best: { val: number; dist: number; peerId: string; peerPos: Vec3 } | null = null
    for (const p of peers) {
      const dist = Math.abs(pos[axis] - p.position[axis])
      if (dist <= threshold && (!best || dist < best.dist)) {
        best = { val: p.position[axis], dist, peerId: p.id, peerPos: p.position }
      }
    }
    if (best) out[axis] = best.val
    if (best) {
      // Guide segment runs from the aligned peer center to the snapped center.
      guides.push({ axis, peerId: best.peerId, from: { ...best.peerPos }, to: { ...out } })
    }
  }

  // Fix up guide endpoints so they reflect the fully-snapped position (a later
  // axis snap may have moved `out` after an earlier guide was pushed).
  for (const g of guides) g.to = { ...out }

  return { position: out, guides }
}
