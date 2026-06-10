// ============================================================================
// O-06: pure alignment + distribution math.
// Extracted from InspectorPanel's MultiSelectInspector so the algorithms can
// be tested in isolation without rendering React or wiring a store.
// ============================================================================

export type Axis = 'x' | 'y' | 'z'

export interface Positioned {
  id: string
  position: Record<Axis, number>
}

/**
 * Compute new position-axis values that align every item to the selection's
 * mean along the given axis. Returns one entry per input item, preserving
 * the other axes untouched.
 */
export function alignAxisToMean<T extends Positioned>(items: T[], axis: Axis): Array<{ id: string; position: Record<Axis, number> }> {
  if (items.length < 2) return []
  const mean = items.reduce((sum, n) => sum + n.position[axis], 0) / items.length
  return items.map((n) => ({
    id: n.id,
    position: { ...n.position, [axis]: mean },
  }))
}

/**
 * Sort items by the axis value, then re-space them evenly between the min
 * and max values (the outer bookends stay pinned). Returns one entry per
 * input item, preserving order in the output (NOT sorted) and other axes.
 *
 * Returns an empty list when fewer than 3 items are supplied (the operation
 * is undefined for 2 — they'd just sit at min and max, unchanged).
 */
export function distributeAxisEvenly<T extends Positioned>(items: T[], axis: Axis): Array<{ id: string; position: Record<Axis, number> }> {
  if (items.length < 3) return []
  const sorted = [...items].sort((a, b) => a.position[axis] - b.position[axis])
  const first = sorted[0]!.position[axis]
  const last = sorted[sorted.length - 1]!.position[axis]
  const step = (last - first) / (sorted.length - 1)
  // Map id → new value, then walk the original order so callers can zip.
  const newValueById = new Map<string, number>()
  for (let i = 0; i < sorted.length; i++) {
    newValueById.set(sorted[i]!.id, first + i * step)
  }
  return items.map((n) => ({
    id: n.id,
    position: { ...n.position, [axis]: newValueById.get(n.id) ?? n.position[axis] },
  }))
}
