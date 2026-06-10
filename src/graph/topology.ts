// ============================================================================
// Topological Sort + Cycle Detection
// ============================================================================
// Uses Kahn's algorithm for topological sort. DFS for cycle detection.
// Only considers 'flow' edges for ordering (attachment edges are structural).
// ============================================================================

import type { ShowGraph } from './types'
import { buildGraphIndex, type GraphIndex } from './graphIndex'

/**
 * Kahn's algorithm — returns node IDs in evaluation order.
 * Only considers flow edges. Throws on cycle.
 * Ignores group nodes (they don't participate in flow).
 */
export function topologicalSort(graph: ShowGraph, index?: GraphIndex): string[] {
  const idx = index ?? buildGraphIndex(graph)
  const nonGroupNodes = graph.nodes.filter((n) => n.type !== 'group')
  const nodeIds = new Set(nonGroupNodes.map((n) => n.id))

  // Build in-degree from pre-built adjacency
  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()

  for (const id of nodeIds) {
    inDegree.set(id, 0)
    // Filter adjacency to only include non-group targets
    const targets = (idx.flowAdjacency.get(id) ?? []).filter((t) => nodeIds.has(t))
    adjacency.set(id, targets)
  }

  for (const [, targets] of adjacency) {
    for (const t of targets) {
      inDegree.set(t, (inDegree.get(t) ?? 0) + 1)
    }
  }

  // Collect nodes with in-degree 0, sorted for deterministic output
  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }
  queue.sort()

  const result: string[] = []

  while (queue.length > 0) {
    // Queue is maintained in sorted order via sorted insertion below
    const current = queue.shift()!
    result.push(current)

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1
      inDegree.set(neighbor, newDeg)
      if (newDeg === 0) {
        // Sorted insertion — O(n) per insert but avoids O(n log n) full re-sort per iteration
        const insertIdx = queue.findIndex((q) => q > neighbor)
        if (insertIdx === -1) queue.push(neighbor)
        else queue.splice(insertIdx, 0, neighbor)
      }
    }
  }

  if (result.length !== nodeIds.size) {
    throw new Error('Graph contains a cycle — topological sort impossible')
  }

  return result
}

/**
 * DFS-based cycle detection. Returns cycle paths or null if no cycles.
 * Only considers flow edges.
 */
export function detectCycles(graph: ShowGraph, index?: GraphIndex): string[][] | null {
  const idx = index ?? buildGraphIndex(graph)
  const nonGroupNodes = graph.nodes.filter((n) => n.type !== 'group')
  const nodeIds = new Set(nonGroupNodes.map((n) => n.id))

  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    adjacency.set(id, (idx.flowAdjacency.get(id) ?? []).filter((t) => nodeIds.has(t)))
  }

  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  const parent = new Map<string, string | null>()
  const cycles: string[][] = []

  for (const id of nodeIds) {
    color.set(id, WHITE)
    parent.set(id, null)
  }

  function dfs(u: string): void {
    color.set(u, GRAY)
    for (const v of adjacency.get(u) ?? []) {
      if (color.get(v) === GRAY) {
        // Back edge found — extract cycle
        const cycle: string[] = [v]
        let cur = u
        while (cur !== v) {
          cycle.push(cur)
          cur = parent.get(cur) ?? v
        }
        cycle.push(v)
        cycle.reverse()
        cycles.push(cycle)
      } else if (color.get(v) === WHITE) {
        parent.set(v, u)
        dfs(v)
      }
    }
    color.set(u, BLACK)
  }

  // Sort for deterministic traversal order
  const sortedIds = [...nodeIds].sort()
  for (const id of sortedIds) {
    if (color.get(id) === WHITE) {
      dfs(id)
    }
  }

  return cycles.length > 0 ? cycles : null
}

/**
 * Returns all ancestor node IDs (upstream via flow edges).
 */
export function getUpstreamNodes(graph: ShowGraph, nodeId: string, index?: GraphIndex): string[] {
  const idx = index ?? buildGraphIndex(graph)
  const visited = new Set<string>()
  const queue = [nodeId]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const src of idx.flowReverseAdjacency.get(current) ?? []) {
      if (!visited.has(src)) {
        visited.add(src)
        queue.push(src)
      }
    }
  }

  return [...visited]
}

/**
 * Returns all descendant node IDs (downstream via flow edges).
 */
export function getDownstreamNodes(graph: ShowGraph, nodeId: string, index?: GraphIndex): string[] {
  const idx = index ?? buildGraphIndex(graph)
  const visited = new Set<string>()
  const queue = [nodeId]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const tgt of idx.flowAdjacency.get(current) ?? []) {
      if (!visited.has(tgt)) {
        visited.add(tgt)
        queue.push(tgt)
      }
    }
  }

  return [...visited]
}
