// ============================================================================
// Drone Flow Propagation
// ============================================================================
// Walks topological order, computes available drones per node from incoming
// flow edges. All drones pass through — idle absorbs leftovers at eval time.
// Manual edges computed first, then auto edges get even split of remainder.
// ============================================================================

import type { ShowGraph, ShowEdge, Diagnostic } from './types'
import { isLaunchNode } from './types'
import { topologicalSort } from './topology'

export interface FlowResult {
  edges: ShowEdge[]
  diagnostics: Diagnostic[]
}

/**
 * Compute drone flow for all edges in the graph.
 * Returns updated edges with resolved droneCount values + diagnostics.
 */
export function computeFlow(graph: ShowGraph): FlowResult {
  const diagnostics: Diagnostic[] = []
  const updatedEdges = graph.edges.map((e) => ({ ...e }))
  const flowEdges = updatedEdges.filter((e) => e.edgeType === 'flow')

  // Build a map of node available drones
  const nodeAvailable = new Map<string, number>()

  let sortedIds: string[]
  try {
    sortedIds = topologicalSort(graph)
  } catch {
    diagnostics.push({
      severity: 'error',
      message: 'Graph contains cycles — cannot compute flow',
      nodeIds: [],
      edgeIds: [],
    })
    return { edges: updatedEdges, diagnostics }
  }

  // Build node map for O(1) lookups
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]))

  for (const nodeId of sortedIds) {
    const node = nodeMap.get(nodeId)
    if (!node) continue

    // Compute incoming drone count for this node
    const incomingEdges = flowEdges.filter((e) => e.target === nodeId)
    let incomingDrones = 0

    if (isLaunchNode(node)) {
      // Launch nodes produce drones from their data
      incomingDrones = (node.data as { droneCount: number }).droneCount
    } else {
      incomingDrones = incomingEdges.reduce((sum, e) => sum + e.droneCount, 0)
    }

    const available = incomingDrones
    nodeAvailable.set(nodeId, available)

    // Resolve outgoing flow edges
    const outgoingEdges = flowEdges.filter((e) => e.source === nodeId)
    if (outgoingEdges.length === 0) continue

    const totalAvailable = Math.max(0, available)

    // Phase 1: resolve manual-count and manual-percent edges
    let manualConsumed = 0
    const autoEdges: ShowEdge[] = []

    // Collect percent edges for Hamilton's method (largest remainder)
    const percentEdges: { edge: ShowEdge; exact: number }[] = []

    for (const edge of outgoingEdges) {
      if (edge.allocation.mode === 'manual-count') {
        edge.droneCount = edge.allocation.count
        manualConsumed += edge.droneCount
      } else if (edge.allocation.mode === 'manual-percent') {
        const exact = (edge.allocation.percent / 100) * totalAvailable
        percentEdges.push({ edge, exact })
      } else {
        autoEdges.push(edge)
      }
    }

    // Hamilton's method: floor each, then distribute remainders to largest fractional parts
    if (percentEdges.length > 0) {
      const floored = percentEdges.map((pe) => ({ ...pe, floor: Math.floor(pe.exact), remainder: pe.exact - Math.floor(pe.exact) }))
      const totalFloored = floored.reduce((s, f) => s + f.floor, 0)
      const totalExact = Math.round(percentEdges.reduce((s, pe) => s + pe.exact, 0))
      let extra = totalExact - totalFloored

      // Sort by remainder descending to distribute extras
      const sorted = [...floored].sort((a, b) => b.remainder - a.remainder)
      for (const item of sorted) {
        item.edge.droneCount = item.floor + (extra > 0 ? 1 : 0)
        if (extra > 0) extra--
        manualConsumed += item.edge.droneCount
      }
    }

    // Phase 2: auto edges get even split of remainder (clamp to 0 to prevent negative counts)
    const remainder = Math.max(0, totalAvailable - manualConsumed)
    if (autoEdges.length > 0) {
      const perEdge = Math.floor(remainder / autoEdges.length)
      let leftover = remainder - perEdge * autoEdges.length

      for (const edge of autoEdges) {
        edge.droneCount = perEdge + (leftover > 0 ? 1 : 0)
        if (leftover > 0) leftover--
      }
    }

    // Validate: over-allocation
    const totalOutgoing = outgoingEdges.reduce((sum, e) => sum + e.droneCount, 0)
    if (totalOutgoing > totalAvailable) {
      diagnostics.push({
        severity: 'error',
        message: `Node '${nodeId}': outgoing flow (${totalOutgoing}) exceeds available drones (${totalAvailable})`,
        nodeIds: [nodeId],
        edgeIds: outgoingEdges.map((e) => e.id),
      })
    }

    // Validate: under-allocation (informational)
    if (totalOutgoing < totalAvailable && outgoingEdges.length > 0) {
      diagnostics.push({
        severity: 'warning',
        message: `Node '${nodeId}': ${totalAvailable - totalOutgoing} drones unallocated`,
        nodeIds: [nodeId],
        edgeIds: [],
      })
    }
  }

  return { edges: updatedEdges, diagnostics }
}

/**
 * Get the total incoming drone count for a node.
 */
export function getNodeIncomingDrones(graph: ShowGraph, nodeId: string): number {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node) return 0

  if (isLaunchNode(node)) {
    return (node.data as { droneCount: number }).droneCount
  }

  return graph.edges
    .filter((e) => e.edgeType === 'flow' && e.target === nodeId)
    .reduce((sum, e) => sum + e.droneCount, 0)
}
