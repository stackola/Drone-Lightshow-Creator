// ============================================================================
// Shared helpers for the AI write-tool modules. These were duplicated in the
// 1066-LOC `aiWriteTools.ts` before the domain split (2026-05-21).
// ============================================================================

import type { Vec3 } from '../graph/types'

/** Reasonable starting transform for newly-created nodes — 15m above origin. */
export const DEFAULT_TRANSFORM = {
  position: { x: 0, y: 15, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
} as const

/** Merge a `{x?, y?, z?}` partial into an existing Vec3. Missing axes stay. */
export function mergeVec3(existing: Vec3, partial?: Record<string, unknown>): Vec3 {
  if (!partial) return existing
  return {
    x: typeof partial.x === 'number' ? partial.x : existing.x,
    y: typeof partial.y === 'number' ? partial.y : existing.y,
    z: typeof partial.z === 'number' ? partial.z : existing.z,
  }
}
