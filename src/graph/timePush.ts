// ============================================================================
// Time Push — Shift Downstream Nodes to Accommodate Physics Constraints
// ============================================================================
// When a transition (e.g. ant-walk) needs more time than available, or a
// formation's keyframes are too fast, this module pushes all downstream
// timed nodes (formations, idles, launches) later by the required delta.
//
// The push cascades: after pushing, downstream transitions that now have
// less time are checked — if they also violate, their downstream is pushed too.
//
// Also supports "extend-formation" fixes: extend a formation's duration AND
// push everything downstream.
// ============================================================================

import type { ShowGraph, FormationNodeData, IdleNodeData, LaunchNodeData } from './types'
import { computeAllTiming } from './timing'

/**
 * Compute the delta (in seconds) needed to push a specific downstream node
 * so that a transition has `requiredDuration` seconds available.
 *
 * Returns 0 if no push is needed.
 */
export function computePushDelta(
  graph: ShowGraph,
  transitionNodeId: string,
  requiredDuration: number,
): number {
  const timing = computeAllTiming(graph)
  const transTime = timing.get(transitionNodeId)
  if (!transTime) return 0

  const currentDuration = transTime.end - transTime.start
  const delta = requiredDuration - currentDuration
  return delta > 0.01 ? delta : 0
}

/**
 * Collect all node IDs downstream of a given node (inclusive of the node itself
 * if includeStart is true), via BFS along flow edges.
 */
export function collectDownstreamNodes(graph: ShowGraph, startNodeId: string, includeStart: boolean): string[] {
  const flowEdges = graph.edges.filter((e) => e.edgeType === 'flow')
  const visited = new Set<string>()
  const result: string[] = []

  const queue = [startNodeId]

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    if (visited.has(nodeId)) continue
    visited.add(nodeId)

    if (nodeId !== startNodeId || includeStart) {
      result.push(nodeId)
    }

    for (const edge of flowEdges) {
      if (edge.source === nodeId && !visited.has(edge.target)) {
        queue.push(edge.target)
      }
    }
  }

  return result
}

/**
 * Get all timed nodes downstream of a given node that have a startTime field.
 * These are the nodes whose startTime needs to be pushed.
 *
 * Returns array of { nodeId, currentStartTime } for formations, idle, and launch nodes.
 * Transitions and lands derive their timing — they don't need direct pushing,
 * but they are traversed so their downstream timed nodes ARE included.
 */
export function getDownstreamTimedNodes(graph: ShowGraph, startNodeId: string): { nodeId: string; currentStartTime: number }[] {
  const downstream = collectDownstreamNodes(graph, startNodeId, false)
  const result: { nodeId: string; currentStartTime: number }[] = []

  for (const nodeId of downstream) {
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) continue

    if (node.type === 'formation') {
      const data = node.data as FormationNodeData
      result.push({ nodeId, currentStartTime: data.startTime })
    } else if (node.type === 'idle') {
      const data = node.data as IdleNodeData
      result.push({ nodeId, currentStartTime: data.startTime })
    } else if (node.type === 'launch') {
      const data = node.data as LaunchNodeData
      result.push({ nodeId, currentStartTime: data.startTime })
    }
    // Transitions and lands derive timing — no startTime to push.
    // But they ARE traversed by collectDownstreamNodes, so their downstream IS included.
  }

  return result
}

/**
 * Compute the set of node updates needed to push downstream timing by `delta` seconds.
 * Returns an array of patches that can be applied to graphStore.
 */
export function computeTimePushPatches(
  graph: ShowGraph,
  startNodeId: string,
  delta: number,
): { nodeId: string; patch: { startTime: number } }[] {
  if (delta <= 0) return []

  const timedNodes = getDownstreamTimedNodes(graph, startNodeId)
  return timedNodes.map(({ nodeId, currentStartTime }) => ({
    nodeId,
    patch: { startTime: Math.round((currentStartTime + delta) * 100) / 100 },
  }))
}

/**
 * Compute patches to extend a formation's duration by `delta` seconds AND push
 * all downstream timed nodes by `delta` seconds.
 */
export function computeExtendFormationPatches(
  graph: ShowGraph,
  formationNodeId: string,
  delta: number,
): { nodeId: string; patch: Record<string, unknown> }[] {
  if (delta <= 0) return []

  const node = graph.nodes.find((n) => n.id === formationNodeId)
  if (!node || node.type !== 'formation') return []
  const data = node.data as FormationNodeData

  const patches: { nodeId: string; patch: Record<string, unknown> }[] = []

  const oldDuration = data.duration
  const newDuration = Math.round((oldDuration + delta) * 100) / 100
  const scale = oldDuration > 0 ? newDuration / oldDuration : 1

  // Extend duration AND rescale all keyframe times proportionally
  // This is critical: without rescaling, velocity between keyframes stays the same
  // and the fix has no effect
  const rescaledKeyframes = data.keyframes.map((kf) => ({
    ...kf,
    time: Math.round(kf.time * scale * 100) / 100,
  }))

  patches.push({
    nodeId: formationNodeId,
    patch: { duration: newDuration, keyframes: rescaledKeyframes },
  })

  // Push all downstream timed nodes
  const pushPatches = computeTimePushPatches(graph, formationNodeId, delta)
  for (const p of pushPatches) {
    patches.push({ nodeId: p.nodeId, patch: p.patch })
  }

  return patches
}
